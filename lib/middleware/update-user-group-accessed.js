'use strict';

const debug = require('debug')('loopback:component:access:update-user-group-accessed')
const Promise = require('bluebird')

module.exports = function updateUserGroupAccessedMiddleware() {
  debug('initializing update user group accessed middleware')

  return function updateUserGroupAccessed(req, res, next) {
    debug('updating the date of last access for this user on this group')
    req.args = req.args || {};
    req.args.options = req.args.options || {};

    const { app } = req
    const GroupAccessModel = app.models[app.accessUtils.options.groupAccessModel || 'GroupAccess']

    // assumes that user and groud id have already been set by earlier middleware
    if (req.args.options.currentUserId && req.args.options.currentGroupId){
      // build our filter
      var filter = { where: {} }
      filter.where[app.accessUtils.options.userKey] = req.args.options.currentUserId
      filter.where[app.accessUtils.options.groupKey] = req.args.options.currentGroupId

      // find the Group Access model and update it if found
      GroupAccessModel.findOne(filter, function(err, accessModelInstance){
        if (err) return next(err);

        if (accessModelInstance){
          
          accessModelInstance.updateAttributes({ lastUsedAt: new Date() }, function(err, updatedInstance){
            if (err) return next(err);
            return next();
          });
          
        } else {
          return next(new Error(`No ${GroupAccessModel.modelName} model found for the user`));
        }
      });
    } else {
      return next();
    }
  }
}
