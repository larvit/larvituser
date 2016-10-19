'use strict';

const	EventEmitter	= require('events').EventEmitter,
	eventEmitter	= new EventEmitter(),
	dbmigration	= require('larvitdbmigration')({'tableName': 'users_db_version', 'migrationScriptsPath': __dirname + '/dbmigration'}),
	lUtils	= require('larvitutils'),
	uuidLib	= require('node-uuid'),
	bcrypt	= require('bcryptjs'),
	async	= require('async'),
	log	= require('winston'),
	db	= require('larvitdb');

let	readyInProgress	= false,
	isReady	= false,
	intercom;

function ready(cb) {
	if (isReady === true) { cb(); return; }

	if (readyInProgress === true) {
		eventEmitter.on('ready', cb);
		return;
	}

	readyInProgress	= true;
	intercom	= lUtils.instances.intercom; // We must do this here since it might not be instanciated on module load

	// We are strictly in need of the intercom!
	if ( ! (intercom instanceof require('larvitamintercom'))) {
		const	err	= new Error('larvitutils.instances.intercom is not an instance of Intercom!');
		log.error('larvituser: index.js - ' + err.message);
		throw err;
	}

	dbmigration(function(err) {
		if (err) {
			log.error('larvituser: orders.js: Database error: ' + err.message);
			return;
		}

		isReady	= true;
		eventEmitter.emit('ready');

		cb();
	});
}

/**
 * Checks a password for validity
 *
 * @param str password - plain text password
 * @param str hash - hash to check password against
 * @param func cb(err, res) res is boolean
 */
function checkPassword(password, hash, cb) {
	password = password.trim();

	bcrypt.compare(password, hash, function(err, result) {
		if (err) {
			log.error('larvituser: checkPassword() - ' + err.message);
		}

		cb(err, result);
	});
}

function create(username, password, userData, cb) {
	const	tasks	= [];

	let	hashedPassword;

	if (userData instanceof Function) {
		cb	= userData;
		userData	= undefined;
	} else if (cb === undefined) {
		cb	= function() {};
	}

	username = _.trim(username);

	if (password) {
		password = _.trim(password);
	}

	if (username.length === 0) {
		const	err = new Error('Trying to create user with empty username');
		log.warn('larvituser: create() - ' + err.message);
		cb(err);
		return;
	}

	tasks.push(ready);

	// Check for username availability
	tasks.push(function(cb) {
		usernameAvailable(username, function(err, result) {
			if (err) { cb(err); return; }

			if (result === true) {
				log.debug('larvituser: create() - Username available: "' + username + '"');
				cb();
			} else {
				const err = new Error('Trying to create user with taken username: "' + username + '"');
				log.info('larvituser: create() - ' + err.message);
				cb(err);
			}
		});
	});

	// Hash Password
	tasks.push(function(cb) {
		if (password === false) {
			log.debug('larvituser: create() - Password set to empty string for no-login, username: "' + username + '"');
			hashedPassword	= '';
			cb();
			return;
		}

		hashPassword(password, function(err, hash) {
			if (err) { cb(err); return; }

			hashedPassword	= hash;
			log.debug('larvituser: create() - Password hashed, username: "' + username + '"');
			cb();
		});
	});

	// Send to queue
	tasks.push(function(cb) {
		const	userUuid	= uuidLib.v4(),
			sendObj	= {};

		sendObj.action	= 'createUser';
		sendObj.params	= {};
		sendObj.params.uuid	= userUuid;
		sendObj.params.username	= username;
		sendObj.params.hashedPassword	= hashedPassword;
		sendObj.params.userData	= userData;

		intercom.send(sendObj, {'exchange': 'users'}, cb);
	});

	async.series(tasks, cb);
}

/**
 * Hashes a new password
 *
 * @param str password
 * @param func cb(err, hash)
 */
function hashPassword(password, cb) {
	password = _.trim(password);

	bcrypt.hash(password, 10, function(err, hash) {
		if (err) {
			log.error('larvituser: hashPassword() - ' + err.message);
		}

		cb(err, hash);
	});
}

/**
 * Checks if a unsername is available
 *
 * @param str username
 * @param func cb(err, result) - result is a bolean
 */
function usernameAvailable(username, cb) {
	const	tasks	= [];

	let	isAvailable;

	username = username.trim();

	tasks.push(ready);

	tasks.push(function(cb) {
		db.query('SELECT uuid FROM user_users WHERE username = ?', [username], function(err, rows) {
			if (err) { cb(err); return; }

			if (rows.length === 0) {
				isAvailable = true;
			} else {
				isAvailable = false;
			}

			cb();
		});
	});

	async.series(tasks, function(err) {
		if (err) { cb(err); return; }

		cb(null, isAvailable);
	});
}

exports.checkPassword	=	checkPassword;
exports.create	= create;
exports.getFieldUuid	= getFieldUuid;
exports.hashPassword	= hashPassword;
exports.ready	= ready;
exports.usernameAvailable	= usernameAvailable;
Object.assign(exports, require(__dirname + '/helpers.js')); // extend this module with all helpers from the helpers file
