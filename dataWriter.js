'use strict';

const	EventEmitter	= require('events').EventEmitter,
	topLogPrefix	= 'larvituser: dataWriter.js - ',
	DbMigration	= require('larvitdbmigration'),
	Helpers	= require(__dirname + '/helpers.js'),
	uuidLib	= require('uuid'),
	LUtils	= require('larvitutils'),
	amsync	= require('larvitamsync'),
	async	= require('async');

function DataWriter(options, cb) {
	const	that	= this;

	that.readyInProgress	= false;
	that.isReady	= false;

	if ( ! options.log) {
		const	tmpLUtils	= new LUtils();
		options.log	= new tmpLUtils.Log();
	}

	that.options	= options;

	for (const key of Object.keys(options)) {
		that[key]	= options[key];
	}

	that.lUtils	= new LUtils({'log': that.log});

	that.emitter	= new EventEmitter();

	that.listenToQueue(function (err) {
		if (err) return cb(err);

		that.helpers = new Helpers({
			'dataWriter':	that,
			'log':	that.log,
			'db':	that.db
		});

		cb();
	});
}

DataWriter.prototype.addUserDataFields = function addUserDataFields(params, deliveryTag, msgUuid, cb) {
	const	userUuidBuffer	= this.lUtils.uuidToBuffer(params.userUuid),
		logPrefix	= topLogPrefix + 'addUserDataFields() - ',
		dbValues	= [],
		tasks	= [],
		that	= this;

	let	sql	= 'INSERT INTO user_users_data (userUuid, fieldUuid, data) VALUES';

	if (typeof deliveryTag === 'function') {
		cb	= deliveryTag;
		deliveryTag	= false;
		msgUuid	= false;
	}

	if (cb === undefined || typeof cb !== 'function') {
		cb	= function () {};
	}

	if (userUuidBuffer === false) {
		const	err	= new Error('Invalid userUuid');
		that.log.warn(logPrefix + err.message);
		if (msgUuid !== false) that.emitter.emit(msgUuid, err);
		return cb(err);
	}

	for (let key in params.fields) {
		tasks.push(function (cb) {
			that.helpers.getFieldUuid(key, function (err, fieldUuid) {
				const	fieldUuidBuffer	= that.lUtils.uuidToBuffer(fieldUuid);

				if (err) {
					that.log.warn(logPrefix + err.message);
					return cb(err);
				}

				if (fieldUuidBuffer === false) {
					const	err	= new Error('Invalid fieldUuid');
					that.log.warn(logPrefix + err.message);
					return cb(err);
				}

				if (params.fields[key] === null || params.fields[key] === undefined) {
					sql += '(?,?,\'\'),';
					dbValues.push(userUuidBuffer, fieldUuidBuffer);
				} else {
					if (Array.isArray(params.fields[key])) {
						for (let i = 0; i < params.fields[key].length; i ++) {
							sql += '(?,?,?),';
							dbValues.push(userUuidBuffer, fieldUuidBuffer, params.fields[key][i]);
						}
					} else {
						sql += '(?,?,?),';
						dbValues.push(userUuidBuffer, fieldUuidBuffer, params.fields[key]);
					}
				}

				cb(err);
			});
		});
	}

	async.parallel(tasks, function (err) {
		if (err) {
			that.log.warn(logPrefix + err.message);
			if (msgUuid !== false) that.emitter.emit(msgUuid, err);
			return cb(err);
		}

		sql	= sql.substring(0, sql.length - 1);

		if (dbValues.length === 0) {
			that.log.info(logPrefix + 'No fields or field data specifed');

			// We need to setImmediate here since a listener on the other side must be done async to obtain a msgUuid
			setImmediate(function () {
				if (msgUuid !== false) that.emitter.emit(msgUuid);
				return cb();
			});
			return; // Make sure no more execution is taking place
		}

		that.db.query(sql, dbValues, function (err) {
			if (err) {
				that.log.warn(topLogPrefix + 'addUserDataFields() - ' + err.message);
			}
			if (msgUuid !== false) that.emitter.emit(msgUuid, err);
			cb(err);
		});
	});
};

DataWriter.prototype.addUserField = function addUserField(params, deliveryTag, msgUuid, cb) {
	const	uuidBuffer	= this.lUtils.uuidToBuffer(params.uuid),
		logPrefix	= topLogPrefix + 'addUserField() - ',
		that	= this,
		name	= params.name,
		sql	= 'INSERT IGNORE INTO user_data_fields (uuid, name) VALUES(?,?)';

	if (typeof cb !== 'function') {
		cb	= function () {};
	}

	if (uuidBuffer === false) {
		const	err	= new Error('Invalid field uuid');
		that.log.warn(logPrefix + err.message);

		that.emitter.emit(msgUuid, err);
		that.emitter.emit('addedField_' + name, err);
		return cb(err);
	}

	that.db.query(sql, [uuidBuffer, name], function (err) {
		if (err) that.log.warn(logPrefix + err.message);

		that.emitter.emit(msgUuid, err);
		that.emitter.emit('addedField_' + name, err);
		cb(err);
	});
};

DataWriter.prototype.addUserFieldReq = function addUserFieldReq(params, deliveryTag, msgUuid, cb) {
	const	logPrefix	= topLogPrefix + 'addUserFieldReq() - ',
		fieldName	= params.name,
		that	= this;

	if (typeof cb !== 'function') {
		cb	= function () {};
	}

	if (that.mode === 'master' || that.mode === 'noSync') {
		function run() {
			if (that.addUserFieldReqRunning === true) {
				setTimeout(run, 10);
				return;
			}

			that.addUserFieldReqRunning	= true;

			// Check if this is already set in the database
			that.db.query('SELECT uuid FROM user_data_fields WHERE name = ?', [fieldName], function (err, rows) {
				const	options	= {'exchange': that.exchangeName},
					sendObj	= {};

				if (err) return cb(err);

				sendObj.action	= 'addUserField';
				sendObj.params 	= {};
				sendObj.params.name	= fieldName;
				sendObj.params.uuid	= (rows.length) ? that.lUtils.formatUuid(rows[0].uuid) : uuidLib.v1();

				that.emitter.once('addedField_' + fieldName, function (err) {
					if (err) return cb(err);
					that.addUserFieldReqRunning = false;
				});

				that.intercom.send(sendObj, options, function (err, msgUuid2) {
					if (err) return cb(err);

					that.emitter.once(msgUuid2, function (err) {
						if (err) return cb(err);

						that.emitter.emit(msgUuid, err);

						cb(err);
					});
				});
			});
		}
		run();
	} else {
		that.log.debug(logPrefix + 'Ignoring since we are not master or noSync');
	}
};

DataWriter.prototype.create = function create(params, deliveryTag, msgUuid, cb) {
	const	uuidBuffer =	this.lUtils.uuidToBuffer(params.uuid),
		logPrefix	= topLogPrefix + 'create() - ',
		dbFields	= [],
		that	= this,
		sql	= 'INSERT IGNORE INTO user_users (uuid, username, password) VALUES(?,?,?);';

	if (cb === undefined || typeof cb !== 'function') {
		cb	= function () {};
	}

	dbFields.push(uuidBuffer);
	dbFields.push(params.username);
	dbFields.push(params.password);

	if (uuidBuffer === false) {
		const	err	= new Error('Invalid user uuid supplied: "' + params.uuid + '", deliveryTag: "' + deliveryTag + '", msgUuid: "' + msgUuid + '"');

		that.log.warn(logPrefix + err.message);
		that.emitter.emit(msgUuid, err);
		return cb(err);
	}

	that.db.query(sql, dbFields, function (err, results) {
		const	fieldsParams	= {};

		if (results.affectedRows === 0) {
			const	err	= new Error('No user created, duplicate key on uuid: "' + params.uuid + '" or username: "' + params.username + '"');
			that.log.warn(logPrefix + err.message);
			return cb(err);
		}

		if (err) {
			that.log.warn(logPrefix + err.message);
			that.emitter.emit(msgUuid, err);
			return cb(err);
		}

		fieldsParams.userUuid	= params.uuid;
		fieldsParams.fields	= params.fields;

		that.addUserDataFields(fieldsParams, function (err) {
			if (err) {
				that.log.warn(logPrefix + err.message);
			}

			that.emitter.emit(msgUuid, err);
			cb(err);
		});
	});
};

DataWriter.prototype.listenToQueue = function listenToQueue(cb) {
	const	logPrefix	= topLogPrefix + 'listenToQueue() - ',
		options	= {'exchange': this.exchangeName},
		tasks	= [],
		that	= this;

	let	listenMethod;

	if (typeof cb !== 'function') {
		cb	= function () {};
	}

	tasks.push(function (cb) {
		if (that.mode === 'master') {
			listenMethod	= 'consume';
			options.exclusive	= true;	// It is important no other client tries to sneak
			//		// out messages from us, and we want "consume"
			//		// since we want the queue to persist even if this
			//		// minion goes offline.
		} else if (that.mode === 'slave' || that.mode === 'noSync') {
			listenMethod	= 'subscribe';
		} else {
			const	err	= new Error('Invalid that.mode. Must be either "master", "slave" or "noSync"');
			that.log.error(logPrefix + err.message);
			return cb(err);
		}

		that.log.info(logPrefix + 'listenMethod: ' + listenMethod);
		cb();
	});

	tasks.push(function (cb) {
		that.intercom.ready(function (err) {
			if (err) {
				that.log.error(logPrefix + 'intercom.ready() err: ' + err.message);
				return;
			}

			that.intercom[listenMethod](options, function (message, ack, deliveryTag) {
				that.ready(function (err) {
					ack(err); // Ack first, if something goes wrong we log it and handle it manually

					if (err) {
						that.log.error(logPrefix + 'intercom.' + listenMethod + '() - that.ready() returned err: ' + err.message);
						return;
					}

					if (typeof message !== 'object') {
						that.log.error(logPrefix + 'intercom.' + listenMethod + '() - Invalid message received, is not an object! deliveryTag: "' + deliveryTag + '"');
						return;
					}

					if (typeof that[message.action] === 'function') {
						that[message.action](message.params, deliveryTag, message.uuid);
					} else {
						that.log.warn(logPrefix + 'intercom.' + listenMethod + '() - Unknown message.action received: "' + message.action + '"');
					}
				});
			}, cb);
		});
	});

	// Run the ready function
	tasks.push(function (cb) {
		that.ready(cb);
	});

	async.series(tasks, cb);
};

DataWriter.prototype.ready = function ready(cb) {
	const	that	= this,
		logPrefix	= topLogPrefix + 'ready() - ',
		tasks	= [];

	if (typeof cb !== 'function') {
		cb	= function () {};
	}

	if (that.isReady === true) return cb();

	if (that.readyInProgress === true) {
		that.emitter.on('ready', cb);
		return;
	}

	that.readyInProgress	= true;

	tasks.push(function (cb) {
		if (that.mode === 'slave') {
			that.log.verbose(logPrefix + 'that.mode: "' + that.mode + '", so read');
			new amsync.SyncClient({
				'exchange':	that.exchangeName + '_dataDump',
				'intercom':	that.intercom,
				'log': that.log
			}, cb);
		} else {
			cb();
		}
	});

	// Migrate database
	tasks.push(function (cb) {
		const	options	= {};

		let	dbMigration;

		options.dbType	= 'mariadb';
		options.dbDriver	= that.db;
		options.tableName	= 'users_db_version';
		options.migrationScriptsPath	= __dirname + '/dbmigration';
		options.log	= that.log;
		dbMigration	= new DbMigration(options);

		dbMigration.run(function (err) {
			if (err) {
				that.log.error(logPrefix + 'Database error: ' + err.message);
			}

			cb(err);
		});
	});

	async.series(tasks, function (err) {
		if (err) return cb(err);

		that.isReady	= true;
		that.emitter.emit('ready');

		if (that.mode === 'master') {
			that.runDumpServer(cb);
		} else {
			cb();
		}
	});
};

DataWriter.prototype.replaceFields = function replaceFields(params, deliveryTag, msgUuid, cb) {
	const	fieldNamesToUuidBufs	= {},
		userUuidBuf	= this.lUtils.uuidToBuffer(params.userUuid),
		logPrefix	= topLogPrefix + 'replaceFields() - ',
		tasks	= [],
		that	= this;

	if (cb === undefined || typeof cb !== 'function') {
		cb	= function () {};
	}

	if (userUuidBuf === false) {
		const	err = new Error('Invalid user uuid supplied: "' + params.userUuid + '", deliveryTag: "' + deliveryTag + '", msgUuid: "' + msgUuid + '"');

		that.log.warn(logPrefix + err.message);
		that.emitter.emit(msgUuid, err);
		return cb(err);
	}

	// Check so the user uuid is valid
	tasks.push(function (cb) {
		that.db.query('SELECT * FROM user_users WHERE uuid = ?', userUuidBuf, function (err, rows) {
			if (err) return cb(err);

			if (rows.length === 0) {
				const	err	= new Error('Invalid user uuid: "' + params.userUuid + '", no records found in database of this user');
				that.log.warn(logPrefix + err.message);
				return cb(err);
			}

			return cb();
		});
	});

	// Clean out previous data
	tasks.push(function (cb) {
		that.db.query('DELETE FROM user_users_data WHERE userUuid = ?', [userUuidBuf], cb);
	});

	// Get field uuids
	tasks.push(function (cb) {
		const	tasks	= [];

		for (const fieldName of Object.keys(params.fields)) {
			tasks.push(function (cb) {
				that.helpers.getFieldUuid(fieldName, function (err, fieldUuid) {
					fieldNamesToUuidBufs[fieldName]	= that.lUtils.uuidToBuffer(fieldUuid);

					if (fieldNamesToUuidBufs[fieldName] === false) {
						const	err	= new Error('Invalid field uuid');
						that.log.warn(logPrefix + err.message);
						return cb(err);
					}

					cb(err);
				});
			});
		}

		async.parallel(tasks, cb);
	});

	// Add new data
	tasks.push(function (cb) {
		const	dbFields	= [];

		let	sql	= 'INSERT INTO user_users_data (userUuid, fieldUuid, data) VALUES';

		if ( ! params.fields) return cb();

		for (const fieldName of Object.keys(params.fields)) {
			if ( ! (params.fields[fieldName] instanceof Array)) {
				params.fields[fieldName]	= [params.fields[fieldName]];
			}

			for (let i = 0; params.fields[fieldName][i] !== undefined; i ++) {
				const	fieldValue	= params.fields[fieldName][i];

				sql += '(?,?,?),';
				dbFields.push(userUuidBuf);
				dbFields.push(fieldNamesToUuidBufs[fieldName]);
				dbFields.push(fieldValue);
			}
		}

		sql	= sql.substring(0, sql.length - 1) + ';';

		if (dbFields.length === 0) return cb();

		that.db.query(sql, dbFields, cb);
	});

	async.series(tasks, function (err) {
		if (err) that.log.warn(logPrefix + err.message);
		that.emitter.emit(msgUuid, err);
		cb(err);
	});
};

DataWriter.prototype.rmUser = function rmUser(params, deliveryTag, msgUuid, cb) {
	const	uuidBuffer	= this.lUtils.uuidToBuffer(params.userUuid),
		logPrefix	= topLogPrefix + 'rmUser() - ',
		tasks	= [],
		that	= this;

	if (cb === undefined || typeof cb !== 'function') {
		cb	= function () {};
	}

	if (uuidBuffer === false) {
		const	err	= new Error('Invalid user uuid');
		that.log.warn(logPrefix + err.message);
		that.emitter.emit(msgUuid, err);
		return cb(err);
	}

	tasks.push(function (cb) {
		const	sql	= 'DELETE FROM user_users_data WHERE userUuid = ?;';

		that.db.query(sql, [uuidBuffer], cb);
	});

	tasks.push(function (cb) {
		const	sql	= 'DELETE FROM user_users WHERE uuid = ?;';

		that.db.query(sql, [uuidBuffer], cb);
	});

	async.series(tasks, function (err) {
		if (err) that.log.warn(logPrefix + err.message);
		that.emitter.emit(msgUuid, err);
		cb(err);
	});
};

DataWriter.prototype.rmUserField = function rmUserField(params, deliveryTag, msgUuid, cb) {
	const	logPrefix	= topLogPrefix + 'rmUserField() - ',
		that	= this;

	if (cb === undefined || typeof cb !== 'function') {
		cb	= function () {};
	}

	that.helpers.getFieldUuid(params.fieldName, function (err, fieldUuid) {
		const	userUuidBuffer	= that.lUtils.uuidToBuffer(params.userUuid),
			fieldUuidBuffer	= that.lUtils.uuidToBuffer(fieldUuid),
			sql	= 'DELETE FROM user_users_data WHERE userUuid = ? AND fieldUuid = ?';

		if (err) {
			that.emitter.emit(msgUuid, err);
			return;
		}

		if (userUuidBuffer === false) {
			const	err	= new Error('Invalid user uuid');
			that.log.warn(logPrefix + err.message);
			that.emitter.emit(msgUuid, err);
			return cb(err);
		}

		if (fieldUuidBuffer === false) {
			const	err	= new Error('Invalid field uuid');
			that.log.warn(logPrefix + err.message);
			that.emitter.emit(msgUuid, err);
			return cb(err);
		}

		that.db.query(sql, [userUuidBuffer, fieldUuidBuffer], function (err) {
			if (err) that.log.warn(logPrefix + err.message);
			that.emitter.emit(msgUuid, err);
			cb(err);
		});
	});
};

DataWriter.prototype.runDumpServer = function runDumpServer(cb) {
	const	that	= this,
		args	= [],
		options = {
			'Content-Type':	'application/sql',
			'exchange':	that.exchangeName + '_dataDump',
			'intercom':	that.intercom,
			'minPort':	(that.amsync && that.amsync.minPort)	? that.amsync.minPort	: null,
			'maxPort':	(that.amsync && that.amsync.maxPort)	? that.amsync.maxPort	: null,
			'host':	(that.amsync && that.amsync.host)	? that.amsync.host	: null,
			'log':	that.log,
		};

	if (that.db.conf.host) {
		args.push('-h');
		args.push(that.db.conf.host);
	}

	args.push('-u');
	args.push(that.db.conf.user);

	if (that.db.conf.password) {
		args.push('-p' + that.db.conf.password);
	}

	args.push('--single-transaction');
	args.push('--hex-blob');
	args.push(that.db.conf.database);

	// Tables
	args.push('users_db_version');
	args.push('user_data_fields');
	args.push('user_roles_rights');
	args.push('user_users');
	args.push('user_users_data');

	options.dataDumpCmd = {
		'command':	'mysqldump',
		'args':	args,
		'log': that.log
	};

	new amsync.SyncServer(options, cb);
};

DataWriter.prototype.setPassword = function setPassword(params, deliveryTag, msgUuid, cb) {
	const	logPrefix	= topLogPrefix + 'setPassword() - ',
		dbFields	= [],
		userUuidBuffer = this.lUtils.uuidToBuffer(params.userUuid),
		that	= this,
		sql	= 'UPDATE user_users SET password = ? WHERE uuid = ?;';

	if (cb === undefined || typeof cb !== 'function') {
		cb	= function () {};
	}

	if (userUuidBuffer === false) {
		const	err	= new Error('Invalid user uuid');
		that.log.warn(logPrefix + err.message);
		that.emitter.emit(msgUuid, err);
		return cb(err);
	}

	if (params.password === false) {
		dbFields.push('');
	} else {
		dbFields.push(params.password);
	}

	dbFields.push(userUuidBuffer);
	that.db.query(sql, dbFields, function (err) {
		if (err) that.log.warn(logPrefix + err.message);
		that.emitter.emit(msgUuid, err);
		cb(err);
	});
};

DataWriter.prototype.setUsername = function setUsername(params, deliveryTag, msgUuid, cb) {
	const	logPrefix	= topLogPrefix + 'setUsername() - ',
		userUuidBuffer = this.lUtils.uuidToBuffer(params.userUuid),
		dbFields	= [params.username, userUuidBuffer],
		that	= this,
		sql	= 'UPDATE user_users SET username = ? WHERE uuid = ?;';

	if (cb === undefined || typeof cb !== 'function') {
		cb	= function () {};
	}

	if (userUuidBuffer === false) {
		const	err	= new Error('Invalid user uuid');
		that.log.warn(logPrefix + err.message);
		that.emitter.emit(msgUuid, err);
		return cb(err);
	}

	that.db.query(sql, dbFields, function (err) {
		if (err) that.log.warn(logPrefix + err.message);
		that.emitter.emit(msgUuid, err);
		cb(err);
	});
};

exports = module.exports = DataWriter;
