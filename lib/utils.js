'use strict'

const debug = require('debug')('loopback:component:access:utils')
const { createPromiseCallback } = require('loopback-datasource-juggler/lib/utils')
const _defaults = require('lodash').defaults
const _get = require('lodash').get
const Promise = require('bluebird')

module.exports = class AccessUtils {
  constructor(app, options) {
    this.app = app
    this.options = AccessUtils.parseConfigOptions(app, options);
  }

  /**
   * Parse the supplied configuration options
   */
  static parseConfigOptions(app, optionsObj){
    var expressAppSettingsStorageKey = 'loopback-component-access-groups'

    // check to see if we've parsed options before in another component
    var existingSettings = app.get(expressAppSettingsStorageKey)
    if (existingSettings){
      debug(`found existing settings for ${expressAppSettingsStorageKey}`)
      return existingSettings;
    }

    var parsedOptions = _defaults({ }, optionsObj, {
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
    parsedOptions.groupKey = parsedOptions.groupKey || `${parsedOptions.groupModel.toLowerCase()}Id`

    // Default the userKey to the group model name + Id.
    parsedOptions.userKey = parsedOptions.userKey || `${parsedOptions.userModel.toLowerCase()}Id`

    // Validate the format of options.groupRoles ($group:[role]).
    parsedOptions.groupRoles.forEach(name => {
      if (!AccessUtils.isValidPrincipalId(name)) {
        throw new Error('$name is an invalid access group name.')
      }
    })

    // Save the component config for easy reference.
    app.set(expressAppSettingsStorageKey, parsedOptions)
    
    debug('returning parsed options: %o', parsedOptions)

    return parsedOptions;
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
   * Extract the user from the HTTP request
   *
   * @param {String} req The HTTP request object
   * @returns {Object} Returns the User object if req.accessToken is defined and valid
   */
   extractUserFromHTTPRequest(req) {
    const userKey = this.options.userKey.toLowerCase();
    const userModel = this.app.models[this.options.userModel];

    return new Promise(function(resolve, reject){
      if (req){
        if (userKey in req.headers){
          // extract the group Id from the header
          const userId = req.headers[userKey];

          if (userId){
            // fetch the group for the group Id
            userModel.findById(userId, function(err, groupObj){
              if (err) reject(err);

              if (!groupObj) {
                debug('No group found matching id ' + userId);
              }

              debug('Found group matching id ' + userId);
              resolve(groupObj);
            });
          } else {
            debug('HTTP Req ' + userKey + ' property is present but undefined')
            resolve(undefined);
          }
        } else {
          debug('HTTP Req does not contain ' + userKey + ' property')
          resolve(undefined);
        }
      } else {
        debug('HTTP Req undefined')
        resolve(undefined);
      }
    });
  }

  /**
   * Extract the group/tenant from the HTTP request
   *
   * @param {String} req The HTTP request object
   * @returns {Object} Returns the Group object if the group id was set in the header and a group matching the id is found
   */
   extractGroupFromHTTPRequest(req) {
    const groupKey = this.options.groupKey.toLowerCase();
    const groupModel = this.app.models[this.options.groupModel];

    return new Promise(function(resolve, reject){
      if (req){
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
   * NOTE: DOES NOT SEEM TO WORK AS OF 2017-JUL-25 BECAUSE OPERATION HOOKS PRECEDE THIS
   * Builds options before remote method calls
   * 
   * It is important to use this method in Loopback 3 because this handles internally-invoked commands.
   * For instance, an internal JS call to Model.findById will not include context options unless explicitly
   * passed when invoked.
   */
  // buildContextForMethodCalls(){
  //   debug(`buildContextForMethodCalls()`)

  //   // this exists here so that the user and related data needed by hooks,
  //   // is all loaded regardless of which remote method includes the data
  //   this.app.remotes().before('**', (ctx, next) => {

  //     debug(`buildContextForMethodCalls intercepting 'before remote'`)

  //     // create the options object if it doesn't exist
  //     ctx.req.args = ctx.req.args || {}
  //     ctx.req.args.options = ctx.req.args.options || {}

  //     if (ctx.req.accessToken && ctx.req.accessToken.userId) {
  //         // TODO
          
  //         Promise.join(
  //           this.extractUserFromHTTPReq(ctx.req),
  //           this.getAccessGroupsForUser(ctx.req.accessToken.userId),
  //           this.extractGroupFromHTTPRequest(ctx.req),
  //           function(user, accessGroups, group){
  //             debug(`extracted user, accessGroups, and group from HTTP Request`)

  //             // add these to the options context
  //             ctx.req.args.options.currentUser = user
  //             ctx.req.args.options.currentUserId = user.getId()
  //             ctx.req.args.options.currentGroup = group
  //             ctx.req.args.options.currentGroupId = group.getId()
  //             ctx.req.args.options.currentAccessGroups = accessGroups

  //             next();
  //           }
  //         );
  //     } else {
  //         next();
  //     }
  //   });
  // }
}