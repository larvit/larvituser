'use strict';

var _       = require('lodash'),
    db      = require('larvitdb'),
    log     = require('winston'),
    utils   = require('larvitutils'),
    bcrypt  = require('bcrypt'),
    uuidLib = require('node-uuid');

exports.dbChecked      = false;
exports.dbCheckStarted = false;

/**
 * Add a single user field to database
 *
 * @param uuid userUuid
 * @param str fieldName
 * @param str fieldValue
 * @param func cb(err)
 */
function addUserField(userUuid, fieldName, fieldValue, cb) {
	fieldValue = String(fieldValue).trim();

	getFieldId(fieldName, function(err, fieldId) {
		var sql      = 'INSERT INTO user_users_data (userUuid, fieldId, data) VALUES(UNHEX(REPLACE(?, \'-\', \'\')),?,?)',
		    dbFields = [userUuid, fieldId, fieldValue];

		if (err) {
			log.error('larvituser: addUserField() - ' + err.message);
			return;
		}

		db.query(sql, dbFields, function(err) {
			if (err) {
				cb(err);
				return;
			}

			cb();
		});
	});
}

/**
 * Control the database structure and create if it not exists
 */
function checkDbStructure(cb) {
	if (exports.dbChecked) {
		cb();
	} else if (exports.dbCheckStarted) {
		// If it have started, but not finnished, run it again next tick until it is done
		setImmediate(function() {
			checkDbStructure(cb);
		});
	} else {
		exports.dbCheckStarted = true;

		createUserUsers(function() {
			createUserDataFields(function() {
				createUserRolesRights(function() {
					createUserUsersData(function() {
						exports.dbChecked = true;
						cb();
					});
				});
			});
		});
	}
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

	bcrypt.compare(password, hash, function(err, res) {
		if (err) {
			log.error('larvituser: checkPassword() - ' + err.message);
			cb(err);
			return;
		}

		if (res) {
			cb(null, true);
		} else {
			cb(null, false);
		}
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
function create(username, password, fields, uuid, cb) {
	var hashedPassword,
	    err;

	username = _.trim(username);

	if (password)
		password = _.trim(password);

	if (uuid instanceof Function && cb === undefined) {
		cb   = uuid;
		uuid = uuidLib.v4();
	} else if (uuid === undefined) {
		uuid = uuidLib.v4();
	}

	// Write the fields to the db
	function writeFieldsToDb() {
		replaceUserFields(uuid, fields, function(err) {
			if (err) {
				log.error('larvituser: create() - ' + err.message);
				cb(err);
				return;
			}

			log.debug('larvituser: create() - Fields written successfully to database', {'username': username, 'userUuid': uuid, 'fields': fields});

			fromUuid(uuid, function(err, user) {
				if (err) {
					log.error('larvituser: create() - ' + err.message);
					cb(err);
					return;
				}

				cb(null, user);
			});
		});
	}

	// Write to database - called from the above cb
	function writeToDb() {
		var sql      = 'INSERT INTO user_users (uuid, username, password) VALUES(UNHEX(REPLACE(?, \'-\', \'\')),?,?);',
		    dbFields = [uuid, username, hashedPassword];

		log.verbose('larvituser: create() - Trying to write username and password to database', {'sql': sql, 'fields': dbFields});

		db.query(sql, dbFields, function(err) {
			if (err) {
				cb(err);
				return;
			}

			log.debug('larvituser: create() - Write to db successfull! Moving on to writing fields to database', {'username': username, 'uuid': uuid});
			writeFieldsToDb();
		});
	}

	// Hash password - called from the above cb
	function hashPassword() {
		if (password === false) {
			log.debug('larvituser: create() - Password set to empty string for no-login, moving on to writing username and password to database', {'username': username});
			hashedPassword = '';
			writeToDb();
			return;
		}

		exports.hashPassword(password, function(err, hash) {
			if (err) {
				cb(err);
			} else {
				hashedPassword = hash;
				log.debug('larvituser: create() - Password hashed, moving on to writing username and password to database', {'username': username});
				writeToDb();
			}
		});
	}

	checkDbStructure(function() {
		log.verbose('larvituser: create() - Trying to create user', {'username': username, 'fields': fields});

		username = username.trim();
		if (password !== false) {
			password = password.trim();
		}

		if ( ! username.length) {
			err = new Error('Trying to create user with empty username');
			log.warn('larvituser: create() - ' + err.message);
			cb(err);
			return;
		}

		// Check if username is available
		usernameAvailable(username, function(err, res) {
			if (err) {
				cb(err);
			} else if ( ! res) {
				err = new Error('Trying to create user with taken username: "' + username + '"');
				log.info('larvituser: create() - ' + err.message);
				cb(err);
			} else {
				log.debug('larvituser: create() - Username available, moving on to hashing password', {'username': username});
				hashPassword();
			}
		});
	});
}

function createUserDataFields(cb) {
	db.query('SHOW TABLES LIKE \'user_data_fields\'', function(err, rows) {
		var sql;

		if (err) {
			throw err;
		}

		if ( ! rows.length) {
			// Table does not exist, create it
			log.info('larvituser: createUserDataFields() - Table user_data_fields did not exist, creating.');

			sql = 'CREATE TABLE `user_data_fields` (' +
				'	`id` int(11) unsigned NOT NULL AUTO_INCREMENT,' +
				'	`name` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,' +
				'	PRIMARY KEY (`id`),' +
				'	UNIQUE KEY `name` (`name`)' +
				') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';
			db.query(sql, function(err) {
				if (err) {
					throw err;
				}

				cb();
			});
		} else {
			cb();
		}
	});
}

function createUserRolesRights(cb) {
	db.query('SHOW TABLES LIKE \'user_roles_rights\'', function(err, rows) {
		var sql;

		if (err) {
			throw err;
		}

		if ( ! rows.length) {
			// Table does not exist, create it
			log.info('larvituser: createUserRolesRights() - Table user_roles_rights did not exist, creating.');

			sql = 'CREATE TABLE `user_roles_rights` (' +
				'	`role` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL,' +
				'	`uri` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL,' +
				'	PRIMARY KEY (`role`,`uri`)' +
				') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;';
			db.query(sql, function(err) {
				if (err) {
					throw err;
				}

				cb();
			});
		} else {
			cb();
		}
	});
}

function createUserUsers(cb) {
	// We need to run the checks for user_users first
	db.query('SHOW TABLES LIKE \'user_users\'', function(err, rows) {
		var sql;

		if (err) {
			throw err;
		}

		if ( ! rows.length) {
			// Table does not exist, create it
			log.info('larvituser: createUserUsers() - Table user_users did not exist, creating.');

			sql = 'CREATE TABLE `user_users` (' +
				'	`uuid` binary(16) NOT NULL,' +
				'	`username` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,' +
				'	`password` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,' +
				'	PRIMARY KEY (`uuid`),' +
				'	UNIQUE KEY `username` (`username`)' +
				') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;';
			db.query(sql, function(err) {
				if (err) {
					throw err;
				}

				cb(err);
			});
		} else {
			cb(err);
		}
	});
}

function createUserUsersData(cb) {
	db.query('SHOW TABLES LIKE \'user_users_data\'', function(err, rows) {
		var sql;

		if (err) {
			throw err;
		}

		if ( ! rows.length) {
			// Table does not exist, create it
			log.info('larvituser: createUserUsersData() - Table user_users_data did not exist, creating.');

			sql = 'CREATE TABLE `user_users_data` (' +
				'  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,' +
				'  `userUuid` binary(16) NOT NULL,' +
				'  `fieldId` int(11) unsigned NOT NULL,' +
				'  `data` text COLLATE utf8mb4_unicode_ci NOT NULL,' +
				'  PRIMARY KEY (`id`),' +
				'  KEY `userUuid` (`userUuid`),' +
				'  KEY `fieldId` (`fieldId`),' +
				'  KEY `userUuid_fieldId` (`userUuid`,`fieldId`),' +
				'  CONSTRAINT `user_users_data_ibfk_1` FOREIGN KEY (`userUuid`) REFERENCES `user_users` (`uuid`),' +
				'  CONSTRAINT `user_users_data_ibfk_2` FOREIGN KEY (`fieldId`) REFERENCES `user_data_fields` (`id`)' +
				') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;';
			db.query(sql, function(err) {
				if (err) {
					throw err;
				}

				cb();
			});
		} else {
			cb();
		}
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
	checkDbStructure(function() {
		var sql,
		    dbFields;

		sql = 'SELECT uud.userUuid ' +
		      'FROM user_users_data uud JOIN user_data_fields udf ON udf.id = uud.fieldId ' +
		      'WHERE udf.name = ? AND uud.data = ? ' +
		      'LIMIT 1';

		dbFields = [_.trim(fieldName), _.trim(fieldValue)];

		db.query(sql, dbFields, function(err, rows) {
			if (err) {
				cb(err);
				return;
			}

			if (rows.length === 0) {
				cb(null, false);
				return;
			}

			fromUuid(utils.formatUuid(rows[0].userUuid), cb);
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
	checkDbStructure(function() {
		var dbFields = [],
		    fieldName,
		    sql;

		sql  = 'SELECT uuid FROM user_users u\n';
		sql += 'WHERE 1 + 1\n';

		for (fieldName in fields) {
			sql += '	AND uuid IN (SELECT userUuid FROM user_users_data WHERE data = ? fieldId = (SELECT id FROM user_data_fields WHERE name = ?))\n';
			dbFields.push(_.trim(fields[fieldName]));
			dbFields.push(_.trim(fieldName));
		}

		sql += 'LIMIT 1';

		db.query(sql, dbFields, function(err, rows) {
			if (err) {
				cb(err);
				return;
			}

			if (rows.length === 0) {
				cb(null, false);
				return;
			}

			fromUuid(utils.formatUuid(rows[0].userUuid), cb);
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
	checkDbStructure(function() {
		var sql = 'SELECT uuid, password FROM user_users WHERE username = ?',
		    dbFields;

		username = _.trim(username);
		password = _.trim(password);
		dbFields = [username];

		db.query(sql, dbFields, function(err, rows) {
			if (err) {
				cb(err);
				return;
			}

			if (rows.length === 0) {
				cb(null, false);
				return;
			}

			checkPassword(password, rows[0].password, function(err, res) {
				if (err) {
					log.error('larvituser: fromUserAndPass() - ' + err.message);
					cb(err);
					return;
				}

				if (res === true) {
					// Password check is ok, use fromUuid() to get the user instance
					fromUuid(utils.formatUuid(rows[0].uuid), cb);
				} else {
					cb(null, false);
				}
			});
		});
	});
}

/**
 * Create a user object from username
 *
 * @param str username
 * @param func cb(err, user) - "user" being a new user object
 */
function fromUsername(username, cb) {
	checkDbStructure(function() {
		var sql,
		    dbFields;

		username = _.trim(username);
		sql      = 'SELECT uuid FROM user_users WHERE username = ?';
		dbFields = [username];

		db.query(sql, dbFields, function(err, rows) {
			if (err) {
				cb(err);
				return;
			}

			if (rows.length === 0) {
				err = new Error('No user found for username: "' + username + '"');
				err.sql = sql;
				log.debug('larvituser: fromUsername() - ' + err.message);
				cb(err);
				return;
			}

			// Use fromUuid() to get the user instance
			fromUuid(utils.formatUuid(rows[0].uuid), cb);
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
	checkDbStructure(function() {
		var returnObj = userBase(),
		    rowNr     = 0,
		    fields    = returnObj.fields,
		    dbFields  = [userUuid],
		    row,
		    sql       = 'SELECT ' +
		                  'u.uuid, ' +
		                  'u.username, ' +
		                  'uf.id AS fieldId, ' +
		                  'uf.name AS field_name, ' +
		                  'ud.data AS field_data ' +
		                'FROM ' +
		                  'user_users u ' +
		                  'LEFT JOIN user_users_data  ud ON ud.userUuid = u.uuid ' +
		                  'LEFT JOIN user_data_fields uf ON uf.id       = ud.fieldId ' +
		                'WHERE u.uuid = UNHEX(REPLACE(?, \'-\', \'\'))';

		log.silly('larvituser: fromUuid() - SQL query', {'sql': sql, 'dbFields': dbFields});

		db.query(sql, dbFields, function(err, rows) {
			if (err) {
				cb(err);
				return;
			}

			if (rows.length === 0) {
				err = new Error('No user found for userUuid: "' + userUuid + '"');
				err.sql = sql;
				log.debug('larvituser: create() - ' + err.message);
				cb(null, false);
				return;
			}

			returnObj.uuid     = utils.formatUuid(rows[0].uuid);
			returnObj.username = rows[0].username;

			rowNr = 0;
			while (rows[rowNr] !== undefined) {
				row = rows[rowNr];

				if (row.fieldId) {
					if (fields[row.field_name] === undefined) {
						fields[row.field_name] = [];
					}

					fields[row.field_name].push(row.field_data);
				}

				rowNr ++;
			}

			cb(null, returnObj);
		});
	});
}

/**
 * Get field data for a user
 *
 * @param int userUuid
 * @param str fieldName
 * @param func cb(err, data) - data is always an array of data (or empty array)
 */
function getFieldData(userUuid, fieldName, cb) {
	getFieldId(fieldName, function(err, fieldId) {
		var sql      = 'SELECT data FROM user_users_data WHERE userUuid = UNHEX(REPLACE(?, \'-\', \'\')) AND fieldId = ?',
		    dbFields = [userUuid, fieldId];

		if (err) {
			cb(err);
			return;
		}

		db.query(sql, dbFields, function(err, rows) {
			var data  = [],
			    rowNr = 0;

			if (err) {
				cb(err);
				return;
			}

			while (rows[rowNr] !== undefined) {
				data.push(rows[rowNr].data);
				rowNr ++;
			}

			cb(null, data);
		});
	});
}

/**
 * Get data field id by field name
 *
 * @param str fieldName
 * @param func cb(err, id)
 */
function getFieldId(fieldName, cb) {
	checkDbStructure(function() {
		var sql = 'SELECT id FROM user_data_fields WHERE name = ?',
		    dbFields;

		fieldName = _.trim(fieldName);
		dbFields  = [fieldName];

		db.query(sql, dbFields, function(err, rows) {
			// Use INSERT IGNORE to avoid race conditions
			var sql = 'INSERT IGNORE INTO user_data_fields (name) VALUES(?)';

			if (err) {
				cb(err);
				return;
			}

			if (rows.length) {
				cb(null, rows[0].id);
			} else {
				db.query(sql, dbFields, function(err) {
					if (err) {
						cb(err);
						return;
					}

					// Rerun this function, it should return correct now!
					getFieldId(fieldName, function(err, id) {
						cb(err, id);
					});
				});
			}
		});
	});
}

/**
 * Get data field name by field id
 *
 * @param int fieldId
 * @param func cb(err, str)
 */
function getFieldName(fieldId, cb) {
	checkDbStructure(function() {
		var sql      = 'SELECT name FROM user_data_fields WHERE id = ?',
		    dbFields = [fieldId];

		db.query(sql, dbFields, function(err, rows) {
			if (err) {
				cb(err);
				return;
			}

			if (rows.length) {
				cb(null, rows[0].name);
			} else {
				err = new Error('Field name not found for id: "' + fieldId + '"');
				cb(err);
			}
		});
	});
}

/**
 * Get users from the database
 *
 * @param obj options - {
 *                        'searchStr': 'foobar',              // String to search all fields + username for
 *                        'searchFieldsAnd': {                // Specific fields to search in, ALL must match
 *                          'firstname': 'John',
 *                          'lastname': ['Smith', 'Johnsson']
 *                        },
 *                        'searchFieldsOr': {                 // Specific fields to search in, ANY or more must match
 *                          'firstname': 'John',
 *                          'lastname': ['Smith', 'Johnsson']
 *                        },
 *                        'returnFields': [                   // What fields to return in the answer
 *                          'firstname',
 *                          'lastname'
 *                        ]
 *                      }
 * @param func cb(err, users) - users is an array of objects
 * /
function getUsers(options, cb) {
	var dbFields = [],
	    searchStr,
	    fieldName,
	    sql;

	options = options || {};

	sql = 'SELECT uuid, username FROM user_users u\n';

	sql += 'WHERE 1 = 1\n';

	if (options.searchStr !== undefined) {
		sql += '	AND uuid IN (SELECT userUuid FROM user_users_data WHERE value LIKE ?)\n';
		dbFields.push(options.searchStr);
	}

	if (options.searchFieldsAnd !== undefined) {
		for (fieldName in options.searchFieldsAnd) {
			if (options.searchFieldsAnd[fieldName])
		}
	}

}*/

/**
 * Hashes a new password
 *
 * @param str password
 * @param func cb(err, hash)
 */
function hashPassword(password, cb) {
	password = _.trim(password);

	bcrypt.genSalt(10, function(err, salt) {
		if (err) {
			log.error('larvituser: hashPassword() - ' + err.message);
			cb(err);
			return;
		}

		bcrypt.hash(password, salt, function(err, hash) {
			if (err) {
				log.error('larvituser: hashPassword() - ' + err.message);
				cb(err);
				return;
			}

			cb(null, hash);
		});
	});
}

/**
 * Replace user fields
 * IMPORTANT!!! Will clear all data not given in the fields parameter
 *
 * @param uuid userUuid
 * @param obj fields - field name as key, field values as array to that key - ex: {'role': ['admin','user']}
 * @param func cb(err)
 */
function replaceUserFields(userUuid, fields, cb) {
	var sql      = 'DELETE FROM user_users_data WHERE userUuid = UNHEX(REPLACE(?, \'-\', \'\'))',
	    dbFields = [userUuid];

	// We need to do this to make sure they all happend before we call the final cb
	function callSetUserField(userUuid, fieldName, fieldValue, nextParams, cb) {
		addUserField(userUuid, _.trim(fieldName), _.trim(fieldValue), function(err) {
			var entries;

			if (err) {
				cb(err);
			} else {
				if (nextParams.length) {
					entries = nextParams.shift();
					callSetUserField(entries.userUuid, entries.fieldName, entries.fieldValue, nextParams, cb);
				} else {
					cb();
				}
			}
		});
	}

	log.verbose('larvituser: replaceUserFields() - Removing previous user fields', {'userUuid': userUuid, 'sql': sql, 'dbFields': dbFields});

	db.query(sql, dbFields, function(err) {
		var userFieldParams = [],
		    i               = 0,
		    fieldName,
		    field,
		    firstEntries;

		if (err) {
			cb(err);
			return;
		}

		log.debug('larvituser: replaceUserFields() - User fields removed', {'userUuid': userUuid});

		for (fieldName in fields) {
			field = fields[fieldName];

			// Make sure this fields values are always represented as array
			if ( ! (field instanceof Array)) {
				field = [fields[fieldName]];
			}

			i = 0;
			while (field[i] !== undefined) {
				log.silly('larvituser: replaceUserFields() - Adding userFieldParam to array', {'userUuid': userUuid, 'fieldName': fieldName, 'fieldValue': field[i]});

				userFieldParams.push({
					'userUuid':   userUuid,
					'fieldName':  fieldName,
					'fieldValue': field[i]
				});

				i ++;
			}
		}

		if (userFieldParams.length) {
			firstEntries = userFieldParams.shift();
			callSetUserField(firstEntries.userUuid, firstEntries.fieldName, firstEntries.fieldValue, userFieldParams, function(err) {
				if (err) {
					cb(err);
				} else {
					cb();
				}
			});
		} else {
			cb();
		}
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
	getFieldId(fieldName, function(err, fieldId) {
		var sql      = 'DELETE FROM user_users_data WHERE userUuid = UNHEX(REPLACE(?, \'-\', \'\')) AND fieldId = ?',
		    dbFields = [userUuid, fieldId];

		if (err) {
			cb(err);
			return;
		}

		log.debug('larvituser: rmUserField() - Removing field from user', {'sql': sql, 'dbFields': dbFields});
		db.query(sql, dbFields, function(err) {
			if (err) {
				cb(err);
			} else {
				cb();
			}
		});
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
	var sql = 'UPDATE user_users SET password = ? WHERE uuid = UNHEX(REPLACE(?, \'-\', \'\'));';

	fromUuid(userUuid, function(err, user) {
		if (err) {
			cb(err);
			return;
		}

		if (user === false) {
			err = new Error('Invalid userUuid: "' + userUuid + '"');
			log.warn('larvituser: setPassword() - ' + err.message);
			cb(err);
			return;
		}

		if (newPassword === false) {
			db.query(sql, ['', userUuid], cb);
		} else {
			hashPassword(_.trim(newPassword), function(err, hash) {
				if (err) {
					cb(err);
					return;
				}

				db.query(sql, [hash, userUuid], cb);
			});
		}
	});
}

/**
 * Set the username for a user
 *
 * @param str userUuid
 * @param str newusername
 * @param fucn cb(err)
 */
function setUsername(userUuid, newUsername, cb) {
	var err;

	newUsername = _.trim(newUsername);

	if ( ! newUsername) {
		err = new Error('No new username supplied');
		log.warn('larvituser: setUsername() - ' + err.message);
		cb(err);
		return;
	}

	db.query('SELECT uuid FROM user_users WHERE username = ? AND uuid != UNHEX(REPLACE(?, \'-\', \'\'))', [newUsername, userUuid], function(err, rows) {
		if (err) {
			cb(err);
			return;
		}

		if (rows.length && utils.formatUuid(rows[0].uuid) !== userUuid) {
			err = new Error('Username is already taken');
			cb(err);
			return;
		}

		db.query('UPDATE user_users SET username = ? WHERE uuid = UNHEX(REPLACE(?, \'-\', \'\'))', [newUsername, userUuid], cb);
	});
}

function userBase() {
	var returnObj = {'fields': {}};

	/**
	 * Add a field with value
	 *
	 * @param str name
	 * @param str value
	 * @param func cb(err)
	 */
	returnObj.addField = function addField(name, value, cb) {
		var err;

		if (returnObj.uuid === undefined) {
			err = new Error('Cannot add field; no user loaded');
			cb(err);
			return;
		}

		addUserField(returnObj.uuid, name, value, function(err) {
			if (err) {
				cb(err);
			} else {
				if (returnObj.fields[name] === undefined) {
					returnObj.fields[name] = [];
				}

				returnObj.fields[name].push(value);
				cb();
			}
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
		var err;

		if (returnObj.uuid === undefined) {
			err = new Error('Cannot replace fields; no user loaded');
			cb(err);
			return;
		}

		replaceUserFields(returnObj.uuid, fields, function(err) {
			if (err) {
				cb(err);
			} else {
				// Reload everything
				fromUuid(returnObj.uuid, function(err, user) {
					if (err) {
						cb(err);
					} else {
						returnObj.fields = user.fields;
						cb();
					}
				});
			}
		});
	};

	/**
	 * Remove a field from this user
	 *
	 * @param str name
	 * @param func cb(err)
	 */
	returnObj.rmField = function rmField(name, cb) {
		var err;

		if (returnObj.uuid === undefined) {
			err = new Error('Cannot remove field; no user loaded');
			cb(err);
			return;
		}

		rmUserField(returnObj.uuid, name, function(err) {
			if (err) {
				cb(err);
			} else {
				delete returnObj.fields[name];
				cb();
			}
		});
	};

	returnObj.setPassword = function(newPassword, cb) {
		var err;

		if (returnObj.uuid === undefined) {
			err = new Error('Cannot set password; no user loaded');
			cb(err);
			return;
		}

		setPassword(returnObj.uuid, newPassword, cb);
	};

	returnObj.setUsername = function(newUsername, cb) {
		var err;

		if (returnObj.uuid === undefined) {
			err = new Error('Cannot set username; no user loaded');
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
 * @param func cb(err, res) - res is a bolean
 */
function usernameAvailable(username, cb) {
	checkDbStructure(function() {
		var sql = 'SELECT uuid FROM user_users WHERE username = ?',
		    dbFields;

		username = username.trim();
		dbFields = [username];

		db.query(sql, dbFields, function(err, rows) {
			if (err) {
				cb(err);
				return;
			}

			if (rows.length) {
				cb(null, false);
			} else {
				cb(null, true);
			}
		});
	});
}

exports.addUserField          = addUserField;
exports.checkDbStructure      = checkDbStructure;
exports.checkPassword         = checkPassword;
exports.create                = create;
exports.createUserDataFields  = createUserDataFields;
exports.createUserRolesRights = createUserRolesRights;
exports.createUserUsers       = createUserUsers;
exports.createUserUsersData   = createUserUsersData;
exports.fromField             = fromField;
exports.fromFields            = fromFields;
exports.fromUserAndPass       = fromUserAndPass;
exports.fromUsername          = fromUsername;
exports.fromUuid              = fromUuid;
exports.getFieldData          = getFieldData;
exports.getFieldId            = getFieldId;
exports.getFieldName          = getFieldName;
exports.hashPassword          = hashPassword;
exports.replaceUserFields     = replaceUserFields;
exports.rmUserField           = rmUserField;
exports.setPassword           = setPassword;
exports.setUsername           = setUsername;
exports.usernameAvailable     = usernameAvailable;