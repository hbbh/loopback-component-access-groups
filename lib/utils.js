'use strict'

const debug = require('debug')('loopback:component:access:utils')
const { createPromiseCallback } = require('loopback-datasource-juggler/lib/utils')
const _defaults = require('lodash').defaults
const _get = require('lodash').get
const Promise = require('bluebird')

module.exports = class AccessUtils {
  constructor(app, options) {
    this.app = app

    this.options = _defaults({ }, options, {
      userModel: 'User',
      userKey: 'userId',
      groupModel: 'Group',
      groupKey: 'groupId',
      roleModel: 'Role',
      groupAccessModel: 'GroupAccess',
      groupRoles: [
        '$group:admin',
        '$group:member',
      ],
      applyToStatic: false,
    })

    // Default the groupKey to the group model name + Id.
    this.options.groupKey = this.options.groupKey || `${this.options.groupModel.toLowerCase()}Id`

    // Default the userKey to the group model name + Id.
    this.options.userKey = this.options.userKey || `${this.options.userModel.toLowerCase()}Id`

    // Validate the format of options.groupRoles ($group:[role]).
    this.options.groupRoles.forEach(name => {
      if (!AccessUtils.isValidPrincipalId(name)) {
        throw new Error('$name is an invalid access group name.')
      }
    })

    // Save the component config for easy reference.
    app.set('loopback-component-access-groups', options)
    
    debug('options: %o', options)
  }

  /**
   * Register a dynamic role resolver for each defined access group.
   */
  setupRoleResolvers() {
    this.options.groupRoles.forEach(accessGroup => {
      this.setupRoleResolver(accessGroup)
    })
  }

  /**
   * Setup filters for all the different models
   */
  setupFilters() {

    // setup special filters for User model
    this.setupFiltersForUserModel();

    // setup special filters for Group model
    this.setupFiltersForGroupModel();

    // setup special filters for GroupAccess model 
    this.setupFiltersForGroupAccessModel();

    // setup filters for all other "regular" models that contain data belonging to a specific group
    this.setupFiltersForGroupContentModels();
  }

  /**
   * Add operation hooks to limit access for User Models
   */
  setupFiltersForUserModel() {
    debug(`setupFiltersForUserModel() ${this.options.userModel}`);
    const Model = this.app.models[this.options.userModel];
  }

  /**
   * Add operation hooks to limit access on Group models
   */
  setupFiltersForGroupModel() {
    debug(`setupFiltersForGroupModel() ${this.options.groupModel}`);
    const Model = this.app.models[this.options.groupModel];
  }

  /**
   * Add operation hooks to limit access on GroupAccess model
   */
  setupFiltersForGroupAccessModel() {
    debug(`setupFiltersForGroupAccessModel() ${this.options.groupAccessModel}`);
    const Model = this.app.models[this.options.groupAccessModel];
  }

  /**
   * Add operation hooks to limit access on all "regular" models that contain data
   * belonging to a specific group
   */
  setupFiltersForGroupContentModels() {
    const models = this.getGroupContentModels();

    models.forEach(modelName => {
      const Model = this.app.models[modelName]

      if (typeof Model.observe === 'function') {
        debug(`setupFiltersForGroupContentModels() ${modelName} `)

        this.setupAccessFilter(Model);
        this.setupBeforeSaveFilter(Model);
        this.setupBeforeDeleteFilter(Model);
      }
    })
  }

  /**
   * Add operation hooks to limit access on all "regular" models that contain data
   * belonging to a specific group
   * 
   * Observe any INSERT/UPDATE event on Model
   * 
   * @param {Model} modelObj The Model to attach the filter to.
   */
  setupAccessFilter(modelObj){
    debug(`attaching 'access' filter to ${modelObj.modelName}`)
    modelObj.observe('access', (ctx, next) => {
      debug(`access hook executing on ${ctx.options.method.stringName}`)
      // current user and group/tenant context have been set by Tenant MIXIN and are in ctx.options

      if (ctx.options.currentUser) {
        // Do not apply filters if no group access acls were applied
        const groupAccessApplied = ctx.options.groupAccessApplied

        if (!groupAccessApplied) {
          debug('acls not appled - skipping access filters')
          return next()
        }

        // debug('%s observe access: query=%s, options=%o, hookState=%o',
        //   Model.modelName, JSON.stringify(ctx.query, null, 4), ctx.options, ctx.hookState)

        return this.buildFilter(ctx.options.currentUserId, ctx.options.currentGroupId, ctx.Model)
          .then(filter => {
            debug('original query: %s', JSON.stringify(ctx.query, null, 4))
            const where = ctx.query.where ? {
              and: [ ctx.query.where, filter ],
            } : filter

            ctx.query.where = where
            debug('modified query: %s', JSON.stringify(ctx.query, null, 4))
          })
      }

      return next()
    })
  }

  /**
   * Add operation hooks to limit access on all "regular" models that contain data
   * belonging to a specific group
   * 
   * Observe any INSERT/UPDATE event on Model
   * 
   * @param {Model} modelObj The Model to attach the filter to.
   */
  setupBeforeSaveFilter(modelObj){
    debug(`attaching 'before save' filter to ${modelObj.modelName}`)

    modelObj.observe('before save', function event(ctx, next) {
      debug(`before save hook executing on ${ctx.options.method.stringName}`)

      // handle special cases where we don't know if we are creating or updating
      if (ctx.options.method.name === "updateOrCreate" || ctx.options.method.name === "upsertWithWhere"){
        // TODO handle this
        debug(`detected ${ctx.options.method.name}`);
      }

      if (ctx.isNewInstance) {
        // distinguish between CREATE and UPDATE
        // NOTE: likely only useful on 'after save'
        debug(`isNewInstance true`);
      }

      if (ctx.instance) {
        // ctx.instance is provided when the operation affects a single instance and
        // performs a full update/create/delete of all model properties
        debug(`ctx.instance present`)
        
        // set the accountId to the current group
        ctx.instance.$accountId = ctx.options.currentGroupId;
      }
      
      if (ctx.currentInstance){
        // ctx.data.squirrel = true;
        debug(`ctx.currentInstance present`)
      }

      if (ctx.where){
        // present when affecting mult objects OR a few properties of 1+ objects
        debug(`ctx.where present`)
      }

      if (ctx.data){
        // present when affecting mult objects OR a few properties of 1+ objects
        debug(`ctx.data present`)
      }

      next();
    });
  }

 /**
   * Add operation hooks to limit access on all "regular" models that contain data
   * belonging to a specific group
   * 
   * Observe any DELETE event on Model
   * 
   * @param {Model} modelObj The Model to attach the filter to.
   */
  setupBeforeDeleteFilter(modelObj){
    debug(`attaching 'before delete' filter to ${modelObj.modelName}`)

    modelObj.observe('before delete', function event(ctx, next) {
      debug(`before delete hook executing on ${ctx.options.method.stringName}`)
      if (ctx.isNewInstance) {
        // distinguish between CREATE and UPDATE
        // NOTE: likely only useful on 'after save'
        debug(`isNewInstance true`);
      }

      if (ctx.instance) {
        // ctx.instance is provided when the operation affects a single instance and
        // performs a full update/create/delete of all model properties
        debug(`ctx.instance present`)
      }
      
      if (ctx.currentInstance){
        // ctx.data.squirrel = true;
        debug(`ctx.currentInstance present`)
      }

      if (ctx.where){
        // present when affecting mult objects OR a few properties of 1+ objects
        debug(`ctx.where present`)
      }

      if (ctx.data){
        // present when affecting mult objects OR a few properties of 1+ objects
        debug(`ctx.data present`)
      }

      next();
    });
  }

  /**
   * Build a where filter to restrict search results to a users group
   *
   * @param {String} userId UserId to build filter for.
   * @param {String} groupId GroupId to build filter for.
   * @param {Object} Model Model to build filter for,
   * @returns {Object} A where filter.
   */
  buildFilter(userId, groupId, Model) {
    var cb = createPromiseCallback()
    const filter = {}
    const key = this.isGroupModel(Model) ? Model.getIdName() : this.options.groupKey

    // if groupId is set, then restrict results to only that group
    if (groupId){
      filter[key] = groupId;
      process.nextTick(() => cb(null, filter))
    }

    // if no group id is set, then return anything that belongs to all groups the user belongs to
    else {
      this.getAccessGroupsForUser(userId)
        .then(accessGroups => {
          accessGroups = Array.from(accessGroups, group => group[this.options.groupKey])
          filter[key] = { inq: accessGroups }
          cb(null, filter);
        })
    }

    return cb.promise;
  }

  /**
   * Check if a model class is the configured group model.
   *
   * @param {String|Object} modelClass Model class to check.
   * @returns {Boolean} Returns true if the principalId is on the expected format.
   */
  isGroupModel(modelClass) {
    if (modelClass) {
      const groupModel = this.app.models[this.options.groupModel]

      return modelClass === groupModel ||
        modelClass.prototype instanceof groupModel ||
        modelClass === this.options.groupModel
    }
    return false
  }

  /**
   * Check if a model class is the configured group access model.
   *
   * @param {String|Object} modelClass Model class to check.
   * @returns {Boolean} Returns true if the principalId is on the expected format.
   */
  isGroupAccessModel(modelClass) {
    if (modelClass) {
      const groupAccessModel = this.app.models[this.options.groupAccessModel]

      return modelClass === groupAccessModel ||
        modelClass.prototype instanceof groupAccessModel ||
        modelClass === this.options.groupAccessModel
    }
    return false
  }

  /**
   * Get a list of group content models (models that have a belongs to relationship to the group model)
   *
   * @returns {Array} Returns a list of group content models.
   */
  getGroupContentModels() {
    const models = [ ]

    Object.keys(this.app.models).forEach(modelName => {
      const modelClass = this.app.models[modelName]

      // Mark the group itself as a group or the group access model.
      if (this.isGroupModel(modelClass) || this.isGroupAccessModel(modelClass)) {
        return
      }

      // Try to follow belongsTo
      for (let rel in modelClass.relations) {
        rel = _get(modelClass, `relations.${rel}`)
        // debug('Checking relation %s to %s: %j', r, rel.modelTo.modelName, rel);
        if (rel.type === 'belongsTo' && this.isGroupModel(rel.modelTo)) {
          models.push(modelName)
        }
      }
    })

    debug('Got group content models: %o', models)
    return models
  }

  /**
   * Get the access groups for a given user.
   *
   * @param {String} userId UserId to fetch access groups for.
   * @param {Boolean} force Boolean indicating wether to bypass the cache if it exists.
   * @param {Function} [cb] A callback function.
   * @returns {Boolean} Returns true if the principalId is on the expected format.
   */
  getAccessGroupsForUser(userId, force, cb) {
    force = force || false
    cb = cb || createPromiseCallback()
    // const currentUser = AccessUtils.getCurrentUser()
    // const currentUserGroups = AccessUtils.getCurrentUserGroups()

    // Return from the context cache if exists.
    // if (!force && currentUser && currentUser.getId() === userId) {
    //   debug('getAccessGroupsForUser returning from cache: %o', currentUserGroups)
    //   process.nextTick(() => cb(null, currentUserGroups))
    //   return cb.promise
    // }

    // Otherwise lookup from the datastore.
    const filter = { where: {}}
    filter.where[this.options.userKey] = userId;
    this.app.models[this.options.groupAccessModel].find(filter)
      .then(groups => {
        debug('getAccessGroupsForUser returning from datastore: %o', groups)
        cb(null, groups)
      })
      .catch(cb)

    return cb.promise
  }

  /**
   * Valid that a principalId conforms to the expected format.
   *
   * @param {String} principalId A principalId.
   * @returns {Boolean} Returns true if the principalId is on the expected format.
   */
  static isValidPrincipalId(principalId) {
    return Boolean(this.extractRoleName(principalId))
  }

  /**
   * Extract the role name from a principalId (eg, for '$group:admin' the role name is 'admin').
   *
   * @param {String} principalId A principalId.
   * @returns {Boolean} Returns true if the principalId is on the expected format.
   */
  static extractRoleName(principalId) {
    return principalId.split(':')[1]
  }

  /**
   * Extract the group/tenant from the HTTP request
   *
   * @param {String} req The HTTP request object
   * @returns {Boolean} Returns the Group object if the group id was set in the header and a group matching the id is found
   */
   extractGroupFromHTTPRequest(req) {
    const groupKey = this.options.groupKey.toLowerCase();
    const groupModel = this.app.models[this.options.groupModel];

    return new Promise(function(resolve, reject){
      if (req){
        // const groupKey = this.options.groupKey.toLowerCase();
        if (groupKey in req.headers){
          // extract the group Id from the header
          const groupId = req.headers[groupKey];

          if (groupId){
            // fetch the group for the group Id
            groupModel.findById(groupId, function(err, groupObj){
              if (err) reject(err);

              if (!groupObj) {
                debug('No group found matching id ' + groupId);
              }

              debug('Found group matching id ' + groupId);
              resolve(groupObj);
            });
          } else {
            debug('HTTP Req ' + groupKey + ' property is present but undefined')
            resolve(undefined);
          }
        } else {
          debug('HTTP Req does not contain ' + groupKey + ' property')
          resolve(undefined);
        }
      } else {
        debug('HTTP Req undefined')
        resolve(undefined);
      }
    });
  }

  /**
   * Register a dynamic role resolver for an access group.
   *
   * @param {String} accessGroup Name of the access group to be setup.
   */
  setupRoleResolver(accessGroup) {
    debug(`Registering role resolver for ${accessGroup}`)
    const Role = this.app.models[this.options.roleModel]

    Role.registerResolver(accessGroup, (role, context, cb) => {
      cb = cb || createPromiseCallback()

      // the Model object being operated on
      const ModelClass = context.model

      // ID of the specific model instance being operated on
      // this is only set when a specific instance is specified in the client's API call
      const modelId = context.modelId

      // ID of the user requesting this operation
      const userId = context.getUserId()
      
      // the name of the role being resolved (e.g. manager, employee, etc)
      const roleName = AccessUtils.extractRoleName(role)

      // the Model that maps users to groups and stores user's role with that group
      const GroupAccessModel = this.app.models[this.options.groupAccessModel]

      const scope = { }

      debug(`Role Resolver: evaluating if user ${userId} has ${roleName} role; user attempting ${context.remotingContext.methodString}`)
      // debug(`Role resolver for ${role}: evaluate ${ModelClass.modelName} with id: ${modelId} for user: ${userId}`)

      // No userId is present
      if (!userId) {
        process.nextTick(() => {
          debug('Deny access for anonymous user')
          cb(null, false)
        })
        return cb.promise
      }

      // default to false
      // LoopBackContext.getCurrentContext().set('groupAccessApplied', false)
      context.remotingContext.args.options.groupAccessApplied = false;

      /**
       * Basic application that does not cover static methods. Similar to $owner. (RECOMMENDED)
       */
      if (!this.options.applyToStatic) {
        if (!context || !ModelClass || !modelId) {
          process.nextTick(() => {
            debug('Deny access (context: %s, context.model: %s, context.modelId: %s)',
              Boolean(context), Boolean(ModelClass), Boolean(modelId))
            cb(null, false)
          })
          return cb.promise
        }

        this.isGroupMemberWithRole(ModelClass, modelId, userId, roleName)
          .then(res => cb(null, res))
          .catch(cb)

        return cb.promise
      }

      /**
       * More complex application that also covers static methods. (EXPERIMENTAL)
       */
      Promise.join(this.getCurrentGroupId(context), this.getTargetGroupId(context),
        (currentGroupId, targetGroupId) => {
          debug(`currentGroupId ${currentGroupId} targetGroupId ${targetGroupId}`)
          if (!currentGroupId) {
            // TODO: Use promise cancellation to abort the chain early.
            // Causes the access check to be bypassed (see below).
            return [ false ]
          }

          scope.currentGroupId = currentGroupId
          scope.targetGroupId = targetGroupId

          // holds promises
          const actions = [ ]

          // set filter conditions to match role, CURRENT group id, and user id
          const conditions = { role: { ilike: roleName }}
          conditions[this.options.groupKey] = currentGroupId
          conditions[this.options.userKey] = userId;

          // count the number of matches to the filter
          actions.push(GroupAccessModel.count(conditions))

          // If this is an attempt to save the item into a new group, check the user has access to the target group.
          if (targetGroupId && targetGroupId !== currentGroupId) {
            // set filter condition's group id to be TARGET group id
            conditions[this.options.groupKey] = targetGroupId
            actions.push(GroupAccessModel.count(conditions))
          }

          return actions
        })
        .spread((currentGroupCount, targetGroupCount) => {
          let res = false

          if (currentGroupCount === false) {
            // No group context was determined, so allow passthrough access.
            res = true
          }
          else {
            // Determine grant based on the current/target group context.
            res = currentGroupCount > 0

            debug(`user ${userId} ${res ? 'is a' : 'is not a'} ${roleName} of ${this.options.groupModel} ${scope.currentGroupId}`)

            // If it's an attempt to save into a new group, also ensure the user has access to the target group.
            if (scope.targetGroupId && scope.targetGroupId !== scope.currentGroupId) {
              const tMember = targetGroupCount > 0

              debug(`user ${userId} ${tMember ? 'is a' : 'is not a'} ${roleName} of ${this.options.groupModel} ${scope.targetGroupId}`)
              res = res && tMember
            }
          }

          // Note the fact that we are allowing access due to passing an ACL.
          if (res) {
            // LoopBackContext.getCurrentContext().set('groupAccessApplied', true)
            context.remotingContext.args.options.groupAccessApplied = true;
          }

          return cb(null, res)
        })
        .catch(cb)
      return cb.promise
    })
  }

  /**
   * Check if a given user ID has a given role in the model instances group.
   * @param {Function} modelClass The model class
   * @param {*} modelId The model ID
   * @param {*} userId The user ID
   * @param {*} roleId The role ID
   * @param {Function} callback Callback function
   */
  isGroupMemberWithRole(modelClass, modelId, userId, roleId, cb) {
    cb = cb || createPromiseCallback()
    debug('isGroupMemberWithRole: modelClass: %o, modelId: %o, userId: %o, roleId: %o',
      modelClass && modelClass.modelName, modelId, userId, roleId)

    // No userId is present
    if (!userId) {
      process.nextTick(() => {
        cb(null, false)
      })
      return cb.promise
    }

    // Is the modelClass GroupModel or a subclass of GroupModel?
    if (this.isGroupModel(modelClass)) {
      debug(`Access to Group Model (${modelClass.modelName}) ${modelId} attempted`)
      this.hasRoleInGroup(userId, roleId, modelId)
        .then(res => cb(null, res))
      return cb.promise
    }

    modelClass.findById(modelId, (err, inst) => {
      if (err || !inst) {
        debug('Model not found for id %j', modelId)
        return cb(err, false)
      }
      debug('Model found: %j', inst)
      const groupId = inst[this.options.groupKey]

      // Ensure groupId exists and is not a function/relation
      if (groupId && typeof groupId !== 'function') {
        return this.hasRoleInGroup(userId, roleId, groupId)
          .then(res => cb(null, res))
      }
      // Try to follow belongsTo
      for (const relName in modelClass.relations) {
        const rel = modelClass.relations[relName]

        if (rel.type === 'belongsTo' && this.isGroupModel(rel.modelTo)) {
          debug('Checking relation %s to %s: %j', relName, rel.modelTo.modelName, rel)
          return inst[relName](function processRelatedGroup(error, group) {
            if (!error && group) {
              debug(`Group (${modelClass.modelName}) found: %j`, group.getId())
              return cb(null, this.hasRoleInGroup(userId, roleId, group.getId()))
            }
            return cb(error, false)
          })
        }
      }
      debug('No matching belongsTo relation found for model %j and group: %j', modelId, groupId)
      return cb(null, false)
    })
    return cb.promise
  }

  hasRoleInGroup(userId, role, group, cb) {
    debug('hasRoleInGroup: role: %o, group: %o, userId: %o', role, group, userId)
    cb = cb || createPromiseCallback()
    const GroupAccess = this.app.models[this.options.groupAccessModel]
    const conditions = { userId, role }

    conditions[this.options.groupKey] = group
    GroupAccess.count(conditions)
      .then(count => {
        const res = count > 0

        debug(`User ${userId} ${res ? 'HAS' : 'DOESNT HAVE'} ${role} role in group ${group}`)
        cb(null, res)
      })
    return cb.promise
  }

  /**
   * Determine the current Group Id based on the current security context.
   *
   * @param {Object} context The security context.
   * @param {function} [cb] A callback function.
   * @returns {Object} Returns the determined Group ID.
   */
  getCurrentGroupId(context, cb) {
    cb = cb || createPromiseCallback()
    debug(`getCurrentGroupId for ${context.modelName}`)
    let groupId = null

    // If we are accessing the group model directly, the group id is the model id.
    if (this.isGroupModel(context.model)) {
      process.nextTick(() => cb(null, context.modelId))
      return cb.promise
    }

    // If we are accessing an existing model, get the group id from the existing model instance.
    // TODO: Cache this result so that it can be reused across each ACL lookup attempt.
    if (context.modelId) {
      debug(`fetching ${this.options.groupKey} for existing ${context.modelName}.id ${context.modelId}`)
      context.model.findById(context.modelId, { }, {
        skipAccess: true,
      })
        .then(item => {
          // TODO: Attempt to follow relationships in addition to the foreign key.
          if (item) {
            debug(`determined ${this.options.groupKey} ${item[this.options.groupKey]} from existing ${context.modelName}.id ${context.modelId}`)
            groupId = item[this.options.groupKey]
          }
          cb(null, groupId)
        })
        .catch(cb)
    }

    // If we are creating a new model, get the groupKey from the incoming headers
    else if (_get(context, `remotingContext.req.headers[${this.options.groupKey.toLowerCase()}]`)) {
      groupId = context.remotingContext.req.headers[this.options.groupKey.toLowerCase()]
      debug(`determined current ${this.options.groupKey} ${groupId} from ${this.options.groupKey.toLowerCase()} property in header data`)
      process.nextTick(() => cb(null, groupId))
    }

    // Otherwise, return null.
    else {
      debug('unable to determine current group context')
      process.nextTick(() => cb(null, groupId))
    }

    return cb.promise
  }

  /**
   * Determine the target Group Id based on the current security context.
   *
   * @param {Object} context The security context.
   * @param {function} [cb] A callback function.
   * @returns {Object} Returns the determined Group ID.
   */
  getTargetGroupId(context, cb) {
    cb = cb || createPromiseCallback()
    debug(`getTargetGroupId for ${context.modelName}`);
    let groupId = null

    // Get the target group id from the incoming data.
    if (_get(context, `remotingContext.req.headers[${this.options.groupKey.toLowerCase()}]`)) {
      groupId = context.remotingContext.req.headers[this.options.groupKey.toLowerCase()]
      debug(`determined target ${this.options.groupKey} ${groupId} from ${this.options.groupKey.toLowerCase()} property in header data`)
    }

    // Otherwise, return null.
    else {
      debug('unable to determine target group context')
    }

    process.nextTick(() => cb(null, groupId))

    return cb.promise
  }
}