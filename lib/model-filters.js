'use strict'

const debug = require('debug')('loopback:component:access:filters')
const { createPromiseCallback } = require('loopback-datasource-juggler/lib/utils')
const _defaults = require('lodash').defaults
const _get = require('lodash').get
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
    this.setupFiltersForUserModel();
    this.setupFiltersForGroupModel();
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

    // TODO filter ACCESS
    // Show only those users who have a role with my current group
    // 
    // 1. find all AccessGroups WHERE AccessGroup.groupKey === options.currentGroupId
    // 2. and INCLUDE all Users
    // 3. if specific userId is set, ensure WHERE also has AccessGroup.userKey set to match it
    //
    // consolidate User objects into their own array, adding a role property, and return this?

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
  setupFiltersForGroupModel() {
    debug(`setupFiltersForGroupModel() ${this.options.groupModel}`);
    const Model = this.app.models[this.options.groupModel];

    // TODO filter ACCESS
    //
    // Ensure that:
    // a. Users can READ any Group they have an AccessGroup mapping them to
    // b. default to always return the whole list (inq), knowing that if a user asks for a specific one, they can get it?
    //
    // To implement:
    // 1. find all AccessGroups WHERE AccessGroup.userKey === options.currentUserId
    // 2. and INCLUDE all Groups
    // 3. if specific userId is set, match it

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
  setupFiltersForGroupAccessModel() {
    debug(`setupFiltersForGroupAccessModel() ${this.options.groupAccessModel}`);
    const Model = this.app.models[this.options.groupAccessModel];

    // TODO filter ACCESS
    // Show only those users who have a role to my current group
    // 
    // find all AccessGroups WHERE AccessGroup.groupKey === options.currentGroupId and INCLUDE all Users
    //

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
  setupFiltersForGroupContentModels() {
    const models = this.accessUtils.getGroupContentModels();

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
      debug(`'access' hook intercepted ${ctx.options.method.stringName} [${ctx.options.method.accessType}]`)
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

    // if groupId is set, then restrict results to only that group
    if (groupId){
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