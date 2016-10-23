'use strict';

const	EventEmitter	= require('events').EventEmitter,
	eventEmitter	= new EventEmitter(),
	dbmigration	= require('larvitdbmigration')({'tableName': 'users_db_version', 'migrationScriptsPath': __dirname + '/dbmigration'}),
	uuidLib	= require('node-uuid'),
	lUtils	= require('larvitutils'),
	async	= require('async'),
	log	= require('winston'),
	db	= require('larvitdb');

let	readyInProgress	= false,
	isReady	= false,
	dataWriter,
	intercom;

/**
 * Get field name by uuid
 *
 * @param str uuid
 * @param func cb(err, name) - name is false if no match is found
 */
function getFieldName(uuid, cb) {
	ready(function() {
		const	dbFields	= [lUtils.uuidToBuffer(uuid)],
			sql	= 'SELECT name FROM user_data_fields WHERE uuid = ?';

		db.query(sql, dbFields, function(err, rows) {
			if (err) { cb(err); return; }

			if (rows.length) {
				cb(null, rows[0].name);
			} else {
				cb(null, false);
			}
		});
	});
}

/**
 * Get data field uuid by field name
 *
 * @param str fieldName
 * @param func cb(err, uuid)
 */
function getFieldUuid(fieldName, cb) {
	ready(function() {
		const	dbFields	= [],
			sql	= 'SELECT uuid FROM user_data_fields WHERE name = ?';

		fieldName	= fieldName.trim();
		dbFields.push(fieldName);

		db.query(sql, dbFields, function(err, rows) {
			if (err) { cb(err); return; }

			if (rows.length) {
				cb(null, lUtils.formatUuid(rows[0].uuid));
			} else {
				const	options	= {'exchange': dataWriter.exchangeName},
					sendObj	= {};

				sendObj.action	= 'addField';
				sendObj.params	= {};
				sendObj.params.uuid	= uuidLib.v1();
				sendObj.params.name	= fieldName;

				intercom.send(sendObj, options, function(err, msgUuid) {
					if (err) { cb(err); return; }

					dataWriter.emitter.once(msgUuid, function(err) {
						if (err) { cb(err); return; }

						getFieldUuid(fieldName, cb);
					});
				});
			}
		});
	});
}

function getOrderFieldUuid(fieldName, cb) {
	for (let i = 0; exports.orderFields[i] !== undefined; i ++) {
		if (exports.orderFields[i].name === fieldName) {
			cb(null, exports.orderFields[i].uuid);
			return;
		}
	}

	// If we get down here, the field does not exist, create it and rerun
	(function() {
		const	options	= {'exchange': dataWriter.exchangeName},
			message	= {};

		message.action	= 'writeOrderField';
		message.params	= {};

		message.params.uuid	= uuidLib.v1();
		message.params.name	= fieldName;

		intercom.send(message, options, function(err, msgUuid) {
			if (err) { cb(err); return; }

			dataWriter.emitter.once(msgUuid, function(err) {
				if (err) { cb(err); return; }

				loadOrderFieldsToCache(function(err) {
					if (err) { cb(err); return; }

					getOrderFieldUuid(fieldName, cb);
				});
			});
		});
	})();
};

/**
 * Get order field ids by names
 *
 * @param arr	fieldNames array of strings
 * @param func	cb(err, object with names as key and uuids as values)
 */
function getOrderFieldUuids(fieldNames, cb) {
	const	fieldUuidsByName	= {},
		tasks	= [];

	for (let i = 0; fieldNames[i] !== undefined; i ++) {
		const	fieldName = fieldNames[i];

		tasks.push(function(cb) {
			getOrderFieldUuid(fieldName, function(err, fieldUuid) {
				if (err) { cb(err); return; }

				fieldUuidsByName[fieldName] = fieldUuid;
				cb();
			});
		});
	}

	async.parallel(tasks, function(err) {
		if (err) { cb(err); return; }

		cb(null, fieldUuidsByName);
	});
};

function getRowFieldUuid(rowFieldName, cb) {
	if (rowFieldName === 'uuid') {
		const	err	= new Error('Row field "uuid" is reserved and have no uuid');
		log.warn('larvitorder: helpers.js - getRowFieldUuid() - ' + err.message);
		cb(err);
		return;
	}

	for (let i = 0; exports.rowFields[i] !== undefined; i ++) {
		if (exports.rowFields[i].name === rowFieldName) {
			cb(null, exports.rowFields[i].uuid);
			return;
		}
	}

	// If we get down here, the field does not exist, create it and rerun
	(function() {
		const	options	= {'exchange': dataWriter.exchangeName},
			message	= {};

		message.action	= 'writeRowField';
		message.params	= {};

		message.params.uuid	= uuidLib.v1();
		message.params.name	= rowFieldName;

		intercom.send(message, options, function(err, msgUuid) {
			if (err) { cb(err); return; }
			dataWriter.emitter.once(msgUuid, function(err) {
				if (err) { cb(err); return; }

				loadRowFieldsToCache(function(err) {
					if (err) { cb(err); return; }

					getRowFieldUuid(rowFieldName, cb);
				});
			});
		});
	})();
};

/**
 * Get row field uuids by names
 *
 * @param arr	rowFieldNames array of strings
 * @param func	cb(err, object with names as key and ids as values)
 */
function getRowFieldUuids(rowFieldNames, cb) {
	const	rowFieldUuidsByName	= {},
		tasks	= [];

	for (let i = 0; rowFieldNames[i] !== undefined; i ++) {
		const	rowFieldName = rowFieldNames[i];

		if (rowFieldName === 'uuid') continue; // Ignore uuid

		tasks.push(function(cb) {
			getRowFieldUuid(rowFieldName, function(err, fieldUuid) {
				if (err) { cb(err); return; }

				rowFieldUuidsByName[rowFieldName] = fieldUuid;
				cb();
			});
		});
	}

	async.parallel(tasks, function(err) {
		if (err) { cb(err); return; }

		cb(null, rowFieldUuidsByName);
	});
};

function loadOrderFieldsToCache(cb) {
	db.query('SELECT * FROM orders_orderFields ORDER BY name;', function(err, rows) {
		if (err) {
			log.error('larvitorder: helpers.js - loadOrderFieldsToCache() - Database error: ' + err.message);
			return;
		}

		// Empty the previous cache
		exports.orderFields.length = 0;

		// Load the new values
		for (let i = 0; rows[i] !== undefined; i ++) {
			exports.orderFields.push(rows[i]);
		}

		cb();
	});
}

function loadRowFieldsToCache(cb) {
	db.query('SELECT * FROM orders_rowFields ORDER BY name;', function(err, rows) {
		if (err) {
			log.error('larvitorder: helpers.js - loadRowFieldsToCache() - Database error: ' + err.message);
			return;
		}

		// Empty the previous cache
		exports.rowFields.length = 0;

		// Load the new values
		for (let i = 0; rows[i] !== undefined; i ++) {
			exports.rowFields.push(rows[i]);
		}

		cb();
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
		log.error('larvituser: helpers.js - ' + err.message);
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

exports.getFieldName	= getFieldName;
exports.getFieldUuid	= getFieldUuid;
exports.getOrderFieldUuids	= getOrderFieldUuids;
exports.getRowFieldUuids	= getRowFieldUuids;
exports.loadOrderFieldsToCache	= loadOrderFieldsToCache;
exports.loadRowFieldsToCache	= loadRowFieldsToCache;
exports.orderFields	= [];
exports.rowFields	= [];
