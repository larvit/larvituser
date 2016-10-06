'use strict';

const	dbmigration	= require('larvitdbmigration')({'tableName': 'users_db_version', 'migrationScriptsPath': __dirname + '/dbmigration'}),
	EventEmitter	= require('events').EventEmitter,
	eventEmitter	= new EventEmitter(),
	Intercom	= require('larvitamintercom').Intercom,
	conStr	= require(__dirname + '/config/amqp.json').default,
	intercom	= new Intercom(conStr),
	uuidLib	= require('node-uuid'),
	lUtils	= require('larvitutils'),
	async	= require('async'),
	log	= require('winston');

let	readyInProgress	= false,
	isReady	= false;

function ready(cb) {
	if (isReady === true) { cb(); return; }

	if (readyInProgress === true) {
		eventEmitter.on('ready', cb);
		return;
	}

	readyInProgress = true;

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

userLib.create('myUsername', 'myPassword', userData, function(err, user) {
	console.log('New user UUID: ' + user.uuid);
});

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
		const sendObj = {
			'action': 'createUser',
			'params': [
				uuidLib.v4(),
				username,
				hashedPassword,
				userData
			]
		};

		intercom.publish({'exchange': 'users'}, sendObj, cb);
	});

	async.series(tasks, cb);
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

exports.create	= create;
exports.ready	= ready;
exports.usernameAvailable	= usernameAvailable;
