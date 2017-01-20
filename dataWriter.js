'use strict';

const	EventEmitter	= require('events').EventEmitter,
	eventEmitter	= new EventEmitter(),
	dbmigration	= require('larvitdbmigration')({'tableName': 'users_db_version', 'migrationScriptsPath': __dirname + '/dbmigration'}),
	helpers	= require(__dirname + '/helpers.js'),
	lUtils	= require('larvitutils'),
	amsync	= require('larvitamsync'),
	async	= require('async'),
	log	= require('winston'),
	db	= require('larvitdb'),
	logPrefix	= 'larvituser: ./dataWriter.js - ';

let	readyInProgress	= false,
	isReady	= false,
	intercom;

function addUserField(params, deliveryTag, msgUuid, cb) {
	const	uuid	= params.uuid,
		name	= params.name,
		sql	= 'REPLACE INTO user_data_fields (uuid, name) VALUES(?,?)';

	if (cb === undefined || typeof cb !== 'function') {
		cb = function() {};
	}

	db.query(sql, [lUtils.uuidToBuffer(uuid), name], function(err) {
		if (err) log.warn(logPrefix + 'addUserField - ' + err.message);
		exports.emitter.emit(msgUuid, err);
		cb(err);
	});
}

function addUserDataFields(params, deliveryTag, msgUuid, cb) {
	const tasks	= [],
		dbValues	= [],
		userUuidBuffer = lUtils.uuidToBuffer(params.userUuid);

	if (cb === undefined || typeof cb !== 'function') {
		cb = function() {};
	}

	let sql	= 'INSERT INTO user_users_data (userUuid, fieldUuid, data) VALUES';

	for (let key in params.fields) {
		tasks.push(function (cb) {
			helpers.getFieldUuid(key, function (err, fieldUuid) {

				if (err) {
					log.warn(logPrefix + 'addUserDataFields() - ' + err.message);
					cb(err);
					return;
				}

				if (params.fields[key] === null || params.fields[key] === undefined) {
					sql += '(?,?,NULL),';
					dbValues.push(userUuidBuffer, lUtils.uuidToBuffer(fieldUuid));
				} else {
					if (Array.isArray(params.fields[key])) {
						for (let i = 0; i < params.fields[key].length; i ++) {
							sql += '(?,?,?),';
							dbValues.push(userUuidBuffer, lUtils.uuidToBuffer(fieldUuid), params.fields[key][i]);
						}
					} else {
						sql += '(?,?,?),';
						dbValues.push(userUuidBuffer, lUtils.uuidToBuffer(fieldUuid), params.fields[key]);
					}
				}

				cb(err);
			});
		});
	}

	async.parallel(tasks, function (err) {
		if (err) {
			log.warn(logPrefix + 'addUserDataFields() - ' + err.message);
			exports.emitter.emit(msgUuid, err);
			cb(err);
			return;
		}

		sql = sql.substring(0, sql.length - 1);

		if (dbValues.length === 0) {
			log.info(logPrefix + 'addUserDataFields() - ' + 'No fields or field data specifed');
			exports.emitter.emit(msgUuid);
			cb();
			return;
		}

		db.query(sql, dbValues, function (err) {
			if (err) { log.warn(logPrefix + ' addUserDataFields() - ' + err.message); }
			exports.emitter.emit(msgUuid, err);
			cb(err);
		});
	});
}

function create(params, deliveryTag, msgUuid, cb) {

	const	dbFields	= [],
		sql	= 'INSERT IGNORE INTO user_users (uuid, username, password) VALUES(?,?,?);';

	if (cb === undefined || typeof cb !== 'function') {
		cb = function() {};
	}

	dbFields.push(lUtils.uuidToBuffer(params.uuid));
	dbFields.push(params.username);
	dbFields.push(params.password);

	if (dbFields[0] === false) {
		const	err = new Error('Invalid user uuid supplied: "' + params.uuid + '", deliveryTag: "' + deliveryTag + '", msgUuid: "' + msgUuid + '"');

		log.warn('larvituser: ./dataWriter.js - create() - ' + err.message);
		exports.emitter.emit(msgUuid, err);
		cb(err);
		return;
	}

	db.query(sql, dbFields, function(err) {
		if (err) log.warn(logPrefix + 'create() - ' + err.message);
		exports.emitter.emit(msgUuid, err);
		cb(err);
	});
}

function listenToQueue(retries, cb) {
	const	options	= {'exchange': exports.exchangeName};

	let	listenMethod;

	if (typeof retries === 'function') {
		cb	= retries;
		retries	= 0;
	}

	if (typeof cb !== 'function') {
		cb = function(){};
	}

	if (retries === undefined) {
		retries = 0;
	}

	if (exports.mode === 'master') {
		listenMethod	= 'consume';
		options.exclusive	= true;	// It is important no other client tries to sneak
				// out messages from us, and we want "consume"
				// since we want the queue to persist even if this
				// minion goes offline.
	} else if (exports.mode === 'slave') {
		listenMethod = 'subscribe';
	} else {
		const	err	= new Error('Invalid exports.mode. Must be either "master" or "slave"');
		log.error('larvituser: dataWriter.js - listenToQueue() - ' + err.message);
		cb(err);
		return;
	}

	intercom	= lUtils.instances.intercom;

	if ( ! (intercom instanceof require('larvitamintercom')) && retries < 10) {
		retries ++;
		setTimeout(function() {
			listenToQueue(retries, cb);
		}, 50);
		return;
	} else if ( ! (intercom instanceof require('larvitamintercom'))) {
		log.error('larvituser: dataWriter.js - listenToQueue() - Intercom is not set!');
		return;
	}

	log.info('larvituser: dataWriter.js - listenToQueue() - listenMethod: ' + listenMethod);

	intercom.ready(function(err) {
		if (err) {
			log.error('larvituser: dataWriter.js - listenToQueue() - intercom.ready() err: ' + err.message);
			return;
		}

		intercom[listenMethod](options, function(message, ack, deliveryTag) {
			exports.ready(function(err) {
				ack(err); // Ack first, if something goes wrong we log it and handle it manually

				if (err) {
					log.error('larvituser: dataWriter.js - listenToQueue() - intercom.' + listenMethod + '() - exports.ready() returned err: ' + err.message);
					return;
				}

				if (typeof message !== 'object') {
					log.error('larvituser: dataWriter.js - listenToQueue() - intercom.' + listenMethod + '() - Invalid message received, is not an object! deliveryTag: "' + deliveryTag + '"');
					return;
				}

				if (typeof exports[message.action] === 'function') {
					exports[message.action](message.params, deliveryTag, message.uuid);
				} else {
					log.warn('larvituser: dataWriter.js - listenToQueue() - intercom.' + listenMethod + '() - Unknown message.action received: "' + message.action + '"');
				}
			});
		}, ready);
	});
}
// Run listenToQueue as soon as all I/O is done, this makes sure the exports.mode can be set
// by the application before listening commences
setImmediate(listenToQueue);

function ready(retries, cb) {
	const	tasks	= [];

	if (typeof retries === 'function') {
		cb	= retries;
		retries	= 0;
	}

	if (typeof cb !== 'function') {
		cb = function(){};
	}

	if (retries === undefined) {
		retries	= 0;
	}

	if (isReady === true) { cb(); return; }

	if (readyInProgress === true) {
		eventEmitter.on('ready', cb);
		return;
	}

	intercom	= lUtils.instances.intercom;

	if ( ! (intercom instanceof require('larvitamintercom')) && retries < 10) {
		retries ++;
		setTimeout(function() {
			ready(retries, cb);
		}, 50);
		return;
	} else if ( ! (intercom instanceof require('larvitamintercom'))) {
		log.error('larvituser: dataWriter.js - ready() - Intercom is not set!');
		return;
	}

	readyInProgress = true;

	if (exports.mode === 'both' || exports.mode === 'slave') {
		log.verbose('larvituser: dataWriter.js - ready() - exports.mode: "' + exports.mode + '", so read');

		tasks.push(function(cb) {
			amsync.mariadb({'exchange': exports.exchangeName + '_dataDump'}, cb);
		});
	}

	// Migrate database
	tasks.push(function(cb) {
		dbmigration(function(err) {
			if (err) {
				log.error('larvituser: dataWriter.js - ready() - Database error: ' + err.message);
			}

			cb(err);
		});
	});

	async.series(tasks, function(err) {
		if (err) {
			return;
		}

		isReady	= true;
		exports.intercom	= intercom;
		eventEmitter.emit('ready');

		if (exports.mode === 'both' || exports.mode === 'master') {
			runDumpServer(cb);
		} else {
			cb();
		}
	});
}

function replaceFields(params, deliveryTag, msgUuid, cb) {
	const	fieldNamesToUuidBufs	= {},
		userUuidBuf	= lUtils.uuidToBuffer(params.userUuid),
		tasks	= [];

	if (cb === undefined || typeof cb !== 'function') {
		cb = function() {};
	}

	if (userUuidBuf === false) {
		const	err = new Error('Invalid user uuid supplied: "' + params.userUuid + '", deliveryTag: "' + deliveryTag + '", msgUuid: "' + msgUuid + '"');

		log.warn('larvituser: ./dataWriter.js - replaceFields() - ' + err.message);
		exports.emitter.emit(msgUuid, err);
		cb(err);
		return;
	}

	// Clean out previous data
	tasks.push(function(cb) {
		db.query('DELETE FROM user_users_data WHERE userUuid = ?', [userUuidBuf], cb);
	});

	// Get field uuids
	tasks.push(function(cb) {
		const	tasks	= [];

		for (const fieldName of Object.keys(params.fields)) {
			tasks.push(function(cb) {
				helpers.getFieldUuid(fieldName, function(err, fieldUuid) {
					fieldNamesToUuidBufs[fieldName] = lUtils.uuidToBuffer(fieldUuid);
					cb(err);
				});
			});
		}

		async.parallel(tasks, cb);
	});

	// Add new data
	tasks.push(function(cb) {
		const	dbFields	= [];

		let	sql = 'INSERT INTO user_users_data (userUuid, fieldUuid, data) VALUES';

		if ( ! params.fields) {
			cb();
			return;
		}

		for (const fieldName of Object.keys(params.fields)) {
			if ( ! (params.fields[fieldName] instanceof Array)) {
				params.fields[fieldName] = [params.fields[fieldName]];
			}

			for (let i = 0; params.fields[fieldName][i] !== undefined; i ++) {
				const	fieldValue	= params.fields[fieldName][i];

				sql += '(?,?,?),';
				dbFields.push(userUuidBuf);
				dbFields.push(fieldNamesToUuidBufs[fieldName]);
				dbFields.push(fieldValue);
			}
		}

		sql = sql.substring(0, sql.length - 1) + ';';

		if (dbFields.length === 0) {
			cb();
			return;
		}

		db.query(sql, dbFields, cb);
	});

	async.series(tasks, function(err) {
		if (err) log.warn(logPrefix + 'replaceFields() - ' + err.message);
		exports.emitter.emit(msgUuid, err);
		cb(err);
	});
}

function rmUser(params, deliveryTag, msgUuid, cb) {
	const	tasks	= [];

	if (cb === undefined || typeof cb !== 'function') {
		cb = function() {};
	}

	tasks.push(function(cb) {
		const	sql	= 'DELETE FROM user_users_data WHERE userUuid = ?;';

		db.query(sql, [lUtils.uuidToBuffer(params.userUuid)], cb);
	});

	tasks.push(function(cb) {
		const	sql	= 'DELETE FROM user_users WHERE uuid = ?;';

		db.query(sql, [lUtils.uuidToBuffer(params.userUuid)], cb);
	});

	async.series(tasks, function(err) {
		if (err) log.warn(logPrefix + 'rmUser() - ' + err.message);
		exports.emitter.emit(msgUuid, err);
		cb(err);
	});
}

function rmUserField(params, deliveryTag, msgUuid, cb) {

	if (cb === undefined || typeof cb !== 'function') {
		cb = function() {};
	}

	helpers.getFieldUuid(params.fieldName, function(err, fieldUuid) {
		const	dbFields	= [lUtils.uuidToBuffer(params.userUuid), lUtils.uuidToBuffer(fieldUuid)],
			sql	= 'DELETE FROM user_users_data WHERE userUuid = ? AND fieldUuid = ?';

		if (err) {
			exports.emitter.emit(msgUuid, err);
			return;
		}

		db.query(sql, dbFields, function(err) {
			if (err) log.warn(logPrefix + 'rmUserField() - ' + err.message);
			exports.emitter.emit(msgUuid, err);
			cb(err);
		});
	});
}

function runDumpServer(cb) {
	const	options	= {'exchange': exports.exchangeName + '_dataDump'},
		args	= [];

	if (db.conf.host) {
		args.push('-h');
		args.push(db.conf.host);
	}

	args.push('-u');
	args.push(db.conf.user);

	if (db.conf.password) {
		args.push('-p' + db.conf.password);
	}

	args.push('--single-transaction');
	args.push('--hex-blob');
	args.push(db.conf.database);

	// Tables
	args.push('users_db_version');
	args.push('user_data_fields');
	args.push('user_roles_rights');
	args.push('user_users');
	args.push('user_users_data');

	options.dataDumpCmd = {
		'command':	'mysqldump',
		'args':	args
	};

	options['Content-Type'] = 'application/sql';

	new amsync.SyncServer(options, cb);
}

function setPassword(params, deliveryTag, msgUuid, cb) {
	const	dbFields	= [],
		sql	= 'UPDATE user_users SET password = ? WHERE uuid = ?;';

	if (cb === undefined || typeof cb !== 'function') {
		cb = function() {};
	}

	if (params.password === false) {
		dbFields.push('');
	} else {
		dbFields.push(params.password);
	}

	dbFields.push(lUtils.uuidToBuffer(params.userUuid));
	db.query(sql, dbFields, function(err) {
		if (err) log.warn(logPrefix + 'setPassword() - ' + err.message);
		exports.emitter.emit(msgUuid, err);
		cb(err);
	});
}

function setUsername(params, deliveryTag, msgUuid, cb) {
	const	dbFields	= [params.username, lUtils.uuidToBuffer(params.userUuid)],
		sql	= 'UPDATE user_users SET username = ? WHERE uuid = ?;';

	if (cb === undefined || typeof cb !== 'function') {
		cb = function() {};
	}

	db.query(sql, dbFields, function(err) {
		if (err) log.warn(logPrefix + 'setUsername() - ' + err.message);
		exports.emitter.emit(msgUuid, err);
		cb(err);
	});
}

//exports.addField	= addField;
exports.addUserField	= addUserField;
exports.addUserDataFields	= addUserDataFields;
exports.create	= create;
exports.emitter	= new EventEmitter();
exports.exchangeName	= 'larvituser';
exports.mode	= ''; // "slave" or "master"
exports.ready	= ready;
exports.replaceFields	= replaceFields;
exports.rmUser	= rmUser;
exports.rmUserField	= rmUserField;
exports.setPassword	= setPassword;
exports.setUsername	= setUsername;
