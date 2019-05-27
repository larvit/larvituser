'use strict';

const topLogPrefix = 'larvituser: ./src/server.js: ';
const LUtils = require('larvitutils');
const lUtils = new LUtils();
const express = require('express');
const fs = require('fs');
const expressGraphQL = require('express-graphql');
const {buildSchema} = require('graphql');
const {users, user, createUser, replaceUser, updateUser, replaceUserField, addUserField, rmUserField} = require('./functions');

/**
 * Run the http server
 *
 * @param {object} options - options object
 * @param {Number} options.port - What port to start the server on
 * @param {object} [options.log] - Logging object
 * @param {Boolean} [options.graphiql] - default to false if NODE_ENV is production, otherwise true
 * @return {Promise} -
 */
async function server(options) {
	const logPrefix = topLogPrefix + 'server() - ';
	const app = express();

	// If the log option is missing, default it to verbose level
	if (!options.log) {
		options.log = new lUtils.Log('verbose');
		options.log.verbose(logPrefix + 'No log object provided, defaulting to "verbose" level');
	}

	if (options.graphiql === undefined) {
		if (process.env.NODE_ENV === 'production') {
			options.log.verbose(logPrefix + 'No graphiql option given and NODE_ENV is "production", setting graphiql to false');
			options.graphiql = false;
		} else {
			options.log.verbose(logPrefix + 'No graphiql option given and NODE_ENV is not "production", setting graphiql to true');
			options.graphiql = true;
		}
	}

	// Setting schema from the schema file
	const schema = buildSchema(fs.readFileSync(__dirname + '/schema.graphql', 'utf8'));

	// Spread options
	const {log, port, graphiql} = options;

	// Available "routes"
	const rootValue = {users, user, createUser, replaceUser, updateUser, replaceUserField, addUserField, rmUserField};

	app.use('/', expressGraphQL({schema, rootValue, graphiql}));

	return new Promise((resolve, reject) => {
		const listener = app.listen(port, err => {
			if (err) {
				log.error(logPrefix + 'Could not start http server, err: ' + err.message);

				return reject(err);
			}

			log.info(logPrefix + 'http server listening on port: "' + listener.address().port + '", serving GraphQL on /');
			resolve(listener);
		});
	});
}

module.exports = server;
