'use strict';

const	topLogPrefix	= 'larvituser: index.js: ',
	DataWriter	= require(__dirname + '/dataWriter.js'),
	Intercom	= require('larvitamintercom'),
	uuidLib	= require('uuid'),
	Helpers	= require(__dirname + '/helpers.js'),
	LUtils	= require('larvitutils'),
	bcrypt	= require('bcryptjs'),
	async	= require('async');

function User(options, cb) {
	const	logPrefix	= topLogPrefix + 'User() - ',
		that	= this;

	that.options	= options || {};

	if ( ! options.log) {
		const	tmpLUtils	= new LUtils();
		options.log	= new tmpLUtils.Log();
	}

	that.options	= options;

	for (const key of Object.keys(options)) {
		that[key]	= options[key];
	}

	that.lUtils	= new LUtils({'log': that.log});

	if ( ! that.db) {
		const	err	= new Error('Required option db is missing');
		that.log.error(logPrefix + err.message);
		throw err;
	}

	if ( ! that.exchangeName) {
		that.exchangeName	= 'larvituser';
	}

	if ( ! that.mode) {
		that.log.info(logPrefix + 'No "mode" option given, defaulting to "noSync"');
		that.mode	= 'noSync';
	} else if (['noSync', 'master', 'slave'].indexOf(that.mode) === - 1) {
		const	err	= new Error('Invalid "mode" option given: "' + that.mode + '"');
		that.log.error(logPrefix + err.message);
		throw err;
	}

	if ( ! that.intercom) {
		that.log.info(logPrefix + 'No "intercom" option given, defaulting to "loopback interface"');
		that.intercom	= new Intercom('loopback interface');
	}

	that.dataWriter	= new DataWriter({
		'exchangeName':	that.exchangeName,
		'intercom':	that.intercom,
		'mode':	that.mode,
		'log':	that.log,
		'db':	that.db,
		'amsync_host':	that.options.amsync_host || null,
		'amsync_minPort':	that.options.amsync_minPort || null,
		'amsync_maxPort':	that.options.amsync_maxPort || null
	}, function (err) {
		if (err) return cb(err);

		that.helpers = new Helpers({
			'dataWriter':	that.dataWriter,
			'log':	that.log,
			'db':	that.db
		});

		cb();
	});
};

/**
 * Add a single user field to database
 *
 * @param str userUuid
 * @param str fieldName
 * @param str fieldValue
 * @param func cb(err)
 */
User.prototype.addUserDataField = function addUserDataField(userUuid, fieldName, fieldValue, cb) {
	const	fields	= {},
		that	= this;

	fields[fieldName]	= fieldValue;

	that.addUserDataFields(userUuid, fields, cb);
};

/**
 * Add user fields
 *
 * @param str userUuid
 * @param obj fields - field name as key, field values as array to that key - ex: {'role': ['admin','user']}
 * @param func cb(err)
 */
User.prototype.addUserDataFields = function addUserDataFields(userUuid, fields, cb) {
	const	options	= {'exchange': that.exchangeName},
		sendObj	= {},
		that	= this;

	// do not want to broadcast msg on queue for no reason
	if ( ! fields || Object.keys(fields).length === 0) return cb();

	sendObj.action	= 'addUserDataFields';
	sendObj.params	= {};
	sendObj.params.userUuid	= userUuid;
	sendObj.params.fields	= fields;

	that.intercom.send(sendObj, options, function (err, msgUuid) {
		if (err) return cb(err);

		that.dataWriter.emitter.once(msgUuid, cb);
	});
};

/**￼Analyze ￼Optimize ￼Check ￼Repair ￼Truncate ￼Drop * Checks a password for validity
 *
 * @param str password - plain text password
 * @param str hash - hash to check password against
 * @param func cb(err, res) res is boolean
 */
User.prototype.checkPassword = function checkPassword(password, hash, cb) {
	const	logPrefix	= topLogPrefix + 'checkPassword() - ',
		that	= this;

	password	= password.trim();

	bcrypt.compare(password, hash, function (err, result) {
		if (err) {
			that.log.error(logPrefix + err.message);
		}

		cb(err, result);
	});
};

/**
 * Creates a new user (and adds to it to db)
 *
 * @param str username
 * @param str password (plain text) or false for no password (user will not be able to login at all)
 * @param obj fields - key, value pairs, where value can be an array of values
 * @param uuid custom uuid - if not supplied a random will be generated
 * @param func cb(err, user) - user being an instance of the new user
 */
User.prototype.create = function create(username, password, userData, uuid, cb) {
	const	logPrefix	= topLogPrefix + 'create() - ',
		tasks	= [],
		that	= this;

	let	hashedPassword;

	if (typeof uuid === 'function') {
		cb	= uuid;
		uuid	= uuidLib.v1();
	} else if (typeof userData === 'function') {
		userData	= undefined;
		uuid	= uuidLib.v1();
		cb	= userData;
	}

	if (cb === undefined) {
		cb	= function () {};
	}

	if (uuid === undefined) {
		uuid	= uuidLib.v1();
	}

	username	= username.trim();

	if (password) {
		password	= password.trim();
	}

	if (username.length === 0) {
		const	err = new Error('Trying to create user with empty username');
		that.log.warn(logPrefix + err.message);
		return cb(err);
	}

	// Check for username availability
	tasks.push(function (cb) {
		that.usernameAvailable(username, function (err, result) {
			if (err) return cb(err);

			if (result === true) {
				that.log.debug(logPrefix + 'Username available: "' + username + '"');
				cb();
			} else {
				const	err	= new Error('Trying to create user with taken username: "' + username + '"');

				that.log.info(logPrefix + err.message);
				cb(err);
			}
		});
	});

	// Hash Password
	tasks.push(function (cb) {
		if (password === false) {
			that.log.debug(logPrefix + 'Password set to empty string for no-login, username: "' + username + '"');
			hashedPassword	= '';
			return cb();
		}

		that.hashPassword(password, function (err, hash) {
			if (err) return cb(err);

			hashedPassword	= hash;
			that.log.debug(logPrefix + 'Password hashed, username: "' + username + '"');
			cb();
		});
	});

	// Create all fields
	tasks.push(function (cb) {
		const	tasks	= [];

		for (const fieldName of Object.keys(userData)) {
			tasks.push(function (cb) {
				that.helpers.getFieldUuid(fieldName, cb);
			});
		}

		async.parallel(tasks, cb);
	});

	// Write new user via queue
	tasks.push(function (cb) {
		const	options	= {'exchange': that.exchangeName},
			sendObj	= {};

		sendObj.action	= 'create';
		sendObj.params	= {};
		sendObj.params.uuid	= uuid;
		sendObj.params.username	= username;
		sendObj.params.password	= hashedPassword;
		sendObj.params.fields	= userData;

		that.intercom.send(sendObj, options, function (err, msgUuid) {
			if (err) return cb(err);

			that.dataWriter.emitter.once(msgUuid, cb);
		});
	});

	async.series(tasks, function (err) {
		if (err) return cb(err);

		that.fromUuid(uuid, function (err, user) {
			if (err) {
				that.log.error(logPrefix + err.message);
				return cb(err);
			}

			cb(null, user);
		});
	});
};

/**
 * Create a user object from a field
 * IMPORTANT! Only fetches first matching user!
 *
 * @param str fieldName
 * @param str fieldValue
 * @param func cb(err, user) - "user" being a new user object or boolean false on failed search
 */
User.prototype.fromField = function fromField(fieldName, fieldValue, cb) {
	const	dbFields	=	[fieldName.trim(), fieldValue.trim()],
		that	= this,
		sql	=	'SELECT uud.userUuid\n' +
				'FROM user_users_data uud\n' +
				'	JOIN user_data_fields udf ON udf.uuid = uud.fieldUuid\n' +
				'WHERE udf.name = ? AND uud.data = ?\n' +
				'LIMIT 1';

	that.db.query(sql, dbFields, function (err, rows) {
		if (err) return cb(err);

		if (rows.length === 0) return cb(null, false);

		that.fromUuid(lUtils.formatUuid(rows[0].userUuid), cb);
	});
};

/**
 * Create a user object from fields
 * IMPORTANT! Only fetches first matching user that matches all fields!
 *
 * @param obj fields - {'fieldName': 'fieldValue', 'fieldName2': 'fieldValue2'}
 * @param func cb(err, user) - "user" being a new user object or boolean false on failed search
 */
User.prototype.fromFields = function fromFields(fields, cb) {
	const	dbFields	= [],
		that	= this;

	let	sql	= 'SELECT uuid FROM user_users u\nWHERE\n		1 + 1\n';

	for (const fieldName of Object.keys(fields)) {
		sql += '	AND	uuid IN (SELECT userUuid FROM user_users_data WHERE data = ? AND fieldUuid = (SELECT uuid FROM user_data_fields WHERE name = ?))\n';
		dbFields.push(fields[fieldName].trim());
		dbFields.push(fieldName.trim());
	}

	sql += 'LIMIT 1';

	that.db.query(sql, dbFields, function (err, rows) {
		if (err) return cb(err);

		if (rows.length === 0) return cb(null, false);

		that.fromUuid(lUtils.formatUuid(rows[0].uuid), cb);
	});
};

/**
 * Create a user object from username and password
 *
 * @param str username
 * @param str password
 * @param func cb(err, user) - "user" being a new user object or boolean false on failed login
 */
User.prototype.fromUserAndPass = function fromUserAndPass(username, password, cb) {
	const	logPrefix	= topLogPrefix + 'fromUserAndPass() - ',
		tasks	= [],
		that	= this;

	let	hashedPassword,
		userUuid,
		userObj;

	username	= username.trim();
	password	= password.trim();

	tasks.push(function (cb) {
		const	dbFields	= [username],
			sql	= 'SELECT uuid, password FROM user_users WHERE username = ?';

		that.db.query(sql, dbFields, function (err, rows) {
			if (err) return cb(err);

			if (rows.length === 0) {
				userObj = false;
				return cb();
			}

			hashedPassword	= rows[0].password;
			userUuid	= rows[0].uuid;
			cb();
		});
	});

	tasks.push(function (cb) {
		if ( ! hashedPassword) return cb();

		that.checkPassword(password, hashedPassword, function (err, res) {
			if (err) {
				that.log.error(logPrefix + err.message);
				return cb(err);
			}

			if (res === false) {
				userObj	= false;
				return cb();
			}

			that.fromUuid(lUtils.formatUuid(userUuid), function (err, result) {
				userObj	= result;
				if (err) userObj	= false;
				cb(err);
			});
		});
	});

	async.series(tasks, function (err) {
		cb(err, userObj);
	});
};

/**
 * Create a user object from username
 *
 * @param str username
 * @param func cb(err, user) - "user" being a new user object
 */
User.prototype.fromUsername = function fromUsername(username, cb) {
	const	logPrefix	= topLogPrefix + 'fromUsername() - ',
		dbFields	= [],
		that	= this,
		sql	= 'SELECT uuid FROM user_users WHERE username = ?';

	username	= username.trim();
	dbFields.push(username);

	that.db.query(sql, dbFields, function (err, rows) {
		if (err) return cb(err);

		if (rows.length === 0) {
			that.log.debug(logPrefix + 'No user found for username: "' + username + '"');
			return cb(null, false);
		}

		// Use fromUuid() to get the user instance
		that.fromUuid(lUtils.formatUuid(rows[0].uuid), cb);
	});
};

/**
 * Instanciate user object from user id
 *
 * @param int userUuid
 * @param func cb(err, userObj) - userObj will be false if no user is found
 */
User.prototype.fromUuid = function fromUuid(userUuid, cb) {
	const	userUuidBuf	= this.lUtils.uuidToBuffer(userUuid),
		logPrefix	= topLogPrefix + 'fromUuid() - ',
		returnObj	= userBase(),
		dbFields	= [userUuidBuf],
		fields	= returnObj.fields,
		that	= this,
		sql = 'SELECT\n' +
			'	u.uuid,\n' +
			'	u.username,\n' +
			'	u.password,\n' +
			'	uf.uuid AS fieldUuid,\n' +
			'	uf.name AS fieldName,\n' +
			'	ud.data AS fieldData\n' +
			'FROM\n' +
			'	user_users u\n' +
			'		LEFT JOIN user_users_data	ud ON ud.userUuid	= u.uuid\n' +
			'		LEFT JOIN user_data_fields	uf ON uf.uuid	= ud.fieldUuid\n' +
			'WHERE u.uuid = ?';

	if ( ! userUuidBuf) {
		const	err	= new Error('Invalid userUuid');
		that.log.warn(logPrefix + err.message);
		return cb(err);
	}

	if (err) return cb(err);

	that.db.query(sql, dbFields, function (err, rows) {
		if (err) return cb(err);

		if (rows.length === 0) {
			const	err	= new Error('No user found for userUuid: "' + userUuid + '"');
			that.log.debug(logPrefix + err.message);
			return cb(null, false);
		}

		returnObj.uuid	= lUtils.formatUuid(rows[0].uuid);
		returnObj.username	= rows[0].username;

		if (rows[0].password === '') {
			returnObj.passwordIsFalse	= true;
		} else {
			returnObj.passwordIsFalse	= false;
		}

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
};

/**
 * Get field data for a user
 *
 * @param str userUuid
 * @param str fieldName
 * @param func cb(err, data) - data is always an array of data (or empty array)
 */
User.prototype.getFieldData = function getFieldData(userUuid, fieldName, cb) {
	const	logPrefix	= topLogPrefix + 'getFieldData() - ',
		that	= this;

	that.helpers.getFieldUuid(fieldName, function (err, fieldUuid) {
		const	userUuidBuffer	= that.lUtils.uuidToBuffer(userUuid),
			fieldUuidBuffer	= that.lUtils.uuidToBuffer(fieldUuid),
			dbFields	= [userUuidBuffer, fieldUuidBuffer],
			sql	= 'SELECT data FROM user_users_data WHERE userUuid = ? AND fieldUuid = ?';

		if (err) return cb(err);

		if (userUuidBuffer === false) {
			const	err	= new Error('Invalid user uuid');
			that.log.verbose(logPrefix + err.message);
			return cb(err);
		}

		if (fieldUuidBuffer === false) {
			const	err	= new Error('Invalid field uuid');
			that.log.verbose(logPrefix + err.message);
			return cb(err);
		}

		that.db.query(sql, dbFields, function (err, rows) {
			const	data	= [];

			if (err) return cb(err);

			for (let i = 0; rows[i] !== undefined; i ++) {
				data.push(rows[i].data);
			}

			cb(null, data);
		});
	});
};

/**
 * Hashes a new password
 *
 * @param str password
 * @param func cb(err, hash)
 */
User.prototype.hashPassword = function hashPassword(password, cb) {
	const	logPrefix	= topLogPrefix + 'hashPassword() - ',
		that	= this;

	if ( ! password) {
		password	= '';
	}

	password	= password.trim();

	bcrypt.hash(password, 10, function (err, hash) {
		if (err) {
			that.log.error(logPrefix + err.message);
		}

		cb(err, hash);
	});
};

/**
 * Replace all fields
 * IMPORTANT!!! Will clear all data not given in the fields parameter
 *
 * @param str userUuid
 * @param obj fields - field name as key, field values as array to that key - ex: {'role': ['admin','user']}
 * @param func cb(err)
 */
User.prototype.replaceUserFields = function replaceUserFields(uuid, fields, cb) {
	const	options	= {'exchange': this.exchangeName},
		sendObj	= {},
		that	= this;

	that.fromUuid(uuid, function (err, user) {
		if (err) return cb(err);

		sendObj.action	= 'replaceFields';
		sendObj.params	= {};
		sendObj.params.username	= user.username;
		sendObj.params.userUuid	= uuid;
		sendObj.params.fields	= fields;

		that.intercom.send(sendObj, options, function (err, msgUuid) {
			if (err) return cb(err);

			that.dataWriter.emitter.once(msgUuid, cb);
		});
	});
};

/**
 * Remove a user
 *
 * @param uuid userUuid
 * @param func cb(err)
 */
User.prototype.rmUser = function rmUser(userUuid, cb) {
	const	options	= {'exchange': this.dataWriter.exchangeName},
		sendObj	= {},
		that	= this;

	sendObj.action	= 'rmUser';
	sendObj.params	= {};
	sendObj.params.userUuid	= userUuid;

	that.intercom.send(sendObj, options, function (err, msgUuid) {
		if (err) return cb(err);

		that.dataWriter.emitter.once(msgUuid, cb);
	});
};

/**
 * Remove a user field
 *
 * @param uuid userUuid
 * @param str fieldName
 * @param func cb(err)
 */
User.prototype.rmUserField = function rmUserField(userUuid, fieldName, cb) {
	const	options	= {'exchange': this.dataWriter.exchangeName},
		sendObj	= {},
		that	= this;

	sendObj.action	= 'rmUserField';
	sendObj.params	= {};
	sendObj.params.userUuid	= userUuid;
	sendObj.params.fieldName	= fieldName;

	that.intercom.send(sendObj, options, function (err, msgUuid) {
		if (err) return cb(err);

		that.dataWriter.emitter.once(msgUuid, cb);
	});
};

/**
 * Set password for a user
 *
 * @param str userUuid
 * @param str newPassword (plain text) or false for no valid password (user will not be able to login at all)
 * @param func cb(err)
 */
User.prototype.setPassword = function setPassword(userUuid, newPassword, cb) {
	const	tasks	= [],
		that	= this;

	let	hashedPassword;

	tasks.push(function (cb) {
		if (newPassword) {
			that.hashPassword(newPassword.trim(), function (err, hash) {
				hashedPassword	= hash;
				cb(err);
			});
		} else {
			hashedPassword	= false;
			cb();
		}
	});

	tasks.push(function (cb) {
		const	options	= {'exchange': that.dataWriter.exchangeName},
			sendObj	= {};

		sendObj.action	= 'setPassword';
		sendObj.params	= {};
		sendObj.params.userUuid	= userUuid;
		sendObj.params.password	= hashedPassword;

		that.intercom.send(sendObj, options, function (err, msgUuid) {
			if (err) return cb(err);

			that.dataWriter.emitter.once(msgUuid, cb);
		});
	});

	async.series(tasks, cb);
};

/**
 * Set the username for a user
 *
 * @param str userUuid
 * @param str newusername
 * @param fucn cb(err)
 */
User.prototype.setUsername = function setUsername(userUuid, newUsername, cb) {
	const	userUuidBuf	= lUtils.uuidToBuffer(userUuid),
		logPrefix	= topLogPrefix + 'setUsername() - ',
		that	= this;

	newUsername	= newUsername.trim();

	if ( ! newUsername) {
		const	err	= new Error('No new username supplied');
		that.log.warn(logPrefix + err.message);
		return cb(err);
	}

	if (userUuidBuf === false) {
		const	err	= new Error('Invalid user uuid');
		that.log.warn(logPrefix + err.message);
		return cb(err);
	}

	that.db.query('SELECT uuid FROM user_users WHERE username = ? AND uuid != ?', [newUsername, userUuidBuf], function (err, rows) {
		const	options	= {'exchange': that.dataWriter.exchangeName},
			sendObj	= {};

		if (err) return cb(err);

		if (rows.length && that.lUtils.formatUuid(rows[0].uuid) !== userUuid) {
			const	err = new Error('Username is already taken');
			return cb(err);
		}

		sendObj.action	= 'setUsername';
		sendObj.params	= {};
		sendObj.params.userUuid	= userUuid;
		sendObj.params.username	= newUsername;

		that.intercom.send(sendObj, options, function (err, msgUuid) {
			if (err) return cb(err);

			that.dataWriter.emitter.once(msgUuid, cb);
		});
	});
};

function userBase() {
	const	returnObj	= {'fields': {}};

	/**
	 * Add a field with value
	 *
	 * @param str name
	 * @param str value
	 * @param func cb(err)
	 */
	returnObj.addField = function addField(name, value, cb) {
		if (returnObj.uuid === undefined) {
			const	err	= new Error('Cannot add field; no user loaded');
			return cb(err);
		}

		addUserDataField(returnObj.uuid, name, value, function (err) {
			if (err) return cb(err);

			if (returnObj.fields[name] === undefined) {
				returnObj.fields[name] = [];
			}

			returnObj.fields[name].push(value);
			cb();
		});
	};

	/**
	 * Adds one or more fields with values to the user object. Does not overwrite existing values. It is possible to add the same value multiple times
	 *
	 * @param obj fields - field name as key, field values as array to that key - ex: {'role': ['admin','user']}
	 * @param func cb(err)
	 */
	returnObj.addFields = function addFields(fields, cb) {
		if (returnObj.uuid === undefined) {
			const	err = new Error('Cannot add field; no user loaded');
			return cb(err);
		}

		addUserDataFields(returnObj.uuid, fields, function (err) {
			if (err) return cb(err);

			for (let key in fields) {
				if (returnObj.fields[key] === undefined) {
					returnObj[key] = fields[key];
				} else {
					for (let value of fields[key]) {
						returnObj.fields[key].push(value);
					}
				}
			}

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
			return cb(err);
		}

		replaceUserFields(returnObj.uuid, fields, function (err) {
			if (err) return cb(err);

			// Reload everything
			fromUuid(returnObj.uuid, function (err, user) {
				if (err) return cb(err);

				returnObj.fields = user.fields;
				cb();
			});
		});
	};

	returnObj.rm = function rm(cb) {
		if (returnObj.uuid === undefined) {
			const	err	= new Error('Cannot remove field; no user loaded');
			return cb(err);
		}

		rmUser(returnObj.uuid, function (err) {
			if (err) return cb(err);

			delete returnObj.uuid;
			delete returnObj.fields;
			delete returnObj.username;

			cb();
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
			return cb(err);
		}

		rmUserField(returnObj.uuid, name, function (err) {
			if (err) return cb(err);

			delete returnObj.fields[name];
			cb();
		});
	};

	returnObj.setPassword = function (newPassword, cb) {
		if (returnObj.uuid === undefined) {
			const	err	= new Error('Cannot set password; no user loaded');
			return cb(err);
		}

		setPassword(returnObj.uuid, newPassword, cb);
	};

	returnObj.setUsername = function (newUsername, cb) {
		if (returnObj.uuid === undefined) {
			const	err	= new Error('Cannot set username; no user loaded');
			return cb(err);
		}

		setUsername(returnObj.uuid, newUsername, function (err) {
			if (err) return cb(err);
			returnObj.username	= newUsername;
			cb();
		});
	};

	return returnObj;
}

/**
 * Checks if a unsername is available
 *
 * @param str username
 * @param func cb(err, result) - result is a bolean
 */
User.prototype.usernameAvailable = function usernameAvailable(username, cb) {
	const	that	= this;

	let	isAvailable;

	username	= username.trim();

	that.db.query('SELECT uuid FROM user_users WHERE username = ?', [username], function (err, rows) {
		if (err) return cb(err);

		if (rows.length === 0) {
			isAvailable	= true;
		} else {
			isAvailable	= false;
		}

		cb(null, isAvailable);
	});
};

exports = module.exports = User;
exports.Users	= require(__dirname + '/users.js');