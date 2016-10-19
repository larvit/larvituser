'use strict';

const	dataWriter	= require(__dirname + '/dataWriter.js'),
	intercom	= require('larvitutils').instances.intercom,
	uuidLib	= require('node-uuid'),
	lUtils	= require('larvitutils'),
	async	= require('async'),
	log	= require('winston'),
	db	= require('larvitdb');

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
					const	sendObj	= {};

					sendObj.action	= 'addField';
					sendObj.params	= {};
					sendObj.params.uuid	= uuidLib.v4();
					sendObj.params.name	= fieldName;

					intercom.send()


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

		message.params.uuid	= uuidLib.v4();
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

		message.params.uuid	= uuidLib.v4();
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

exports.getOrderFieldUuids	= getOrderFieldUuids;
exports.getRowFieldUuids	= getRowFieldUuids;
exports.loadOrderFieldsToCache	= loadOrderFieldsToCache;
exports.loadRowFieldsToCache	= loadRowFieldsToCache;
exports.orderFields	= [];
exports.rowFields	= [];