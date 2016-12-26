'use strict';

const	EventEmitter	= require('events').EventEmitter,
	lUtils	= require('larvitutils'),
	intercom	= lUtils.instances.intercom,
	helpers	= require(__dirname + '/helpers.js'),
	async	= require('async'),
	log	= require('winston'),
	db	= require('larvitdb');

function addField(params, deliveryTag, msgUuid) {
	const	uuid	= params.uuid,
		name	= params.name,
		sql	= 'REPLACE INTO user_data_fields (uuid, name) VALUES(?,?)';

	db.query(sql, [lUtils.uuidToBuffer(uuid), name], function(err) {
		exports.emitter.emit(msgUuid, err);
	});
}

function addUserField(params, deliveryTag, msgUuid) {
	helpers.getFieldUuid(params.fieldName, function(err, fieldUuid) {
		const	dbFields	= [lUtils.uuidToBuffer(params.userUuid), lUtils.uuidToBuffer(fieldUuid), params.fieldValue],
			sql	= 'INSERT INTO user_users_data (userUuid, fieldUuid, data) VALUES(?,?,?)';

		if (err) {
			exports.emitter.emit(msgUuid, err);
			return;
		}

		db.query(sql, dbFields, function(err) {
			exports.emitter.emit(msgUuid, err);
		});
	});
}

function create(params, deliveryTag, msgUuid) {
	const	dbFields	= [],
		sql	= 'INSERT IGNORE INTO user_users (uuid, username, password) VALUES(?,?,?);';

	dbFields.push(lUtils.uuidToBuffer(params.uuid));
	dbFields.push(params.username);
	dbFields.push(params.password);

	if (dbFields[0] === false) {
		const	err = new Error('Invalid user uuid supplied: "' + params.uuid + '", deliveryTag: "' + deliveryTag + '", msgUuid: "' + msgUuid + '"');

		log.warn('larvituser: ./dataWriter.js - create() - ' + err.message);
		exports.emitter.emit(msgUuid, err);

		return;
	}

	db.query(sql, dbFields, function(err) {
		exports.emitter.emit(msgUuid, err);
	});
}

function replaceFields(params, deliveryTag, msgUuid) {
	const	fieldNamesToUuidBufs	= {},
		userUuidBuf	= lUtils.uuidToBuffer(params.userUuid),
		tasks	= [];

	if (userUuidBuf === false) {
		const	err = new Error('Invalid user uuid supplied: "' + params.userUuid + '", deliveryTag: "' + deliveryTag + '", msgUuid: "' + msgUuid + '"');

		log.warn('larvituser: ./dataWriter.js - replaceFields() - ' + err.message);
		exports.emitter.emit(msgUuid, err);

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
		exports.emitter.emit(msgUuid, err);
	});
}

function rmUser(params, deliveryTag, msgUuid) {
	const	tasks	= [];

	tasks.push(function(cb) {
		const	sql	= 'DELETE FROM user_users_data WHERE userUuid = ?;';

		db.query(sql, [lUtils.uuidToBuffer(params.userUuid)], cb);
	});

	tasks.push(function(cb) {
		const	sql	= 'DELETE FROM user_users WHERE uuid = ?;';

		db.query(sql, [lUtils.uuidToBuffer(params.userUuid)], cb);
	});

	async.series(tasks, function(err) {
		exports.emitter.emit(msgUuid, err);
	});
}

function rmUserField(params, deliveryTag, msgUuid) {
	helpers.getFieldUuid(params.fieldName, function(err, fieldUuid) {
		const	dbFields	= [lUtils.uuidToBuffer(params.userUuid), lUtils.uuidToBuffer(fieldUuid)],
			sql	= 'DELETE FROM user_users_data WHERE userUuid = ? AND fieldUuid = ?';

		if (err) {
			exports.emitter.emit(msgUuid, err);
			return;
		}

		db.query(sql, dbFields, function(err) {
			exports.emitter.emit(msgUuid, err);
		});
	});
}

function setPassword(params, deliveryTag, msgUuid) {
	const	dbFields	= [],
		sql	= 'UPDATE user_users SET password = ? WHERE uuid = ?;';

	if (params.password === false) {
		dbFields.push('');
	} else {
		dbFields.push(params.password);
	}

	dbFields.push(lUtils.uuidToBuffer(params.userUuid));
	db.query(sql, dbFields, function(err) {
		exports.emitter.emit(msgUuid, err);
	});
}

function setUsername(params, deliveryTag, msgUuid) {
	const	dbFields	= [params.username, lUtils.uuidToBuffer(params.userUuid)],
		sql	= 'UPDATE user_users SET username = ? WHERE uuid = ?;';

	db.query(sql, dbFields, function(err) {
		exports.emitter.emit(msgUuid, err);
	});
}

exports.addField	= addField;
exports.addUserField	= addUserField;
exports.create	= create;
exports.emitter	= new EventEmitter();
exports.exchangeName	= 'larvituser';
exports.replaceFields	= replaceFields;
exports.rmUser	= rmUser;
exports.rmUserField	= rmUserField;
exports.setPassword	= setPassword;
exports.setUsername	= setUsername;

intercom.subscribe({'exchange': exports.exchangeName}, function(message, ack, deliveryTag) {
	ack(); // Ack first, if something goes wrong we log it and handle it manually

	if (typeof message !== 'object') {
		log.error('larvituser: dataWriter.js - intercom.subscribe() - Invalid message received, is not an object! deliveryTag: "' + deliveryTag + '"');
		return;
	}

	if (message.uuid === undefined) {
		log.warn('larvituser: dataWriter.js - intercom.subscribe() - No message.uuid supplied. deliveryTag: "' + deliveryTag + '", message: "' + JSON.stringify(message) + '"');
	}

	if (typeof exports[message.action] === 'function') {
		log.debug('larvituser: dataWriter.js - intercom.subscribe() - Running action "' + message.action + '", msgUuid: "' + message.uuid + '", deliveryTag: "' + deliveryTag + '"');

		exports[message.action](message.params, deliveryTag, message.uuid);
	} else {
		log.warn('larvituser: dataWriter.js - intercom.subscribe() - Unknown message.action received: "' + message.action + '", msgUuid: "' + message.uuid + '", deliveryTag: "' + deliveryTag + '"');
	}
});
