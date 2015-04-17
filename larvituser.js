'use strict';

var db      = require('larvitdb'),
    log     = require('winston'),
    bcrypt  = require('bcrypt'),
    uuidLib = require('node-uuid');

exports.dbChecked      = false;
exports.dbCheckStarted = false;

exports.createUserUsers = function(callback) {
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
				'	`uuid` char(36) CHARACTER SET ascii NOT NULL,' +
				'	`username` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,' +
				'	`password` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,' +
				'	PRIMARY KEY (`uuid`),' +
				'	UNIQUE KEY `username` (`username`)' +
				') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;';
			db.query(sql, function(err) {
				if (err) {
					throw err;
				}

				callback(err);
			});
		} else {
			callback(err);
		}
	});
};

exports.createUserDataFields = function(callback) {
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

				callback();
			});
		} else {
			callback();
		}
	});
};

exports.createUserRolesRights = function(callback) {
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

				callback();
			});
		} else {
			callback();
		}
	});
};

exports.createUserUsersData = function(callback) {
	db.query('SHOW TABLES LIKE \'user_users_data\'', function(err, rows) {
		var sql;

		if (err) {
			throw err;
		}

		if ( ! rows.length) {
			// Table does not exist, create it
			log.info('larvituser: createUserUsersData() - Table user_users_data did not exist, creating.');

			sql = 'CREATE TABLE `user_users_data` (' +
				'	`id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,' +
				'	`userUuid` char(36) CHARACTER SET ascii NOT NULL,' +
				'	`fieldId` int(11) unsigned NOT NULL,' +
				'	`data` text COLLATE utf8mb4_unicode_ci NOT NULL,' +
				'	PRIMARY KEY (`id`),' +
				'	KEY `userUuid` (`userUuid`),' +
				'	KEY `fieldId` (`fieldId`),' +
				'	CONSTRAINT `user_users_data_ibfk_1` FOREIGN KEY (`userUuid`) REFERENCES `user_users` (`uuid`),' +
				'	CONSTRAINT `user_users_data_ibfk_2` FOREIGN KEY (`fieldId`) REFERENCES `user_data_fields` (`id`)' +
				') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;';
			db.query(sql, function(err) {
				if (err) {
					throw err;
				}

				callback();
			});
		} else {
			callback();
		}
	});
};

/**
 * Control the database structure and create if it not exists
 */
exports.checkDbStructure = function checkDbStructure(callback) {
	if (exports.dbChecked) {
		callback();
	} else if (exports.dbCheckStarted) {
		// If it have started, but not finnished, run it again next tick until it is done
		setImmediate(function() {
			exports.checkDbStructure(callback);
		});
	} else {
		exports.dbCheckStarted = true;

		exports.createUserUsers(function() {
			exports.createUserDataFields(function() {
				exports.createUserRolesRights(function() {
					exports.createUserUsersData(function() {
						exports.dbChecked = true;
						callback();
					});
				});
			});
		});
	}
};

/**
 * Add a single user field to database
 *
 * @param uuid userUuid
 * @param str fieldName
 * @param str fieldValue
 * @param func callback(err)
 */
exports.addUserField = function addUserField(userUuid, fieldName, fieldValue, callback) {
	fieldValue = String(fieldValue).trim();

	exports.getFieldId(fieldName, function(err, fieldId) {
		var sql      = 'INSERT INTO user_users_data (userUuid, fieldId, data) VALUES(?,?,?)',
		    dbFields = [userUuid, fieldId, fieldValue];

		if (err) {
			log.error('larvituser: addUserField() - ' + err.message);
			return;
		}

		db.query(sql, dbFields, function(err) {
			if (err) {
				callback(err);
				return;
			}

			callback();
		});
	});
};

/**
 * Replace user fields
 * IMPORTANT!!! Will clear all data not given in the fields parameter
 *
 * @param uuid userUuid
 * @param obj fields - field name as key, field values as array to that key - ex: {'role': ['admin','user']}
 * @param func callback(err)
 */
exports.replaceUserFields = function replaceUserFields(userUuid, fields, callback) {
	var sql      = 'DELETE FROM user_users_data WHERE userUuid = ?',
	    dbFields = [userUuid];

	// We need to do this to make sure they all happend before we call the final callback
	function callSetUserField(userUuid, fieldName, fieldValue, nextParams, callback) {
		exports.addUserField(userUuid, fieldName, fieldValue, function(err) {
			var entries;

			if (err) {
				callback(err);
			} else {
				if (nextParams.length) {
					entries = nextParams.shift();
					callSetUserField(entries.userUuid, entries.fieldName, entries.fieldValue, nextParams, callback);
				} else {
					callback();
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
			callback(err);
			return;
		}

		log.debug('larvituser: replaceUserFields() - User fields removed', {'userUuid': userUuid});

		for (fieldName in fields) {
			field = fields[fieldName];

			// Make sure this fields values are always represented as array
			if (field.constructor !== Array) {
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

		firstEntries = userFieldParams.shift();
		callSetUserField(firstEntries.userUuid, firstEntries.fieldName, firstEntries.fieldValue, userFieldParams, function(err) {
			if (err) {
				callback(err);
			} else {
				callback();
			}
		});
	});
};

/**
 * Remove a user field
 *
 * @param uuid userUuid
 * @param str fieldName
 * @param func callback(err)
 */
exports.rmUserField = function rmUserField(userUuid, fieldName, callback) {
	exports.getFieldId(fieldName, function(err, fieldId) {
		var sql      = 'DELETE FROM user_users_data WHERE userUuid = ? AND fieldId = ?',
		    dbFields = [userUuid, fieldId];

		if (err) {
			callback(err);
			return;
		}

		log.debug('larvituser: rmUserField() - Removing field from user', {'sql': sql, 'dbFields': dbFields});
		db.query(sql, dbFields, function(err) {
			if (err) {
				callback(err);
			} else {
				callback();
			}
		});
	});
};

function userBase() {
	var returnObj = {'fields': {}};

	/**
	 * Add a field with value
	 *
	 * @param str name
	 * @param str value
	 * @param func callback(err)
	 */
	returnObj.addField = function(name, value, callback) {
		var err;

		if (returnObj.uuid === undefined) {
			err = new Error('Cannot add field; no user loaded');
			callback(err);
			return;
		}

		exports.addUserField(returnObj.uuid, name, value, function(err) {
			if (err) {
				callback(err);
			} else {
				if (returnObj.fields[name] === undefined) {
					returnObj.fields[name] = [];
				}

				returnObj.fields[name].push(value);
				callback();
			}
		});
	};

	/**
	 * Replace all fields
	 * IMPORTANT!!! Will clear all data not given in the fields parameter
	 *
	 * @param obj fields - field name as key, field values as array to that key - ex: {'role': ['admin','user']}
	 * @param func callback(err)
	 */
	returnObj.replaceFields = function(fields, callback) {
		var err;

		if (returnObj.uuid === undefined) {
			err = new Error('Cannot replace fields; no user loaded');
			callback(err);
			return;
		}

		exports.replaceUserFields(returnObj.uuid, fields, function(err) {
			if (err) {
				callback(err);
			} else {
				// Reload everything
				exports.fromUuid(returnObj.uuid, function(err, user) {
					if (err) {
						callback(err);
					} else {
						returnObj.fields = user.fields;
						callback();
					}
				});
			}
		});
	};

	/**
	 * Remove a field from this user
	 *
	 * @param str name
	 * @param func callback(err)
	 */
	returnObj.rmField = function(name, callback) {
		var err;

		if (returnObj.uuid === undefined) {
			err = new Error('Cannot remove field; no user loaded');
			callback(err);
			return;
		}

		exports.rmUserField(returnObj.uuid, name, function(err) {
			if (err) {
				callback(err);
			} else {
				delete returnObj.fields[name];
				callback();
			}
		});
	};

	return returnObj;
}

/**
 * Checks a password for validity
 *
 * @param str password - plain text password
 * @param str hash - hash to check password against
 * @param func callback(err, res) res is boolean
 */
exports.checkPassword = function checkPassword(password, hash, callback) {
	password = password.trim();

	bcrypt.compare(password, hash, function(err, res) {
		if (err) {
			log.error('larvituser: checkPassword() - ' + err.message);
			callback(err);
			return;
		}

		if (res) {
			callback(null, true);
		} else {
			callback(null, false);
		}
	});
};

/**
 * Creates a new user (and adds to it to db)
 *
 * @param str username
 * @param str password (plain text)
 * @param obj fields - key, value pairs, where value can be an array of values
 * @param uuid custom uuid - if not supplied a random will be generated
 * @param func callback(err, user) - user being an instance of the new user
 */
exports.create = function create(username, password, fields, uuid, callback) {
	var hashedPassword,
	    err;

	if (uuid instanceof Function && callback === undefined) {
		callback = uuid;
		uuid     = uuidLib.v4();
	} else if (uuid === undefined) {
		uuid = uuidLib.v4();
	}

	// Write the fields to the db
	function writeFieldsToDb() {
		exports.replaceUserFields(uuid, fields, function(err) {
			if (err) {
				log.error('larvituser: create() - ' + err.message);
				callback(err);
				return;
			}

			log.debug('larvituser: create() - Fields written successfully to database', {'username': username, 'userUuid': uuid, 'fields': fields});

			exports.fromUuid(uuid, function(err, user) {
				if (err) {
					log.error('larvituser: create() - ' + err.message);
					callback(err);
					return;
				}

				callback(null, user);
			});
		});
	}

	// Write to database - called from the above callback
	function writeToDb() {
		var sql      = 'INSERT INTO user_users (uuid, username, password) VALUES(?,?,?);',
		    dbFields = [uuid, username, hashedPassword];

		log.verbose('larvituser: create() - Trying to write username and password to database', {'sql': sql, 'fields': dbFields});

		db.query(sql, dbFields, function(err) {
			if (err) {
				callback(err);
				return;
			}

			log.debug('larvituser: create() - Write to db successfull! Moving on to writing fields to database', {'username': username, 'uuid': uuid});
			writeFieldsToDb();
		});
	}

	// Hash password - called from the above callback
	function hashPassword() {
		exports.hashPassword(password, function(err, hash) {
			if (err) {
				callback(err);
			} else {
				hashedPassword = hash;
				log.debug('larvituser: create() - Password hashed, moving on to writing username and password to database', {'username': username});
				writeToDb();
			}
		});
	}

	exports.checkDbStructure(function() {
		log.verbose('larvituser: create() - Trying to create user', {'username': username, 'fields': fields});

		username = username.trim();
		password = password.trim();

		if ( ! username.length) {
			err = new Error('Trying to create user with empty username');
			log.warn('larvituser: create() - ' + err.message);
			callback(err);
			return;
		}

		// Check if username is available
		exports.usernameAvailable(username, function(err, res) {
			if (err) {
				callback(err);
			} else if ( ! res) {
				err = new Error('Trying to create user with taken username: "' + username + '"');
				log.info('larvituser: create() - ' + err.message);
				callback(err);
			} else {
				log.debug('larvituser: create() - Username available, moving on to hashing password', {'username': username});
				hashPassword();
			}
		});
	});
};

/**
 * Instanciate user object from user id
 *
 * @param int userUuid
 * @param func callback(err, userObj) - userObj will be false if no user is found
 */
exports.fromUuid = function fromUuid(userUuid, callback) {
	exports.checkDbStructure(function() {
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
		                'WHERE u.uuid = ?';

		log.silly('larvituser: fromUuid() - SQL query', {'sql': sql, 'dbFields': dbFields});

		db.query(sql, dbFields, function(err, rows) {
			if (err) {
				callback(err);
				return;
			}

			if (rows.length === 0) {
				err = new Error('No user found for userUuid: "' + userUuid + '"');
				err.sql = sql;
				log.debug('larvituser: create() - ' + err.message);
				callback(null, false);
				return;
			}

			returnObj.uuid     = rows[0].uuid;
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

			callback(null, returnObj);
		});
	});
};

/**
 * Create a user object from username and password
 *
 * @param str username
 * @param str password
 * @param func callback(err, user) - "user" being a new user object
 */
exports.fromUserAndPass = function fromUserAndPass(username, password, callback) {
	exports.checkDbStructure(function() {
		var sql = 'SELECT uuid, password FROM user_users WHERE username = ?',
		    dbFields;

		username = username.trim();
		password = password.trim();
		dbFields = [username];

		db.query(sql, dbFields, function(err, rows) {
			if (err) {
				callback(err);
				return;
			}

			if (rows.length === 0) {
				err = new Error('No user found for username: "' + username + '"');
				err.sql = sql;
				log.verbose('larvituser: fromUserAndPass() - ' + err.message);
				callback(err);
				return;
			}

			exports.checkPassword(password, rows[0].password, function(err, res) {
				if (err) {
					log.error('larvituser: fromUserAndPass() - ' + err.message);
					callback(err);
					return;
				}

				if (res === true) {

					// Password check is ok, use fromUuid() to get the user instance
					exports.fromUuid(rows[0].uuid, callback);
				} else {
					err = new Error('Login failed, wrong password. Username: "' + username + '"');
					log.info('larvituser: fromUserAndPass() - ' + err.message);
					callback(err);
				}
			});
		});
	});
};

/**
 * Create a user object from username
 *
 * @param str username
 * @param func callback(err, user) - "user" being a new user object
 */
exports.fromUsername = function fromUsername(username, callback) {
	exports.checkDbStructure(function() {
		var sql,
		    dbFields;

		username = username.trim();
		sql      = 'SELECT uuid FROM user_users WHERE username = ?';
		dbFields = [username];

		db.query(sql, dbFields, function(err, rows) {
			if (err) {
				callback(err);
				return;
			}

			if (rows.length === 0) {
				err = new Error('No user found for username: "' + username + '"');
				err.sql = sql;
				log.debug('larvituser: fromUsername() - ' + err.message);
				callback(err);
				return;
			}

			// Use fromUuid() to get the user instance
			exports.fromUuid(rows[0].uuid, callback);
		});
	});
};

/**
 * Get field data for a user
 *
 * @param int userUuid
 * @param str fieldName
 * @param func callback(err, data) - data is always an array of data (or empty array)
 */
exports.getFieldData = function getFieldData(userUuid, fieldName, callback) {
	exports.getFieldId(fieldName, function(err, fieldId) {
		var sql      = 'SELECT data FROM user_users_data WHERE userUuid = ? AND fieldId = ?',
		    dbFields = [userUuid, fieldId];

		if (err) {
			callback(err);
			return;
		}

		db.query(sql, dbFields, function(err, rows) {
			var data  = [],
			    rowNr = 0;

			if (err) {
				callback(err);
				return;
			}

			while (rows[rowNr] !== undefined) {
				data.push(rows[rowNr].data);
				rowNr ++;
			}

			callback(null, data);
		});
	});
};

/**
 * Get data field id by field name
 *
 * @param str fieldName
 * @param func callback(err, id)
 */
exports.getFieldId = function getFieldId(fieldName, callback) {
	exports.checkDbStructure(function() {
		var sql = 'SELECT id FROM user_data_fields WHERE name = ?',
		    dbFields;

		fieldName = fieldName.trim();
		dbFields  = [fieldName];

		db.query(sql, dbFields, function(err, rows) {
			// Use INSERT IGNORE to avoid race conditions
			var sql = 'INSERT IGNORE INTO user_data_fields (name) VALUES(?)';

			if (err) {
				callback(err);
				return;
			}

			if (rows.length) {
				callback(null, rows[0].id);
			} else {
				db.query(sql, dbFields, function(err) {
					if (err) {
						callback(err);
						return;
					}

					// Rerun this function, it should return correct now!
					exports.getFieldId(fieldName, function(err, id) {
						callback(err, id);
					});
				});
			}
		});
	});
};

/**
 * Get data field name by field id
 *
 * @param int fieldId
 * @param func callback(err, str)
 */
exports.getFieldName = function getFieldName(fieldId, callback) {
	exports.checkDbStructure(function() {
		var sql      = 'SELECT name FROM user_data_fields WHERE id = ?',
		    dbFields = [fieldId];

		db.query(sql, dbFields, function(err, rows) {
			if (err) {
				callback(err);
				return;
			}

			if (rows.length) {
				callback(null, rows[0].name);
			} else {
				err = new Error('Field name not found for id: "' + fieldId + '"');
				callback(err);
			}
		});
	});
};

/**
 * Hashes a new password
 *
 * @param str password
 * @param func callback(err, hash)
 */
exports.hashPassword = function hashPassword(password, callback) {
	password = password.trim();

	bcrypt.genSalt(10, function(err, salt) {
		if (err) {
			log.error('larvituser: hashPassword() - ' + err.message);
			callback(err);
			return;
		}

		bcrypt.hash(password, salt, function(err, hash) {
			if (err) {
				log.error('larvituser: hashPassword() - ' + err.message);
				callback(err);
				return;
			}

			callback(null, hash);
		});
	});
};

/**
 * Checks if a unsername is available
 *
 * @param str username
 * @param func callback(err, res) - res is a bolean
 */
exports.usernameAvailable = function usernameAvailable(username, callback) {
	exports.checkDbStructure(function() {
		var sql = 'SELECT uuid FROM user_users WHERE username = ?',
		    dbFields;

		username = username.trim();
		dbFields = [username];

		db.query(sql, dbFields, function(err, rows) {
			if (err) {
				callback(err);
				return;
			}

			if (rows.length) {
				callback(null, false);
			} else {
				callback(null, true);
			}
		});
	});
};