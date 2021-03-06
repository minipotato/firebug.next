/* See license.txt for terms of usage */
/* jshint esnext: true */
/* global require: true, exports: true, module: true */

"use strict";

var main = require("../../main.js");
const self = require("sdk/self");
const options = require("@loader/options");

const { Ci, Cu, Cc } = require("chrome");
const { Rdp } = require("../../core/rdp.js");
const { Trace, TraceError } = require("../../core/trace.js").get(module.id);
const { MonitorFront } = require("./monitor-front.js");
const { LoggerFront } = require("./logger-front.js");
const { defer } = require("sdk/core/promise");
const { target } = require("../../target.js");

const { gDevTools } = Cu.import("resource:///modules/devtools/gDevTools.jsm", {});

/**
 * This module is responsible for dynamic registration of {@LoggerActor}
 * object on the backend. The registration is done through
 * {@ActorRegistryFront} object that sends implementation source
 * code of the actor (over RDP) to the backend where it's evaluated.
 *
 * The {@LoggerActor} parses headers of each HTTP requests and looks
 * for server side logs. A log coming from HTTP server is sent back
 * to the client side and rendered in the Console panel.
 */
var RemoteLogging =
/** @lends RemoteLogging */
{
  // Initialization

  initialize: function(Firebug) {
    Trace.sysout("remoteLogging.initialize;");

    this.initDeferred = defer();
    return this.initDeferred.promise;
  },

  shutdown: function(Firebug) {
    Trace.sysout("remoteLogging.shutdown;");

    // Unregister back-end actors on shutdown/disable/uninstall
    this.unregisterActors();
  },

  // Toolbox Events

  onToolboxReady: function(eventId, toolbox) {
    Trace.sysout("remoteLogging.onToolboxReady;", toolbox);

    // Logger actors are registered when the toolbox is opened
    // for the first time.
    this.registerActors(toolbox);
  },

  onToolboxDestroy: function(eventId, target) {
    Trace.sysout("remoteLogging.onToolboxDestroy;", target);

    // xxxHonza: We don't have to detach explicitly when the toolbox
    // is closed. The frameworks will automatically call 'disconnect'
    // on the actor when the connection is closed.
    // However we should detach the actor when server side logging is
    // of and attach again when it's on. FIXME
    /*let logger = loggers.get(target);
    logger.detach().then(() => {
      Trace.sysout("remoteLogging.onToolboxDestroyed; logger detached ",
        arguments);
    });*/
  },

  // Actors Registration

  registerActors: function(toolbox) {
    // Dynamically register an actor on the backend (can be a remote device)
    // The backend needs to set "devtools.debugger.forbid-certified-apps"
    // to false to make this work.
    // See also: https://bugzilla.mozilla.org/show_bug.cgi?id=977443#c13
    // This will probably change in the future. There should be just one
    // checkbox on the remote device saying "Enable debugging"...

    // Step by step register both, the Monitor actor (in the parent process)
    // that listens for HTTP events and the Logger actor (in the child
    // process) that parses received (from the parent) HTTP headers and
    // sends back server side logs.

    const baseUri = options.prefixURI;

    // xxxHonza: as soon as: https://bugzilla.mozilla.org/show_bug.cgi?id=11119794
    // is fixed, the prefix isn't necessary (but keep back compatibility).
    let monitorOptions = {
      prefix: "firebugMonitor", // TODO remove
      actorClass: "MonitorActor",
      frontClass: MonitorFront,
      type: { global: true },
      moduleUrl: baseUri + "lib/console/remote/monitor-actor.js"
    };

    let loggerOptions = {
      prefix: "firebugLogger", // TODO remove
      actorClass: "LoggerActor",
      frontClass: LoggerFront,
      type: { tab: true },
      moduleUrl: baseUri + "lib/console/remote/logger-actor.js"
    };

    // Register monitor (global) actor (observing HTTP-* events) and
    // logger (tab) actor. Note that the result registrar object is
    // available only when the actor is actually registered for the
    // first time; otherwise it's only attached and so, only the front
    // object is passed in.
    let client = toolbox.target.client;
    Rdp.registerActor(client, monitorOptions).then(({registrar, front}) => {
      if (registrar) {
        this.monitorRegistrar = registrar;
      }

      // Register logger actor (sending server side logs to the client).
      Rdp.registerActor(client, loggerOptions).then(({registrar, front}) => {
        if (registrar) {
          this.loggerRegistrar = registrar;
        }

        Trace.sysout("logging.onToolboxReady; Actor registration done");

        // Initialization done now.
        this.initDeferred.resolve(true);
      });
    });
  },

  unregisterActors: function() {
    if (this.loggerRegistrar) {
      this.loggerRegistrar.unregister().then(() => {
        Trace.sysout("remoteLogging.onToolboxDestroyed; logger actor " +
          "unregistered", arguments);
      });
      this.loggerRegistrar = null;
    }

    if (this.monitorRegistrar) {
      this.monitorRegistrar.unregister().then(() => {
        Trace.sysout("remoteLogging.onToolboxDestroyed; monitor actor " +
          "unregistered", arguments);
      });
      this.monitorRegistrar = null;
    }
  }
};

// Registration
//target.register(RemoteLogging);

// Exports from this module
exports.RemoteLogging = RemoteLogging;
