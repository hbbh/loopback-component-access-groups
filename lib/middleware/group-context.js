'use strict';

const debug = require('debug')('loopback:component:access:group-context')
const Promise = require('bluebird')

module.exports = function groupContextMiddleware() {
  debug('initializing group context middleware')

  // set current group based on value suplied by user in header
  return function groupContext(req, res, next) {
    debug('parsing group context from HTTP Req')
    req.args = req.args || {};
    req.args.options = req.args.options || {};

    const { app } = req

    // grab the group id from the headers
    app.accessUtils.extractGroupFromHTTPRequest(req).then(function(group){
      req.args.options.currentGroup = group;
      req.args.options.currentGroupId = (group ? group.id : undefined);

      return next();
    },
    function(err){
      return next(err);
    })
  }
}
