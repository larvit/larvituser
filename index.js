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
	dataWriter,
	intercom;

/**
 * Add a single user field to database
 *
 * @param str userUuid
 * @param str fieldName
 * @param str fieldValue
 * @param func cb(err)
 */
function addUserField(userUuid, fieldName, fieldValue, cb) {
	const	options	= {'exchange': dataWriter.exchangeName},
		sendObj	= {};

	sendObj.action	= 'addUserField';
	sendObj.params	= {};
	sendObj.params.userUuid	= userUuid;
	sendObj.params.fieldName	= fieldName;
	sendObj.params.fieldValue	= String(fieldValue).trim();

	intercom.send(sendObj, options, function(err, msgUuid) {
		if (err) { cb(err); return; }

		dataWriter.emitter.once(msgUuid, cb);
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

/**
 * Creates a new user (and adds to it to db)
 *
 * @param str username
 * @param str password (plain text) or false for no password (user will not be able to login at all)
 * @param obj fields - key, value pairs, where value can be an array of values
 * @param uuid custom uuid - if not supplied a random will be generated
 * @param func cb(err, user) - user being an instance of the new user
 */
function create(username, password, userData, uuid, cb) {
	const	tasks	= [];

	let	hashedPassword;

	if (typeof uuid === 'function') {
		cb	= uuid;
		uuid	= uuidLib.v1();
	} else if (typeof userData === 'function') {
		cb	= userData;
		userData	= undefined;
		uuid	= uuidLib.v1();
	} else if (cb === undefined) {
		cb	= function() {};
	}

	username = username.trim();

	if (password) {
		password = password.trim();
	}

	if (username.length === 0) {
		const	err = new Error('Trying to create user with empty username');
		log.warn('larvituser: ./index.js - create() - ' + err.message);
		cb(err);
		return;
	}

	tasks.push(ready);

	// Check for username availability
	tasks.push(function(cb) {
		usernameAvailable(username, function(err, result) {
			if (err) { cb(err); return; }

			if (result === true) {
				log.debug('larvituser: ./index.js - create() - Username available: "' + username + '"');
				cb();
			} else {
				const err = new Error('Trying to create user with taken username: "' + username + '"');

				log.info('larvituser: ./index.js - create() - ' + err.message);
				cb(err);
			}
		});
	});

	// Hash Password
	tasks.push(function(cb) {
		if (password === false) {
			log.debug('larvituser: ./index.js - create() - Password set to empty string for no-login, username: "' + username + '"');
			hashedPassword	= '';
			cb();
			return;
		}

		hashPassword(password, function(err, hash) {
			if (err) { cb(err); return; }

			hashedPassword	= hash;
			log.debug('larvituser: ./index.js - create() - Password hashed, username: "' + username + '"');
			cb();
		});
	});

	// Write new user via queue
	tasks.push(function(cb) {
		const	options	= {'exchange': dataWriter.exchangeName},
			sendObj	= {};

		sendObj.action	= 'create';
		sendObj.params	= {};
		sendObj.params.uuid	= uuid;
		sendObj.params.username	= username;
		sendObj.params.password	= hashedPassword;

		intercom.send(sendObj, options, function(err, msgUuid) {
			if (err) { cb(err); return; }

			dataWriter.emitter.once(msgUuid, cb);
		});
	});

	// Write fields via queue
	tasks.push(function(cb) {
		replaceUserFields(uuid, userData, cb);
	});

	async.series(tasks, function(err) {
		if (err) { cb(err); return; }

		fromUuid(uuid, function(err, user) {
			if (err) {
				log.error('larvituser: ./index.js - create() - ' + err.message);
				cb(err);
				return;
			}

			cb(null, user);
		});
	});
}

/**
 * Create a user object from a field
 * IMPORTANT! Only fetches first matching user!
 *
 * @param str fieldName
 * @param str fieldValue
 * @param func cb(err, user) - "user" being a new user object or boolean false on failed search
 */
function fromField(fieldName, fieldValue, cb) {
	ready(function() {
		const	dbFields	=	[fieldName.trim(), fieldValue.trim()],
			sql	=	'SELECT uud.userUuid\n' +
					'FROM user_users_data uud\n' +
					'	JOIN user_data_fields udf ON udf.uuid = uud.fieldUuid\n' +
					'WHERE udf.name = ? AND uud.data = ?\n' +
					'LIMIT 1';

		db.query(sql, dbFields, function(err, rows) {
			if (err) { cb(err); return; }

			if (rows.length === 0) {
				cb(null, false);
				return;
			}

			fromUuid(lUtils.formatUuid(rows[0].userUuid), cb);
		});
	});
}

/**
 * Create a user object from fields
 * IMPORTANT! Only fetches first matching user that matches all fields!
 *
 * @param obj fields - {'fieldName': 'fieldValue', 'fieldName2': 'fieldValue2'}
 * @param func cb(err, user) - "user" being a new user object or boolean false on failed search
 */
function fromFields(fields, cb) {
	ready(function() {
		const	dbFields	= [];

		let	sql	= 'SELECT uuid FROM user_users u\nWHERE\n		1 + 1\n';

		for (const fieldName of Object.keys(fields)) {
			sql += '	AND	uuid IN (SELECT userUuid FROM user_users_data WHERE data = ? AND fieldUuid = (SELECT uuid FROM user_data_fields WHERE name = ?))\n';
			dbFields.push(fields[fieldName].trim());
			dbFields.push(fieldName.trim());
		}

		sql += 'LIMIT 1';
		db.query(sql, dbFields, function(err, rows) {
			if (err) { cb(err); return; }

			if (rows.length === 0) {
				cb(null, false);
				return;
			}

			fromUuid(lUtils.formatUuid(rows[0].uuid), cb);
		});
	});
}

/**
 * Create a user object from username and password
 *
 * @param str username
 * @param str password
 * @param func cb(err, user) - "user" being a new user object or boolean false on failed login
 */
function fromUserAndPass(username, password, cb) {
	const	tasks	= [];

	let	hashedPassword,
		userUuid,
		userObj;

	username	= username.trim();
	password	= password.trim();

	tasks.push(ready);

	tasks.push(function(cb) {
		const	dbFields	= [username],
			sql	= 'SELECT uuid, password FROM user_users WHERE username = ?';

		db.query(sql, dbFields, function(err, rows) {
			if (err) { cb(err); return; }

			if (rows.length === 0) {
				userObj = false;
				cb();
				return;
			}

			hashedPassword	= rows[0].password;
			userUuid	= rows[0].uuid;
			cb();
		});
	});

	tasks.push(function(cb) {
		if ( ! hashedPassword) {
			cb();
			return;
		}

		checkPassword(password, hashedPassword, function(err, res) {
			if (err) {
				log.error('larvituser: fromUserAndPass() - ' + err.message);
				cb(err);
				return;
			}

			if (res === false) {
				userObj = false;
				cb();
				return;
			}

			fromUuid(lUtils.formatUuid(userUuid), function(err, result) {
				userObj = result;
				if (err) userObj = false;
				cb(err);
			});
		});
	});

	async.series(tasks, function(err) {
		cb(err, userObj);
	});
}

/**
 * Create a user object from username
 *
 * @param str username
 * @param func cb(err, user) - "user" being a new user object
 */
function fromUsername(username, cb) {
	const	dbFields	= [],
		sql	= 'SELECT uuid FROM user_users WHERE username = ?';

	username	= username.trim();
	dbFields.push(username);

	ready(function() {
		db.query(sql, dbFields, function(err, rows) {
			if (err) { cb(err); return; }

			if (rows.length === 0) {
				log.debug('larvituser: fromUsername() - No user found for username: "' + username + '"');
				cb(null, false);
				return;
			}

			// Use fromUuid() to get the user instance
			fromUuid(lUtils.formatUuid(rows[0].uuid), cb);
		});
	});
}

/**
 * Instanciate user object from user id
 *
 * @param int userUuid
 * @param func cb(err, userObj) - userObj will be false if no user is found
 */
function fromUuid(userUuid, cb) {
	const	userUuidBuf	= lUtils.uuidToBuffer(userUuid),
		returnObj	= userBase(),
		dbFields	= [userUuidBuf],
		fields	= returnObj.fields,
		sql	= 'SELECT\n' +
			'	u.uuid,\n' +
			'	u.username,\n' +
			'	uf.uuid AS fieldUuid,\n' +
			'	uf.name AS fieldName,\n' +
			'	ud.data AS fieldData\n' +
			'FROM\n' +
			'	user_users u\n' +
			'		LEFT JOIN user_users_data	ud ON ud.userUuid	= u.uuid\n' +
			'		LEFT JOIN user_data_fields	uf ON uf.uuid	= ud.fieldUuid\n' +
			'WHERE u.uuid = ?';

	ready(function() {
		db.query(sql, dbFields, function(err, rows) {
			if (err) { cb(err); return; }

			if (rows.length === 0) {
				const	err = new Error('No user found for userUuid: "' + userUuid + '"');
				log.debug('larvituser: ./index.js - fromUuid() - ' + err.message);
				cb(null, false);
				return;
			}

			returnObj.uuid	= lUtils.formatUuid(rows[0].uuid);
			returnObj.username	= rows[0].username;

			for (let i = 0; rows[i] !== undefined; i ++) {
				const	row	= rows[i];

				if (row.fieldUuid) {
					if (fields[row.fieldName] === undefined) {
						fields[row.fieldName] = [];
					}

					fields[row.fieldName].push(row.fieldData);
				}
			}

			cb(null, returnObj);
		});
	});
}

/**
 * Get field data for a user
 *
 * @param str userUuid
 * @param str fieldName
 * @param func cb(err, data) - data is always an array of data (or empty array)
 */
function getFieldData(userUuid, fieldName, cb) {
	exports.getFieldUuid(fieldName, function(err, fieldUuid) {
		const	dbFields	= [lUtils.uuidToBuffer(userUuid), lUtils.uuidToBuffer(fieldUuid)],
			sql	= 'SELECT data FROM user_users_data WHERE userUuid = ? AND fieldUuid = ?';

		if (err) { cb(err); return; }

		db.query(sql, dbFields, function(err, rows) {
			const	data	= [];

			if (err) { cb(err); return; }

			for (let i = 0; rows[i] !== undefined; i ++) {
				data.push(rows[i].data);
			}

			cb(null, data);
		});
	});
}

/**
 * Hashes a new password
 *
 * @param str password
 * @param func cb(err, hash)
 */
function hashPassword(password, cb) {
	password = password.trim();

	bcrypt.hash(password, 10, function(err, hash) {
		if (err) {
			log.error('larvituser: hashPassword() - ' + err.message);
		}

		cb(err, hash);
	});
}

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

	dataWriter	= require(__dirname + '/dataWriter.js'); // We must do this here since it might not be instanciated on module load

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
 * Replace all fields
 * IMPORTANT!!! Will clear all data not given in the fields parameter
 *
 * @param str userUuid
 * @param obj fields - field name as key, field values as array to that key - ex: {'role': ['admin','user']}
 * @param func cb(err)
 */
function replaceUserFields(uuid, fields, cb) {
	const	options	= {'exchange': dataWriter.exchangeName},
		sendObj	= {};

	sendObj.action	= 'replaceFields';
	sendObj.params	= {};
	sendObj.params.userUuid	= uuid;
	sendObj.params.fields	= fields;

	intercom.send(sendObj, options, function(err, msgUuid) {
		if (err) { cb(err); return; }

		dataWriter.emitter.once(msgUuid, cb);
	});
}

/**
 * Remove a user field
 *
 * @param uuid userUuid
 * @param str fieldName
 * @param func cb(err)
 */
function rmUserField(userUuid, fieldName, cb) {
	const	options	= {'exchange': dataWriter.exchangeName},
		sendObj	= {};

	sendObj.action	= 'rmUserField';
	sendObj.params	= {};
	sendObj.params.userUuid	= userUuid;
	sendObj.params.fieldName	= fieldName;

	intercom.send(sendObj, options, function(err, msgUuid) {
		if (err) { cb(err); return; }

		dataWriter.emitter.once(msgUuid, cb);
	});
}

/**
 * Set password for a user
 *
 * @param str userUuid
 * @param str newPassword (plain text) or false for no valid password (user will not be able to login at all)
 * @param func cb(err)
 */
function setPassword(userUuid, newPassword, cb) {
	const	tasks	= [];

	let	hashedPassword;

	tasks.push(function(cb) {
		if (newPassword) {
			hashPassword(newPassword.trim(), function(err, hash) {
				hashedPassword = hash;
				cb(err);
			});
		} else {
			hashedPassword = false;
			cb();
		}
	});

	tasks.push(function(cb) {
		const	options	= {'exchange': dataWriter.exchangeName},
			sendObj	= {};

		sendObj.action	= 'setPassword';
		sendObj.params	= {};
		sendObj.params.userUuid	= userUuid;
		sendObj.params.password	= hashedPassword;

		intercom.send(sendObj, options, function(err, msgUuid) {
			if (err) { cb(err); return; }

			dataWriter.emitter.once(msgUuid, cb);
		});
	});

	async.series(tasks, cb);
}

/**
 * Set the username for a user
 *
 * @param str userUuid
 * @param str newusername
 * @param fucn cb(err)
 */
function setUsername(userUuid, newUsername, cb) {
	const	userUuidBuf	= lUtils.uuidToBuffer(userUuid);

	newUsername = newUsername.trim();

	if ( ! newUsername) {
		const	err	= new Error('No new username supplied');
		log.warn('larvituser: ./index.js - setUsername() - ' + err.message);
		cb(err);
		return;
	}

	db.query('SELECT uuid FROM user_users WHERE username = ? AND uuid != ?', [newUsername, userUuidBuf], function(err, rows) {
		const	options	= {'exchange': dataWriter.exchangeName},
			sendObj	= {};

		if (err) { cb(err); return; }

		if (rows.length && lUtils.formatUuid(rows[0].uuid) !== userUuid) {
			const	err = new Error('Username is already taken');
			cb(err);
			return;
		}

		sendObj.action	= 'setUsername';
		sendObj.params	= {};
		sendObj.params.userUuid	= userUuid;
		sendObj.params.username	= newUsername;

		intercom.send(sendObj, options, function(err, msgUuid) {
			if (err) { cb(err); return; }

			dataWriter.emitter.once(msgUuid, cb);
		});
	});
}

function userBase() {
	const	returnObj = {'fields': {}};

	/**
	 * Add a field with value
	 *
	 * @param str name
	 * @param str value
	 * @param func cb(err)
	 */
	returnObj.addField = function addField(name, value, cb) {
		if (returnObj.uuid === undefined) {
			const	err = new Error('Cannot add field; no user loaded');
			cb(err);
			return;
		}

		addUserField(returnObj.uuid, name, value, function(err) {
			if (err) { cb(err); return; }

			if (returnObj.fields[name] === undefined) {
				returnObj.fields[name] = [];
			}

			returnObj.fields[name].push(value);
			cb();
		});
	};

	/**
	 * Replace all fields
	 * IMPORTANT!!! Will clear all data not given in the fields parameter
	 *
	 * @param obj fields - field name as key, field values as array to that key - ex: {'role': ['admin','user']}
	 * @param func cb(err)
	 */
	returnObj.replaceFields = function replaceFields(fields, cb) {
		if (returnObj.uuid === undefined) {
			const	err	= new Error('Cannot replace fields; no user loaded');
			cb(err);
			return;
		}

		replaceUserFields(returnObj.uuid, fields, function(err) {
			if (err) { cb(err); return; }

			// Reload everything
			fromUuid(returnObj.uuid, function(err, user) {
				if (err) { cb(err); return; }

				returnObj.fields = user.fields;
				cb();
			});
		});
	};

	/**
	 * Remove a field from this user
	 *
	 * @param str name
	 * @param func cb(err)
	 */
	returnObj.rmField = function rmField(name, cb) {
		if (returnObj.uuid === undefined) {
			const	err	= new Error('Cannot remove field; no user loaded');
			cb(err);
			return;
		}

		rmUserField(returnObj.uuid, name, function(err) {
			if (err) { cb(err); return; }

			delete returnObj.fields[name];
			cb();
		});
	};

	returnObj.setPassword = function(newPassword, cb) {
		if (returnObj.uuid === undefined) {
			const	err	= new Error('Cannot set password; no user loaded');
			cb(err);
			return;
		}

		setPassword(returnObj.uuid, newPassword, cb);
	};

	returnObj.setUsername = function(newUsername, cb) {
		if (returnObj.uuid === undefined) {
			const	err	= new Error('Cannot set username; no user loaded');
			cb(err);
			return;
		}

		setUsername(returnObj.uuid, newUsername, cb);
	};

	return returnObj;
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

exports.addUserField	= addUserField;
exports.checkPassword	=	checkPassword;
exports.create	= create;
exports.fromField	= fromField;
exports.fromFields	= fromFields;
exports.fromUserAndPass	= fromUserAndPass;
exports.fromUsername	= fromUsername;
exports.fromUuid	= fromUuid;
exports.getFieldData	= getFieldData;
exports.hashPassword	= hashPassword;
exports.ready	= ready;
exports.setUsername	= setUsername;
exports.usernameAvailable	= usernameAvailable;
Object.assign(exports, require(__dirname + '/helpers.js')); // extend this module with all helpers from the helpers file
