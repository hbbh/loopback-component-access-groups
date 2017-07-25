'use strict'

const debug = require('debug')('loopback:component:access')
const AccessUtils = require('./utils')
const accessLogger = require('./middleware/access-logger')
const userContext = require('./middleware/user-context')
const groupContext = require('./middleware/group-context')

module.exports = function loopbackComponentAccess(app, options) {
  debug('initializing component')
  const { loopback } = app
  const loopbackMajor = (loopback && loopback.version && loopback.version.split('.')[0]) || 1

  if (loopbackMajor < 3) {
    throw new Error('loopback-component-access-groups requires loopback 3.0 or newer')
  }

  // Initialise helper class.
  const accessUtils = new AccessUtils(app, options)

  // Make accessUtils available globally at runtime to the rest of loopback
  app.accessUtils = accessUtils

  // Initialize middleware
  app.middleware("auth:after", groupContext())
  app.middleware('auth:after', userContext())
  app.middleware('routes:before', accessLogger())

  // Set up role resolvers.
  accessUtils.setupRoleResolvers()

  // Set up model opertion hooks.
  if (options.applyToStatic) {
    accessUtils.setupFilters()
  }

// TODO: Create Group Access model automatically if one hasn't been specified
}
