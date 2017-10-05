'use strict';

const	EventEmitter	= require('events').EventEmitter,
	eventEmitter	= new EventEmitter(),
	topLogPrefix	= 'larvituser: dataWriter.js - ',
	DbMigration	= require('larvitdbmigration'),
	helpers	= require(__dirname + '/helpers.js'),
	uuidLib	= require('uuid'),
	lUtils	= require('larvitutils'),
	amsync	= require('larvitamsync'),
	async	= require('async'),
	log	= require('winston'),
	db	= require('larvitdb');

let	readyInProgress	= false,
	isReady	= false,
	intercom;

function addUserDataFields(params, deliveryTag, msgUuid, cb) {
	const	userUuidBuffer	= lUtils.uuidToBuffer(params.userUuid),
		logPrefix	= topLogPrefix + 'addUserDataFields() - ',
		dbValues	= [],
		tasks	= [];

	let sql	= 'INSERT INTO user_users_data (userUuid, fieldUuid, data) VALUES';

	if (typeof deliveryTag === 'function') {
		cb	= deliveryTag;
		deliveryTag	= false;
		msgUuid	= false;
	}

	if (cb === undefined || typeof cb !== 'function') {
		cb = function () {};
	}

	for (let key in params.fields) {
		tasks.push(function (cb) {
			helpers.getFieldUuid(key, function (err, fieldUuid) {
				if (err) {
					log.warn(logPrefix + err.message);
					return cb(err);
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
			log.warn(logPrefix + err.message);
			if (msgUuid !== false) exports.emitter.emit(msgUuid, err);
			return cb(err);
		}

		sql = sql.substring(0, sql.length - 1);

		if (dbValues.length === 0) {
			log.info(logPrefix + 'No fields or field data specifed');

			// We need to setImmediate here since a listener on the other side must be done async to obtain a msgUuid
			setImmediate(function () {
				if (msgUuid !== false) exports.emitter.emit(msgUuid);
				return cb();
			});
			return; // Make sure no more execution is taking place
		}

		db.query(sql, dbValues, function (err) {
			if (err) {
				log.warn(topLogPrefix + ' addUserDataFields() - ' + err.message);
			}
			if (msgUuid !== false) exports.emitter.emit(msgUuid, err);
			cb(err);
		});
	});
}

function addUserField(params, deliveryTag, msgUuid, cb) {
	const	logPrefix	= topLogPrefix + 'addUserField() - ',
		uuid	= params.uuid,
		name	= params.name,
		sql	= 'INSERT IGNORE INTO user_data_fields (uuid, name) VALUES(?,?)';

	if (typeof cb !== 'function') {
		cb = function () {};
	}

	db.query(sql, [lUtils.uuidToBuffer(uuid), name], function (err) {
		if (err) log.warn(logPrefix + err.message);

		exports.emitter.emit(msgUuid, err);
		exports.emitter.emit('addedField_' + name, err);
		cb(err);
	});
}

function addUserFieldReq(params, deliveryTag, msgUuid, cb) {
	const	logPrefix	= topLogPrefix + 'addUserFieldReq() - ',
		fieldName	= params.name;

	if (typeof cb !== 'function') {
		cb = function () {};
	}

	if (exports.mode === 'master') {
		function run() {
			if (exports.addUserFieldReqRunning === true) {
				setTimeout(run, 10);
				return;
			}

			exports.addUserFieldReqRunning = true;

			// Check if this is already set in the database
			db.query('SELECT uuid FROM user_data_fields WHERE name = ?', [fieldName], function (err, rows) {
				const	options	= {'exchange': exports.exchangeName},
					sendObj	= {};

				if (err) return cb(err);

				sendObj.action	= 'addUserField';
				sendObj.params 	= {};
				sendObj.params.name	= fieldName;
				sendObj.params.uuid	= (rows.length) ? lUtils.formatUuid(rows[0].uuid) : uuidLib.v1();

				exports.emitter.once('addedField_' + fieldName, function (err) {
					if (err) return cb(err);
					exports.addUserFieldReqRunning = false;
				});

				intercom.send(sendObj, options, function (err, msgUuid2) {
					if (err) return cb(err);

					exports.emitter.once(msgUuid2, function (err) {
						if (err) return cb(err);

						exports.emitter.emit(msgUuid, err);

						cb(err);
					});
				});
			});
		}
		run();
	} else {
		log.debug(logPrefix + 'Ignoring since we are not master');
	}
}

function create(params, deliveryTag, msgUuid, cb) {
	const	logPrefix	= topLogPrefix + 'create() - ',
		dbFields	= [],
		sql	= 'INSERT IGNORE INTO user_users (uuid, username, password) VALUES(?,?,?);';

	if (cb === undefined || typeof cb !== 'function') {
		cb = function () {};
	}

	dbFields.push(lUtils.uuidToBuffer(params.uuid));
	dbFields.push(params.username);
	dbFields.push(params.password);

	if (dbFields[0] === false) {
		const	err = new Error('Invalid user uuid supplied: "' + params.uuid + '", deliveryTag: "' + deliveryTag + '", msgUuid: "' + msgUuid + '"');

		log.warn(logPrefix + err.message);
		exports.emitter.emit(msgUuid, err);
		return cb(err);
	}

	db.query(sql, dbFields, function (err, results) {
		const fieldsParams	= {};

		if (results.affectedRows === 0) {
			const	err	= new Error('No user created, duplicate key on uuid: "' + params.uuid + '" or username: "' + params.username + '"');
			log.warn(logPrefix + err.message);
			return cb(err);
		}

		if (err) {
			log.warn(logPrefix + err.message);
			exports.emitter.emit(msgUuid, err);
			return cb(err);
		}

		fieldsParams.userUuid	= params.uuid;
		fieldsParams.fields	= params.fields;

		addUserDataFields(fieldsParams, function (err) {
			if (err) {
				log.warn(logPrefix + err.message);
			}

			exports.emitter.emit(msgUuid, err);
			cb(err);
		});
	});
}

function listenToQueue(retries, cb) {
	const	logPrefix	= topLogPrefix + 'listenToQueue() - ',
		options	= {'exchange': exports.exchangeName};

	let	listenMethod;

	if (typeof retries === 'function') {
		cb	= retries;
		retries	= 0;
	}

	if (typeof cb !== 'function') {
		cb = function (){};
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
	} else if (exports.mode === 'slave' || exports.mode === 'noSync') {
		listenMethod = 'subscribe';
	} else {
		const	err	= new Error('Invalid exports.mode. Must be either "master", "slave" or "noSync"');
		log.error(logPrefix + err.message);
		cb(err);
		return;
	}

	intercom	= lUtils.instances.intercom;

	if ( ! (intercom instanceof require('larvitamintercom')) && retries < 10) {
		retries ++;
		setTimeout(function () {
			listenToQueue(retries, cb);
		}, 50);
		return;
	} else if ( ! (intercom instanceof require('larvitamintercom'))) {
		log.error(logPrefix + 'Intercom is not set!');
		return;
	}

	log.info(logPrefix + 'listenMethod: ' + listenMethod);

	intercom.ready(function (err) {
		if (err) {
			log.error(logPrefix + 'intercom.ready() err: ' + err.message);
			return;
		}

		intercom[listenMethod](options, function (message, ack, deliveryTag) {
			exports.ready(function (err) {
				ack(err); // Ack first, if something goes wrong we log it and handle it manually

				if (err) {
					log.error(logPrefix + 'intercom.' + listenMethod + '() - exports.ready() returned err: ' + err.message);
					return;
				}

				if (typeof message !== 'object') {
					log.error(logPrefix + 'intercom.' + listenMethod + '() - Invalid message received, is not an object! deliveryTag: "' + deliveryTag + '"');
					return;
				}

				if (typeof exports[message.action] === 'function') {
					exports[message.action](message.params, deliveryTag, message.uuid);
				} else {
					log.warn(logPrefix + 'intercom.' + listenMethod + '() - Unknown message.action received: "' + message.action + '"');
				}
			});
		}, ready);
	});
}
// Run listenToQueue as soon as all I/O is done, this makes sure the exports.mode can be set
// by the application before listening commences
setImmediate(listenToQueue);

function ready(retries, cb) {
	const	logPrefix	= topLogPrefix + 'ready() - ',
		tasks	= [];

	if (typeof retries === 'function') {
		cb	= retries;
		retries	= 0;
	}

	if (typeof cb !== 'function') {
		cb = function (){};
	}

	if (retries === undefined) {
		retries	= 0;
	}

	if (isReady === true) return cb();

	if (readyInProgress === true) {
		eventEmitter.on('ready', cb);
		return;
	}

	intercom	= lUtils.instances.intercom;

	if ( ! (intercom instanceof require('larvitamintercom')) && retries < 10) {
		retries ++;
		setTimeout(function () {
			ready(retries, cb);
		}, 50);
		return;
	} else if ( ! (intercom instanceof require('larvitamintercom'))) {
		log.error(logPrefix + 'Intercom is not set!');
		return;
	}

	readyInProgress = true;

	if (exports.mode === 'both' || exports.mode === 'slave') {
		log.verbose(logPrefix + 'exports.mode: "' + exports.mode + '", so read');

		tasks.push(function (cb) {
			amsync.mariadb({'exchange': exports.exchangeName + '_dataDump'}, cb);
		});
	}

	// Migrate database
	tasks.push(function (cb) {
		const	options	= {};

		let	dbMigration;

		log.debug(logPrefix + 'Waiting for dbmigration()');

		options.dbType	= 'larvitdb';
		options.dbDriver	= db;
		options.tableName	= 'users_db_version';
		options.migrationScriptsPath	= __dirname + '/dbmigration';
		dbMigration	= new DbMigration(options);

		dbMigration.run(function (err) {
			if (err) {
				log.error(topLogPrefix + err.message);
			}

			cb(err);
		});
	});

	async.series(tasks, function (err) {
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
		logPrefix	= topLogPrefix + 'replaceFields() - ',
		tasks	= [];

	if (cb === undefined || typeof cb !== 'function') {
		cb = function () {};
	}

	if (userUuidBuf === false) {
		const	err = new Error('Invalid user uuid supplied: "' + params.userUuid + '", deliveryTag: "' + deliveryTag + '", msgUuid: "' + msgUuid + '"');

		log.warn(logPrefix + err.message);
		exports.emitter.emit(msgUuid, err);
		return cb(err);
	}

	// Check so the user uuid is valid
	tasks.push(function (cb) {
		db.query('SELECT * FROM user_users WHERE uuid = ?', userUuidBuf, function (err, rows) {
			if (err) return cb(err);

			if (rows.length === 0) {
				const	err	= new Error('Invalid user uuid: "' + params.userUuid + '", no records found in database of this user');
				log.warn(logPrefix + err.message);
				return cb(err);
			}

			return cb();
		});
	});

	// Clean out previous data
	tasks.push(function (cb) {
		db.query('DELETE FROM user_users_data WHERE userUuid = ?', [userUuidBuf], cb);
	});

	// Get field uuids
	tasks.push(function (cb) {
		const	tasks	= [];

		for (const fieldName of Object.keys(params.fields)) {
			tasks.push(function (cb) {
				helpers.getFieldUuid(fieldName, function (err, fieldUuid) {
					fieldNamesToUuidBufs[fieldName] = lUtils.uuidToBuffer(fieldUuid);
					cb(err);
				});
			});
		}

		async.parallel(tasks, cb);
	});

	// Add new data
	tasks.push(function (cb) {
		const	dbFields	= [];

		let	sql = 'INSERT INTO user_users_data (userUuid, fieldUuid, data) VALUES';

		if ( ! params.fields) return cb();

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

		if (dbFields.length === 0) return cb();

		db.query(sql, dbFields, cb);
	});

	async.series(tasks, function (err) {
		if (err) log.warn(logPrefix + err.message);
		exports.emitter.emit(msgUuid, err);
		cb(err);
	});
}

function rmUser(params, deliveryTag, msgUuid, cb) {
	const	logPrefix	= topLogPrefix + 'rmUser() - ',
		tasks	= [];

	if (cb === undefined || typeof cb !== 'function') {
		cb = function () {};
	}

	tasks.push(function (cb) {
		const	sql	= 'DELETE FROM user_users_data WHERE userUuid = ?;';

		db.query(sql, [lUtils.uuidToBuffer(params.userUuid)], cb);
	});

	tasks.push(function (cb) {
		const	sql	= 'DELETE FROM user_users WHERE uuid = ?;';

		db.query(sql, [lUtils.uuidToBuffer(params.userUuid)], cb);
	});

	async.series(tasks, function (err) {
		if (err) log.warn(logPrefix + err.message);
		exports.emitter.emit(msgUuid, err);
		cb(err);
	});
}

function rmUserField(params, deliveryTag, msgUuid, cb) {
	const	logPrefix	= topLogPrefix + 'rmUserField() - ';

	if (cb === undefined || typeof cb !== 'function') {
		cb = function () {};
	}

	helpers.getFieldUuid(params.fieldName, function (err, fieldUuid) {
		const	dbFields	= [lUtils.uuidToBuffer(params.userUuid), lUtils.uuidToBuffer(fieldUuid)],
			sql	= 'DELETE FROM user_users_data WHERE userUuid = ? AND fieldUuid = ?';

		if (err) {
			exports.emitter.emit(msgUuid, err);
			return;
		}

		db.query(sql, dbFields, function (err) {
			if (err) log.warn(logPrefix + err.message);
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
	const	logPrefix	= topLogPrefix + 'setPassword() - ',
		dbFields	= [],
		sql	= 'UPDATE user_users SET password = ? WHERE uuid = ?;';

	if (cb === undefined || typeof cb !== 'function') {
		cb = function () {};
	}

	if (params.password === false) {
		dbFields.push('');
	} else {
		dbFields.push(params.password);
	}

	dbFields.push(lUtils.uuidToBuffer(params.userUuid));
	db.query(sql, dbFields, function (err) {
		if (err) log.warn(logPrefix + err.message);
		exports.emitter.emit(msgUuid, err);
		cb(err);
	});
}

function setUsername(params, deliveryTag, msgUuid, cb) {
	const	logPrefix	= topLogPrefix + 'setUsername() - ',
		dbFields	= [params.username, lUtils.uuidToBuffer(params.userUuid)],
		sql	= 'UPDATE user_users SET username = ? WHERE uuid = ?;';

	if (cb === undefined || typeof cb !== 'function') {
		cb = function () {};
	}

	db.query(sql, dbFields, function (err) {
		if (err) log.warn(logPrefix + err.message);
		exports.emitter.emit(msgUuid, err);
		cb(err);
	});
}

exports.addUserDataFields	= addUserDataFields;
exports.addUserField	= addUserField;
exports.addUserFieldReq	= addUserFieldReq;
exports.create	= create;
exports.emitter	= new EventEmitter();
exports.exchangeName	= 'larvituser';
exports.mode	= ''; // "slave", "master" or "noSync"
exports.ready	= ready;
exports.replaceFields	= replaceFields;
exports.rmUser	= rmUser;
exports.rmUserField	= rmUserField;
exports.setPassword	= setPassword;
exports.setUsername	= setUsername;
