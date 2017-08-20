'use strict'

const debug = require('debug')('loopback:component:access:role-resolvers')
const { createPromiseCallback } = require('loopback-datasource-juggler/lib/utils')
const _defaults = require('lodash').defaults
const _get = require('lodash').get
const Promise = require('bluebird')
const AccessUtils = require('./utils')

module.exports = class AccessRoleResolvers {
  constructor(app, options) {
    this.app = app
    this.options = AccessUtils.parseConfigOptions(app, options);
           
    app.accessUtils = app.accessUtils || new AccessUtils(app, options)
    this.accessUtils = app.accessUtils
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

      // No options present
      if (!context.remotingContext.args.options) {
        process.nextTick(() => {
          debug('Skipping as no options have been set')
          cb(null, true)
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
    if (this.accessUtils.isGroupModel(modelClass)) {
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

        if (rel.type === 'belongsTo' && this.accessUtils.isGroupModel(rel.modelTo)) {
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
    if (this.accessUtils.isGroupModel(context.model)) {
      process.nextTick(() => cb(null, context.modelId))
      return cb.promise
    }

    // If we are accessing an existing model, get the group id from the existing model instance.
    // TODO: Cache this result so that it can be reused across each ACL lookup attempt.
    if (context.modelId) {
      debug(`fetching ${this.options.groupKey} for existing ${context.modelName}.id ${context.modelId}`)

      const contextOptions = context.remotingContext.args.options;
      const appOptions = this.options;

      context.model.findById(context.modelId, {}, contextOptions, function(err, item) {
        if (err) return cb(err);

        else if (item) {
          debug(`determined ${appOptions.groupKey} ${item[appOptions.groupKey]} from existing ${context.modelName}.id ${context.modelId}`)
          groupId = item[appOptions.groupKey]
        }
        cb(null, groupId)
      });
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