'use strict'

const debug = require('debug')('loopback:component:access')
const AccessUtils = require('./utils')
const AccessRoleResolvers = require('./role-resolvers')
const AccessModelFilters = require('./model-filters')
const accessLogger = require('./middleware/access-logger')
const userContext = require('./middleware/user-context')
const groupContext = require('./middleware/group-context')
const methodContext = require('./middleware/method-context')
const updateUserGroupAccessed = require('./middleware/update-user-group-accessed')

module.exports = function loopbackComponentAccess(app, options) {
  debug('initializing component')
  const { loopback } = app
  const loopbackMajor = (loopback && loopback.version && loopback.version.split('.')[0]) || 1

  if (loopbackMajor < 3) {
    throw new Error('loopback-component-access-groups requires loopback 3.0 or newer')
  }

  // Initialise helper classes
  const accessUtils = new AccessUtils(app, options)
  app.accessUtils = accessUtils

  const accessModelFilters = new AccessModelFilters(app, options)
  app.accessModelFilters = accessModelFilters

  const accessRoleResolvers = new AccessRoleResolvers(app, options)
  app.accessRoleResolvers = accessRoleResolvers

  // Initialize middleware
  app.middleware('initial:after', methodContext())
  app.middleware('auth:after', groupContext())
  app.middleware('auth:after', userContext())
  app.middleware('routes:before', accessLogger())
  app.middleware('routes:before', updateUserGroupAccessed())

  // Set up role resolvers.
  accessRoleResolvers.setupRoleResolvers()

  // Set up model opertion hooks.
  if (options.applyToStatic) {
    accessModelFilters.setupFilters()
  }

// TODO: Create Group Access model automatically if one hasn't been specified
}
