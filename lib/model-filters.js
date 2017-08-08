'use strict'

const debug = require('debug')('loopback:component:access:filters')
const { createPromiseCallback } = require('loopback-datasource-juggler/lib/utils')
const _defaults = require('lodash').defaults
const _filter = require('lodash').filter
const Promise = require('bluebird')
const AccessUtils = require('./utils')

module.exports = class AccessModelFilters {
  constructor(app, options) {
    this.app = app
    this.options = AccessUtils.parseConfigOptions(app, options)
    
    app.accessUtils = app.accessUtils || new AccessUtils(app, options)
    this.accessUtils = app.accessUtils
  }

  /**
   * Setup filters for all the different models
   */
  setupFilters() {

    // setup special filters for User, Group, and GroupAccess models
    this.setupFiltersAndHooksForUserModel();
    this.setupFiltersAndHooksForGroupModel();
    this.setupFiltersAndHooksForGroupAccessModel();

    // setup filters for all other "regular" models that contain data belonging to a specific group
    this.setupFiltersAndHooksForGroupContentModels();
  }

  /**
   * Upon successful login, include all AccountRoles associated with this user
   * This helps reduce the need for an additional API call by the client upon login
   */
  addAccountRolesOnLogin(ctx, result, next){
    debug(`addAccountRolesOnLogin() on ${ctx.methodString}`);
    
    // press on if there is no ctx.result
    if (!ctx.result){
      debug(`skipping addAccountRolesOnLogin() because no ctx.result`)
      return next()
    }

    // make sure we're handling a login event
    if (ctx.method.name !== "login"){
      debug(`skipping addAccountRolesOnLogin() on ${ctx.methodString}`)
      return next()
    }

    // grab (from context)
    // 1. a ref to the app
    // 2 the group id with which this user associated this request
    const app = ctx.req.app
    const curUserId = ctx.result.userId

    // check for errors
    if (!app) {
      return next(new Error("No app object found."));
    }
    if (!curUserId) {
      return next(new Error("No current User Id set. It must be set."));
    }

    const configOptions = app.get('loopback-component-access-groups');
    if (!configOptions) {
      return next(new Error("No loopback-component-access-groups options object found."));
    }

    const GroupAccessModel = app.models[configOptions.groupAccessModel]
    const GroupModel = app.models[configOptions.groupModel]
    const UserModel = app.models[configOptions.userModel]

    // get the list of users with GroupAccesses (roles) matching the current group id
    var filter = {
      where: {},
      include: []
    }
    filter.where[configOptions.userKey] = curUserId
    filter.include.push(GroupModel.modelName.toLowerCase())
    GroupAccessModel.find(filter, function(err, groupAccesses){
      if (err) { return next(err) }
      
      ctx.result[GroupAccessModel.pluralModelName.toLowerCase()] = groupAccesses
      return next()
    });
  }

  /**
   * For each User being returned, this:
   * 1. filters them according to the current users' current group
   * 2. decorates them with the User's associated role for the
   * current Group (determined from context)
   */
  filterAndAddRolesToUsers(ctx, result, next){
    debug(`filterAndAddRolesToUsers() on ${ctx.methodString}`);
    
    // press on if there is no ctx.result
    if (!ctx.result){
      debug(`skipping filterAndAddRolesToUsers() because no ctx.result`)
      return next()
    }

    if (ctx.method.name === "login" || ctx.method.name === "logout"){
      debug(`skipping filterAndAddRolesToUsers() on ${ctx.methodString}`)
      return next()
    }

    // grab (from context)
    // 1. a ref to the app
    // 2 the group id with which this user associated this request
    const app = ctx.args.options.app
    const curGroupId = ctx.args.options.currentGroupId

    // check for errors
    if (!app) {
      return next(new Error("No app object found."));
    }
    if (!curGroupId) {
      return next(new Error("No current Group Id set. It must be set."));
    }

    const configOptions = app.get('loopback-component-access-groups');
    if (!configOptions) {
      return next(new Error("No loopback-component-access-groups options object found."));
    }

    const GroupAccessModel = app.models[configOptions.groupAccessModel]

    // detect if we're handling a single instance or many
    const isSingleInstance = !Array.isArray(ctx.result)

    // this will hold all the users that should be returned as results
    var toReturn = isSingleInstance ? {} : []

    // this holds all data being processed
    const toProcess = isSingleInstance ? [result] : result

    // get the list of users with GroupAccesses (roles) matching the current group id
    var filter = {
      where: {}
    }
    filter.where[configOptions.groupKey] = curGroupId
    GroupAccessModel.find(filter, function(err, groupAccesses){
      if (err) { return next(err) }
      
      toProcess.forEach(function(curItem){

        // ensure we're working on a User model
        if (curItem.constructor.modelName === configOptions.userModel){

          // build a filter to match the current user and current group ids
          var roleFilter = {}
          roleFilter[configOptions.userKey] = curItem.id
          roleFilter[configOptions.groupKey] = curGroupId

          // filter the Group Access (roles) list
          const rolesFound = _filter(groupAccesses, roleFilter)

          // if the GroupAccesses are included, remove 

          // if a role was found, set it, and add it to the results to return
          if (rolesFound.length === 1){
            curItem.role = rolesFound[0].role
            toReturn.push(curItem)
            debug(`added ${curItem.role} to ${curItem.email} results`)
          }
        }
      })

      // set the newly filtered results before returning
      if (isSingleInstance && toReturn.length === 1){
        ctx.result = toReturn[0]
      } else {
        ctx.result = toReturn
      }
      
      return next()
    });
  }

  /**
   * For each Group being returned, this:
   * 1. filters them according to the current users' AccessGroups
   * 2. decorates them with the current User's associated role for the
   * current Group (determined from context)
   */
  filterAndAddRolesToGroups(ctx, result, next){
    debug(`filterAndAddRolesToGroups() on ${ctx.methodString}`);
    
    // press on if there is no ctx.result
    if (!ctx.result){
      debug(`skipping filterAndAddRolesToGroups() because no ctx.result`)
      return next()
    }

    if (ctx.method.name === "login" || ctx.method.name === "logout"){
      debug(`skipping filterAndAddRolesToGroups() on ${ctx.methodString}`)
      return next()
    }

    // grab (from context)
    // 1. a ref to the app
    // 2 the group id with which this user associated this request
    const app = ctx.args.options.app
    const curUserId = ctx.args.options.currentUserId

    // check for errors
    if (!app) {
      return next(new Error("No app object found."));
    }
    if (!curUserId) {
      return next(new Error("No current User Id set. It must be set."));
    }

    const configOptions = app.get('loopback-component-access-groups');
    if (!configOptions) {
      return next(new Error("No loopback-component-access-groups options object found."));
    }

    const GroupAccessModel = app.models[configOptions.groupAccessModel]

    // detect if we're handling a single instance or many
    const isSingleInstance = !Array.isArray(ctx.result)

    // this will hold all the users that should be returned as results
    var toReturn = isSingleInstance ? {} : []

    // this holds all data being processed
    var toProcess = isSingleInstance ? [result] : result

    // get the list of users with GroupAccesses (roles) matching the current user id
    var filter = {
      where: {}
    }
    filter.where[configOptions.userKey] = curUserId
    GroupAccessModel.find(filter, function(err, groupAccesses){
      if (err) { return next(err) }
      
      toProcess.forEach(function(curItem){

        // ensure we're working on a Group model
        if (curItem.constructor.modelName === configOptions.groupModel){

          // build a filter to match the current user and current group ids
          var roleFilter = {}
          roleFilter[configOptions.userKey] = curUserId
          roleFilter[configOptions.groupKey] = curItem.id

          // filter the Group Access (roles) list
          const rolesFound = _filter(groupAccesses, roleFilter)

          // if a role was found, set it, and add it to the results to return
          if (rolesFound.length === 1){
            curItem.myRole = rolesFound[0].role
            toReturn.push(curItem)
            debug(`added ${curItem.myRole} to ${curItem.name} results`)
          }
        }
      })

      // set the newly filtered results before returning
      if (isSingleInstance && toReturn.length === 1){
        ctx.result = toReturn[0]
      } else {
        ctx.result = toReturn
      }
      
      return next()
    });
  }

  /**
   * Add operation hooks to limit access for User Models
   */
  setupFiltersAndHooksForUserModel() {
    debug(`setupFiltersAndHooksForUserModel() ${this.options.userModel}`);
    const UserModel = this.app.models[this.options.userModel];

    // include the User's GroupAccesses in successful login results
    UserModel.afterRemote('login', this.addAccountRolesOnLogin);

    // we must filter these AFTER the query because we depend on the GroupAccessModel
    // data to determine if there is a relationship between each User and current Group

    // This next line hooks all methods, not ideal for user creation
    // UserModel.afterRemote('**', this.filterAndAddRolesToUsers);

    // PersistedModel STATIC METHODS ('*.*' matches any STATIC method)
    // Adjust as necessary
    UserModel.afterRemote('*.bulkUpdate', this.filterAndAddRolesToUsers);
    UserModel.afterRemote('*.changes', this.filterAndAddRolesToUsers);
    // UserModel.afterRemote('*.checkpoint', this.filterFn);
    // UserModel.afterRemote('*.count', this.filterFn);
    UserModel.afterRemote('*.create', this.filterAndAddRolesToUsers);
    // UserModel.afterRemote('*.createChangeFilter', this.filterFn);
    // UserModel.afterRemote('*.createChangeStream', this.filterFn);
    // UserModel.afterRemote('*.createUpdates', this.filterFn);
    // UserModel.afterRemote('*.currentCheckpoint', this.filterFn);
    // UserModel.afterRemote('*.destroyAll', this.filterFn);
    // UserModel.afterRemote('*.destroyById', this.filterFn);
    // UserModel.afterRemote('*.diff', this.filterFn);
    // UserModel.afterRemote('*.enableChangeTracking', this.filterFn);
    // UserModel.afterRemote('*.exists', this.filterFn);
    UserModel.afterRemote('*.find', this.filterAndAddRolesToUsers);
    UserModel.afterRemote('*.findById', this.filterAndAddRolesToUsers);
    UserModel.afterRemote('*.findOne', this.filterAndAddRolesToUsers);
    UserModel.afterRemote('*.findOrCreate', this.filterAndAddRolesToUsers);
    // UserModel.afterRemote('*.getChangeModel', this.filterFn);
    // UserModel.afterRemote('*.getIdName', this.filterFn);
    // UserModel.afterRemote('*.getSourceId', this.filterFn);
    // UserModel.afterRemote('*.handleChangeError', this.filterFn);
    // UserModel.afterRemote('*.rectifyChange', this.filterFn);
    UserModel.afterRemote('*.replaceById', this.filterAndAddRolesToUsers);
    UserModel.afterRemote('*.replaceOrCreate', this.filterAndAddRolesToUsers);
    UserModel.afterRemote('*.replicate', this.filterAndAddRolesToUsers);
    UserModel.afterRemote('*.updateAll', this.filterAndAddRolesToUsers);
    UserModel.afterRemote('*.upsert', this.filterAndAddRolesToUsers);
    UserModel.afterRemote('*.upsertWithWhere', this.filterAndAddRolesToUsers);

    // PersistedModel INSTANCE METHODS ('prototype.*' matches any INSTANCE method)
    // Adjust as necessary
    // UserModel.afterRemote('*.destroy', this.filterFn);
    UserModel.afterRemote('*.fillCustomChangeProperties', this.filterAndAddRolesToUsers);
    // UserModel.afterRemote('*.getId', this.filterFn);
    // UserModel.afterRemote('*.getIdName', this.filterFn);
    // UserModel.afterRemote('*.isNewRecord', this.filterFn);
    UserModel.afterRemote('*.reload', this.filterAndAddRolesToUsers);
    UserModel.afterRemote('*.replaceAttributes', this.filterAndAddRolesToUsers);
    // UserModel.afterRemote('*.save', this.filterFn);
    UserModel.afterRemote('*.setId', this.filterAndAddRolesToUsers);
    UserModel.afterRemote('*.updateAttribute', this.filterAndAddRolesToUsers);
    UserModel.afterRemote('*.updateAttributes', this.filterAndAddRolesToUsers);

    // ACCESS Notes
    // Show only those users who have a role with my current group
    // 
    // 1. find all AccessGroups WHERE AccessGroup.groupKey === options.currentGroupId
    // 2. and INCLUDE all Users
    // 3. if specific userId is set, ensure WHERE also has AccessGroup.userKey set to match it
    //
    // consolidate User objects into their own array, adding a role property, and return this?
    this.setupAccessFilter(UserModel);

    // TODO filter CREATE/UPDATE
    //
    // might need to unset any role property if it has been set
    // roles for users will have to be updated through a call to AccountRole API
    
    // TODO filter DELETE
    //
    // consider never deleting, but rather "archiving/deactivating"
    // again, this could be at either a User or AccessGroup level
    // THIS WOULD MEAN ADDING A CRITERIA TO THE WHERE FILTER OF ACCESS HOOKS...
  }

  /**
   * Add operation hooks to limit access on Group models
   */
  setupFiltersAndHooksForGroupModel() {
    debug(`setupFiltersAndHooksForGroupModel() ${this.options.groupModel}`);
    const GroupModel = this.app.models[this.options.groupModel];
    
    // we must filter these AFTER the query because we depend on the GroupAccessModel
    // data to determine if there is a relationship between current User and each Group

    // This next line hooks all methods, not ideal for new group creation
    // GroupModel.afterRemote('**', this.filterAndAddRolesToGroups);

    // PersistedModel STATIC METHODS ('*.*' matches any STATIC method)
    // Adjust as necessary
    GroupModel.afterRemote('*.bulkUpdate', this.filterAndAddRolesToGroups);
    GroupModel.afterRemote('*.changes', this.filterAndAddRolesToGroups);
    // GroupModel.afterRemote('*.checkpoint', this.filterFn);
    // GroupModel.afterRemote('*.count', this.filterFn);
    GroupModel.afterRemote('*.create', this.filterAndAddRolesToGroups);
    // GroupModel.afterRemote('*.createChangeFilter', this.filterFn);
    // GroupModel.afterRemote('*.createChangeStream', this.filterFn);
    // GroupModel.afterRemote('*.createUpdates', this.filterFn);
    // GroupModel.afterRemote('*.currentCheckpoint', this.filterFn);
    // GroupModel.afterRemote('*.destroyAll', this.filterFn);
    // GroupModel.afterRemote('*.destroyById', this.filterFn);
    // GroupModel.afterRemote('*.diff', this.filterFn);
    // GroupModel.afterRemote('*.enableChangeTracking', this.filterFn);
    // GroupModel.afterRemote('*.exists', this.filterFn);
    GroupModel.afterRemote('*.find', this.filterAndAddRolesToGroups);
    GroupModel.afterRemote('*.findById', this.filterAndAddRolesToGroups);
    GroupModel.afterRemote('*.findOne', this.filterAndAddRolesToGroups);
    GroupModel.afterRemote('*.findOrCreate', this.filterAndAddRolesToGroups);
    // GroupModel.afterRemote('*.getChangeModel', this.filterFn);
    // GroupModel.afterRemote('*.getIdName', this.filterFn);
    // GroupModel.afterRemote('*.getSourceId', this.filterFn);
    // GroupModel.afterRemote('*.handleChangeError', this.filterFn);
    // GroupModel.afterRemote('*.rectifyChange', this.filterFn);
    GroupModel.afterRemote('*.replaceById', this.filterAndAddRolesToGroups);
    GroupModel.afterRemote('*.replaceOrCreate', this.filterAndAddRolesToGroups);
    GroupModel.afterRemote('*.replicate', this.filterAndAddRolesToGroups);
    GroupModel.afterRemote('*.updateAll', this.filterAndAddRolesToGroups);
    GroupModel.afterRemote('*.upsert', this.filterAndAddRolesToGroups);
    GroupModel.afterRemote('*.upsertWithWhere', this.filterAndAddRolesToGroups);

    // PersistedModel INSTANCE METHODS ('prototype.*' matches any INSTANCE method)
    // Adjust as necessary
    // GroupModel.afterRemote('*.destroy', this.filterFn);
    GroupModel.afterRemote('*.fillCustomChangeProperties', this.filterAndAddRolesToGroups);
    // GroupModel.afterRemote('*.getId', this.filterFn);
    // GroupModel.afterRemote('*.getIdName', this.filterFn);
    // GroupModel.afterRemote('*.isNewRecord', this.filterFn);
    GroupModel.afterRemote('*.reload', this.filterAndAddRolesToGroups);
    GroupModel.afterRemote('*.replaceAttributes', this.filterAndAddRolesToGroups);
    // GroupModel.afterRemote('*.save', this.filterFn);
    GroupModel.afterRemote('*.setId', this.filterAndAddRolesToGroups);
    GroupModel.afterRemote('*.updateAttribute', this.filterAndAddRolesToGroups);
    GroupModel.afterRemote('*.updateAttributes', this.filterAndAddRolesToGroups);

    // ACCESS Notes
    //
    // Ensure that:
    // a. Users can READ any Group they have an AccessGroup mapping them to
    // b. default to always return the whole list (INQ), knowing that if a user asks for a specific one, they can get it?
    //
    // To implement:
    // 1. find all AccessGroups WHERE AccessGroup.userKey === options.currentUserId
    // 2. and INCLUDE all Groups
    // 3. if specific userId is set, match it
    this.setupAccessFilter(GroupModel);

    // TODO filter CREATE/UPDATE
    
    // TODO filter DELETE
    //
    // consider never deleting, but rather "archiving/deactivating"
    // again, this could be at either a User or AccessGroup level
    // THIS WOULD MEAN ADDING A CRITERIA TO THE WHERE FILTER OF ACCESS HOOKS...
  }

  /**
   * Add operation hooks to limit access on GroupAccess model
   */
  setupFiltersAndHooksForGroupAccessModel() {
    debug(`setupFiltersAndHooksForGroupAccessModel() ${this.options.groupAccessModel}`);
    const GroupAccessModel = this.app.models[this.options.groupAccessModel];

    // ACCESS Notes
    //
    // 1. If group ID is set, then show only those AccessGroups with a role === group ID
    // 2. If no group ID is set, then show all AccessGroups INQ all of the current User's AccessGroups
    this.setupAccessFilter(GroupAccessModel);

    // TODO filter CREATE/UPDATE
    
    // TODO filter DELETE
    //
    // consider never deleting, but rather "archiving/deactivating"
    // again, this could be at either a User or AccessGroup level
    // THIS WOULD MEAN ADDING A CRITERIA TO THE WHERE FILTER OF ACCESS HOOKS...
  }

  /**
   * Add operation hooks to limit access on all "regular" models that contain data
   * belonging to a specific group
   */
  setupFiltersAndHooksForGroupContentModels() {
    const models = this.accessUtils.getGroupContentModels();

    models.forEach(modelName => {
      const Model = this.app.models[modelName]

      if (typeof Model.observe === 'function') {
        debug(`setupFiltersAndHooksForGroupContentModels() ${modelName} `)

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
      // current user and group/tenant context have been set by Tenant MIXIN and are in ctx.options
      if (ctx.options.currentUser) {
        debug(`'access' hook intercepted ${ctx.options.method.stringName} [${ctx.options.method.accessType}]`)

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
   * Observe any CREATE/UPDATE event on Model
   * 
   * @param {Model} modelObj The Model to attach the filter to.
   */
  setupBeforeSaveFilter(modelObj){
    debug(`attaching 'before save' filter to ${modelObj.modelName}`)

    modelObj.observe('before save', function event(ctx, next) {
      debug(`'before save' hook intercepted ${ctx.options.method.stringName} [${ctx.options.method.accessType}]`)

      // handle special cases where we don't know if we are creating or updating
      if (ctx.options.method.name === "updateOrCreate" || ctx.options.method.name === "upsertWithWhere"){
        // NOTE: these do not provide an instance in the “before save” hook.
        // Since it’s impossible tell in advance whether the operation will result in UPDATE or CREATE,
        // there is no way to know whether an existing “currentInstance” is affected by the operation

        // TODO handle this
        debug(`detected ${ctx.options.method.name}`);
      }

      if (ctx.isNewInstance) {
        // distinguish between CREATE and UPDATE
        // NOTE: likely only useful on 'after save'
        debug(`isNewInstance true`);
      }

      if (ctx.instance) {
        // MODIFIABLE OBJECT TO SAVE
        // ctx.instance is provided when the operation affects a single instance and
        // performs a full update/create/delete of all model properties
        
        debug(`ctx.instance present`)
        
        // set the accountId to the current group
        ctx.instance.$accountId = ctx.options.currentGroupId;
      }
      
      if (ctx.currentInstance){
        // READ-ONLY EXISTING OBJECT AS-IS FROM DATABASE
        // only present if we're updating an existing instance
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
      debug(`'before delete' hook intercepted ${ctx.options.method.stringName} [${ctx.options.method.accessType}]`)

      // NOTE: only ctx.Model and ctx.where are available, and 'access' hooks
      // already add the group id to the where filter, so not clear if this is necessary

      if (ctx.where){
        // present when affecting mult objects OR a few properties of 1+ objects
        debug(`ctx.where present`)
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
    const key = this.accessUtils.isGroupModel(Model) ? Model.getIdName() : this.options.groupKey
    
    // we don't filter the following according to current context because
    // 1. users and groups' relationship isnt a filterable attribute on their model
    // 2. individual users have a need to see all of their groups and accesses
    const isUserGroupOrAccessModel = this.accessUtils.isUserModel(Model) ||
                                     this.accessUtils.isGroupModel(Model) ||
                                     this.accessUtils.isGroupAccessModel(Model)

    // if groupId is set, then restrict results to only that group
    if (groupId && !isUserGroupOrAccessModel){
      filter[key] = groupId;
      process.nextTick(() => cb(null, filter))
    }

    // if no group id is set, then return anything that belongs to all groups the user belongs to
    else {
      this.accessUtils.getAccessGroupsForUser(userId)
        .then(accessGroups => {
          accessGroups = Array.from(accessGroups, group => group[this.options.groupKey])
          filter[key] = { inq: accessGroups }
          cb(null, filter);
        })
    }

    return cb.promise;
  }

}