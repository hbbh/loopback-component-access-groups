'use strict';

const debug = require('debug')('loopback:component:access:method-context')
const Promise = require('bluebird')

module.exports = function methodContextMiddleware() {
  debug('initializing method context middleware')

  // set current method context
  return function methodContext(req, res, next) {
    debug('parsing method context')
    req.args = req.args || {};
    req.args.options = req.args.options || {};

    const { app } = req

    req.args.options.method = req.method

    next()
  }
}
