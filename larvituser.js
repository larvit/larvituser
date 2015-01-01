/*jslint node: true */
'use strict';

var db             = require('larvitdb'),
    log            = require('winston'),
    bcrypt         = require('bcrypt'),
    dbChecked      = false,
    dbCheckStarted = false;

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
			log.error(err);
			callback(err);
			return;
		}

		if (res)
			callback(null, true);
		else
			callback(null, false);
	});
};

/**
 * Creates a new user (and adds to it to db)
 *
 * @param str username
 * @param str password (plain text)
 * @param obj fields - key, value pairs, where value can be an array of values
 * @param func callback(err, user) - user being an instance of the new user
 */
exports.create = function create(username, password, fields, callback) {
	checkDbStructure(function() {
		log.verbose('Trying to create user', {'username': username, 'fields': fields});

		var hashedPassword,
		    userId;

		username = username.trim();
		password = password.trim();

		if ( ! username.length) {
			var err = new Error('Trying to create user with empty username');
			log.warn(err);
			callback(err);
			return;
		}

		// Control if username is available
		exports.usernameAvailable(username, function(err, res) {
			if (err) {
				callback(err);
			} else if ( ! res) {
				var customErr = new Error('Trying to create user with taken username: "' + username + '"');
				log.info(customErr);
				callback(customErr);
			} else {
				log.debug('Username available, moving on to hashing password', {'username': username});
				hashPassword();
			}
		});

		// Hash password - called from the above callback
		function hashPassword() {
			exports.hashPassword(password, function(err, hash) {
				if (err) {
					callback(err);
				} else {
					hashedPassword = hash;
					log.debug('Password hashed, moving on to writing username and password to database', {'username': username});
					writeToDb();
				}
			});
		}

		// Write to database - called from the above callback
		function writeToDb() {
			var sql      = 'INSERT INTO user_users (username, password) VALUES(?,?);',
			    dbFields = [username, hashedPassword];

			log.verbose('Trying to write username and password to database', {'sql': sql, 'fields': dbFields});

			db.query(sql, dbFields, function(err, res) {
				if (err) {
					callback(err);
					return;
				}

				userId = res.insertId;
				log.debug('Write to db successfull! Moving on to writing fields to database', {'username': username, 'userId': userId});
				writeFieldsToDb();
			});
		}

		// Write the fields to the db
		function writeFieldsToDb() {
			replaceUserFields(userId, fields, function(err) {
				if (err) {
					log.error(err);
					callback(err);
					return;
				}

				log.debug('Fields written successfully to database', {'username': username, 'userId': userId, 'fields': fields});

				exports.fromId(userId, function(err, user) {
					if (err) {
						log.error(err);
						callback(err);
						return;
					}

					callback(null, user);
				});
			});
		}
	});
};

/**
 * Instanciate user object from user id
 *
 * @param int userId
 * @param func callback(err, userObj)
 */
exports.fromId = function fromId(userId, callback) {
	checkDbStructure(function() {
		var returnObj = userBase(),
		    dbFields  = [userId];

		var sql = 'SELECT ' +
		          	'u.id, ' +
		          	'u.username, ' +
		          	'uf.id AS field_id, ' +
		          	'uf.name AS field_name, ' +
		          	'ud.data AS field_data ' +
		          'FROM ' +
		          	'user_users u ' +
		          	'LEFT JOIN user_users_data  ud ON ud.user_id = u.id ' +
		          	'LEFT JOIN user_data_fields uf ON uf.id      = ud.field_id ' +
		          'WHERE u.id = ?';

		db.query(sql, dbFields, function(err, rows) {
			if (err) {
				callback(err);
				return;
			}

			if (rows.length === 0) {
				var customErr = new Error('No user found for user ID: "' + userId + '"');
				customErr.sql = sql;
				log.debug(customErr);
				callback(customErr);
				return;
			}

			returnObj.fields   = {};
			returnObj.id       = rows[0].id;
			returnObj.username = rows[0].username;

			var rowNr  = 0,
			    fields = returnObj.fields;

			while (rows[rowNr] !== undefined) {
				var row = rows[rowNr];

				if (row.field_id) {
					if (fields[row.field_name] === undefined)
						fields[row.field_name] = [];

					fields[row.field_name].push(row.field_data);
				}

				rowNr++;
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
	checkDbStructure(function() {
		username = username.trim();
		password = password.trim();

		var sql    = 'SELECT id, password FROM user_users WHERE username = ?',
		    fields = [username];

		db.query(sql, fields, function(err, rows) {
			if (err) {
				callback(err);
				return;
			}

			if (rows.length === 0) {
				var customErr = new Error('No user found for username: "' + username + '"');
				customErr.sql = sql;
				log.verbose(customErr);
				callback(customErr);
				return;
			}

			exports.checkPassword(password, rows[0].password, function(err, res) {
				if (err) {
					log.error(err);
					callback(err);
					return;
				}

				if (res === true) {

					// Password check is ok, use fromId() to get the user instance
					exports.fromId(rows[0].id, callback);
				} else {
					var customErr = new Error('Login failed, wrong password. Username: "' + username + '"');
					log.info(customErr);
					callback(customErr);
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
	checkDbStructure(function() {
		username = username.trim();

		var sql    = 'SELECT id FROM user_users WHERE username = ?',
		    fields = [username];

		db.query(sql, fields, function(err, rows) {
			if (err) {
				callback(err);
				return;
			}

			if (rows.length === 0) {
				var customErr = new Error('No user found for username: "' + username + '"');
				customErr.sql = sql;
				log.debug(customErr);
				callback(customErr);
				return;
			}

			// Use fromId() to get the user instance
			exports.fromId(rows[0].id, callback);
		});
	});
};

/**
 * Get field data for a user
 *
 * @param int userId
 * @param str fieldName
 * @param func callback(err, data) - data is always an array of data (or empty array)
 */
exports.getFieldData = function getFieldData(userId, fieldName, callback) {
	exports.getFieldId(fieldName, function(err, fieldId) {
		if (err) {
			callback(err);
			return;
		}

		var sql      = 'SELECT data FROM user_users_data WHERE user_id = ? AND field_id = ?',
		    dbFields = [userId, fieldId];

		db.query(sql, dbFields, function(err, rows) {
			if (err) {
				callback(err);
				return;
			}

			var data  = [],
			    rowNr = 0;

			while (rows[rowNr] !== undefined) {
				data.push(rows[rowNr].data);
				rowNr++;
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
	checkDbStructure(function() {
		fieldName = fieldName.trim();

		var sql      = 'SELECT id FROM user_data_fields WHERE name = ?',
		    dbFields = [fieldName];

		db.query(sql, dbFields, function(err, rows) {
			if (err) {
				callback(err);
				return;
			}

			if (rows.length) {
				callback(null, rows[0].id);
			} else {
				// Use INSERT IGNORE to avoid race conditions
				var sql = 'INSERT IGNORE INTO user_data_fields (name) VALUES(?)';

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
	checkDbStructure(function() {
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
				var customErr = new Error('Field name not found for id: "' + fieldId + '"');
				callback(customErr);
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
			log.error(err);
			callback(err);
			return;
		}

		bcrypt.hash(password, salt, function(err, hash) {
			if (err) {
				log.error(err);
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
	checkDbStructure(function() {
		username = username.trim();

		var sql    = 'SELECT id FROM user_users WHERE username = ?',
		    fields = [username];

		db.query(sql, fields, function(err, rows) {
			if (err) {
				callback(err);
				return;
			}

			if (rows.length)
				callback(null, false);
			else
				callback(null, true);
		});
	});
};

function userBase() {
	var returnObj = {};

	/**
	 * Add a field with value
	 *
	 * @param str name
	 * @param str value
	 * @param func callback(err)
	 */
	returnObj.addField = function(name, value, callback) {
		if (returnObj.id === undefined) {
			var err = new Error('Cannot add field; no user loaded');
			callback(err);
			return;
		}

		setUserField(returnObj.id, name, value, function(err) {
			if (err) {
				callback(err);
			} else {
				if (returnObj.fields[name] === undefined)
					returnObj.fields[name] = [];

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
		if (returnObj.id === undefined) {
			var err = new Error('Cannot replace fields; no user loaded');
			callback(err);
			return;
		}

		replaceUserFields(returnObj.id, fields, function(err) {
			if (err) {
				callback(err);
			} else {
				// Reload everything
				exports.fromId(returnObj.id, function(err, user) {
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
		if (returnObj.id === undefined) {
			var err = new Error('Cannot remove field; no user loaded');
			callback(err);
			return;
		}

		rmUserField(returnObj.id, name, function(err) {
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
 * Replace user fields
 * IMPORTANT!!! Will clear all data not given in the fields parameter
 *
 * @param int userId
 * @param obj fields - field name as key, field values as array to that key - ex: {'role': ['admin','user']}
 * @param func callback(err)
 */
function replaceUserFields(userId, fields, callback) {
	var sql      = 'DELETE FROM user_users_data WHERE user_id = ?',
	    dbFields = [userId];

	log.verbose('Removing previous user fields', {'userId': userId, 'sql': sql, 'dbFields': dbFields});

	db.query(sql, dbFields, function(err) {
		if (err) {
			callback(err);
			return;
		}

		log.debug('User fields removed', {'userId': userId});

		var userFieldParams = [];

		for (var fieldName in fields) {
			var field = fields[fieldName],
			    i     = 0;

			// Make sure this fields values are always represented as array
			if (field.constructor !== Array)
				field = [fields[fieldName]];

			while (field[i] !== undefined) {
				log.silly('Adding userFieldParam to array', {'userId': userId, 'fieldName': fieldName, 'fieldValue': field[i]});

				userFieldParams.push({
					'userId': userId,
					'fieldName': fieldName,
					'fieldValue': field[i]
				});

				i++;
			}
		}

		var firstEntries = userFieldParams.shift();
		callSetUserField(firstEntries.userId, firstEntries.fieldName, firstEntries.fieldValue, userFieldParams, function(err) {
			if (err)
				callback(err);
			else
				callback();
		});
	});

	// We need to do this to make sure they all happend before we call the final callback
	function callSetUserField(userId, fieldName, fieldValue, nextParams, callback) {
		setUserField(userId, fieldName, fieldValue, function(err) {
			if (err) {
				callback(err);
			} else {
				if (nextParams.length) {
					var entries = nextParams.shift();
					callSetUserField(entries.userId, entries.fieldName, entries.fieldValue, nextParams, callback);
				} else {
					callback();
				}
			}
		});
	}
}

/**
 * Remove a user field
 *
 * @param int userId
 * @param str fieldName
 * @param func callback(err)
 */
function rmUserField(userId, fieldName, callback) {
	exports.getFieldId(fieldName, function(err, fieldId) {
		if (err) {
			callback(err);
			return;
		}

		var sql      = 'DELETE FROM user_users_data WHERE user_id = ? AND field_id = ?',
		    dbFields = [userId, fieldId];

		log.debug('Removing field from user', {'sql': sql, 'dbFields': dbFields});
		db.query(sql, dbFields, function(err) {
			if (err)
				callback(err);
			else
				callback();
		});
	});
}

/**
 * Set a single user field
 *
 * @param int userId
 * @param str fieldName
 * @param str fieldValue
 * @param func callback(err)
 */
function setUserField(userId, fieldName, fieldValue, callback) {
	fieldValue = String(fieldValue);
	fieldValue = fieldValue.trim();

	exports.getFieldId(fieldName, function(err, fieldId) {
		if (err) {
			log.error(err);
			return;
		}

		var sql      = 'INSERT INTO user_users_data (user_id, field_id, data) VALUES(?,?,?)',
		    dbFields = [userId, fieldId, fieldValue];

		db.query(sql, dbFields, function(err) {
			if (err) {
				callback(err);
				return;
			}

			callback();
		});
	});
}

/**
 * Control the database structure and create if it not exists
 */
function checkDbStructure(callback) {
	if (dbChecked) {
		callback();
	} else if (dbCheckStarted) {
		// If it have started, but not finnished, run it again next tick until it is done
		setImmediate(function() {
			checkDbStructure(callback);
		});
	} else {
		dbCheckStarted = true;
		var localFuncs = {};

		// We need to run the checks for user_users first
		// If this succeeds, run all the others from it
		db.query('DESCRIBE `user_users`', function(err) {
			if (err) {
				// Table does not exist, create it
				if (err.code === 'ER_NO_SUCH_TABLE') {
					log.info('Table user_users did not exist, creating.');

					var sql = 'CREATE TABLE `user_users` (' +
					    '	`id` bigint(20) NOT NULL AUTO_INCREMENT,' +
					    '	`username` varchar(255) COLLATE utf8_unicode_ci NOT NULL,' +
					    '	`password` varchar(100) COLLATE utf8_unicode_ci NOT NULL,' +
					    '	PRIMARY KEY (`id`),' +
					    '	UNIQUE KEY `username` (`username`)' +
					    ') ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;';
					db.query(sql, function(err) {
						if (err) {
							log.error('Failed creating table user_users.');
							process.exit(1);
						}

						localFuncs.checkFields();
					});
				} else {
					log.error(err);
					process.exit(1);
				}
			} else {
				localFuncs.checkFields();
			}
		});

		localFuncs.checkFields = function() {
			db.query('DESCRIBE `user_data_fields`', function(err) {
				if (err) {
					// Table does not exist, create it
					if (err.code === 'ER_NO_SUCH_TABLE') {
						log.info('Table user_data_fields did not exist, creating.');

						var sql = 'CREATE TABLE `user_data_fields` (' +
						        '	`id` int(11) NOT NULL AUTO_INCREMENT,' +
						        '	`name` varchar(255) COLLATE utf8_unicode_ci NOT NULL,' +
						        '	PRIMARY KEY (`id`),' +
						        '	UNIQUE KEY `name` (`name`)' +
						        ') ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;';
						db.query(sql, function(err) {
							if (err) {
								log.error('Failed creating table user_data_fields.');
								process.exit(1);
							}

							localFuncs.rolesRights();
						});
					} else {
						log.error(err);
						process.exit(1);
					}
				} else {
					localFuncs.rolesRights();
				}
			});
		};

		localFuncs.rolesRights = function() {
			db.query('DESCRIBE `user_roles_rights`', function(err) {
				if (err) {
					// Table does not exist, create it
					if (err.code === 'ER_NO_SUCH_TABLE') {
						log.info('Table user_roles_rights did not exist, creating.');

						var sql = 'CREATE TABLE `user_roles_rights` (' +
						        '	`role` varchar(128) NOT NULL,' +
						        '	`uri` varchar(128) NOT NULL,' +
						        '	PRIMARY KEY (`role`,`uri`)' +
						        ') ENGINE=InnoDB DEFAULT CHARSET=utf8;';
						db.query(sql, function(err) {
							if (err) {
								log.error('Failed creating table user_roles_rights.');
								process.exit(1);
							}

							localFuncs.usersData();
						});
					} else {
						log.error(err);
						process.exit(1);
					}
				} else {
					localFuncs.usersData();
				}
			});
		};

		localFuncs.usersData = function() {
			db.query('DESCRIBE `user_users_data`', function(err) {
				if (err) {
					// Table does not exist, create it
					if (err.code === 'ER_NO_SUCH_TABLE') {
						log.info('Table user_users_data did not exist, creating.');

						var sql = 'CREATE TABLE `user_users_data` (' +
						        '	`id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,' +
						        '	`user_id` bigint(20) DEFAULT NULL,' +
						        '	`field_id` int(11) DEFAULT NULL,' +
						        '	`data` text COLLATE utf8_unicode_ci NOT NULL,' +
						        '	PRIMARY KEY (`id`),' +
						        '	KEY `users_fields` (`user_id`,`field_id`),' +
						        '	KEY `field_id` (`field_id`),' +
						        '	CONSTRAINT `user_users_data_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `user_users` (`id`),' +
						        '	CONSTRAINT `user_users_data_ibfk_2` FOREIGN KEY (`field_id`) REFERENCES `user_data_fields` (`id`)' +
						        ') ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;';
						db.query(sql, function(err) {
							if (err) {
								log.error('Failed creating table user_users_data.');
								process.exit(1);
							}

							dbChecked = true;
							callback();
						});
					} else {
						log.error(err);
						process.exit(1);
					}
				} else {
					dbChecked = true;
					callback();
				}
			});
		};
	}

}