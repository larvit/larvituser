'use strict';

if (require.main === module) require('dotenv').config();

const topLogPrefix = 'larvituser: ./src/server.js: ';
const server = require('./src/server');
const LUtils = require('larvitutils');
const lUtils = new LUtils();

// Check if this script is requested from the command line
if (require.main === module) {
	let logLevel = process.env.LOG_LVL;
	let port = process.env.PORT;
	let log;

	if (!logLevel) {
		log = new lUtils.Log('verbose');
		log.verbose(topLogPrefix + 'No LOG_LVL environment variable found, defaulting to "verbose"');
	} else {
		log = new lUtils.Log(logLevel);
	}

	if (port === undefined) {
		log.verbose(topLogPrefix + 'No PORT environment variable found, defaulting to "3000"');
		port = 3000;
	}

	log.verbose(topLogPrefix + 'Starting http server');

	(async () => {
		await server({log, port});
	})();
} else {
	// NOT requested from the command line, lets just expose the server
	module.exports = server;
}
