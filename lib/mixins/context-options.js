/**
 * @context-options.js
 * Builds the options object for Model operation hooks in order to make context
 * from the middleware stages available to the operation hooks
 *
 * To use this mixin on a model, it has to be declared like this in that model.json:
 * "mixins": {
 *   "ContextOptions": {}
 *  }
 */
'use strict';

(function () {

const debug = require('debug')('loopback:component:access:context-options')

module.exports = function (Model, options) {

    // This builds the OPTIONS object, at least for Model.observe() operation hooks...
    //
    // This assumes all of the relevant user, group, and group-accesses have already been
    // looked up and set by other middleware services that have already run
    Model.createOptionsFromRemotingContext = function(ctx) {
        var baseOptions = this.base.createOptionsFromRemotingContext(ctx);

        // carry forward the HTTP method
        baseOptions.method = ctx.method;

        // carry forward data already set by user-context.js middleware
        baseOptions.accessToken = ctx.req.args.options.accessToken;
        baseOptions.currentUser = ctx.req.args.options.currentUser;
        baseOptions.currentUserId = ctx.req.args.options.currentUserId;
        baseOptions.currentAccessGroups = ctx.req.args.options.currentAccessGroups;

        // carry forward data already set by group-context.js middleware
        baseOptions.currentGroup = ctx.req.args.options.currentGroup;
        baseOptions.currentGroupId = ctx.req.args.options.currentGroupId;

        return baseOptions;
    };
}
})();