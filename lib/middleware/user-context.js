'use strict';

const debug = require('debug')('loopback:component:access:user-context')
const Promise = require('bluebird')

module.exports = function userContextMiddleware() {
  debug('initializing user context middleware')
  // set current user to enable user access for remote methods
  return function userContext(req, res, next) {
    debug('parsing user context from HTTP Req')
    req.args = req.args || {};
    req.args.options = req.args.options || {};

    if (!req.accessToken) {
      debug('No user context (access token not found)')
      return next()
    }

    // save the accessToken to the options
    req.args.options.accessToken = req.accessToken;

    const { app } = req

    const UserModel = app.accessUtils.options.userModel || 'User'

    return Promise.join(
      app.models[UserModel].findById(req.accessToken.userId),
      app.accessUtils.getAccessGroupsForUser(req.accessToken.userId),
      (user, groups) => {
        if (!user) {
          return next(new Error('No user with this access token was found.'))
        }

        // set the current user and its groups in options
        req.args.options.currentUser = user;
        req.args.options.currentUserId = (user ? user.id : undefined);
        req.args.options.currentAccessGroups = groups;

        debug('currentUser', user)
        debug('currentAccessGroups', groups)
        return next()
      })
      .catch(next)
  }
}
