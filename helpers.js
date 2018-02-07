'use strict';

const	lUtils	= require('larvitutils'),
	db	= require('larvitdb');

let	dataWriter;

/**
 * Get field name by uuid
 *
 * @param str uuid
 * @param func cb(err, name) - name is false if no match is found
 */
function getFieldName(uuid, cb) {
	ready(function () {
		const	fieldUuidBuffer = lUtils.uuidToBuffer(uuid),
			sql	= 'SELECT name FROM user_data_fields WHERE uuid = ?';

		if (fieldUuidBuffer === false) {
			const e = new Error('Invalid field uuid');
			return cb(e);
		}

		db.query(sql, [fieldUuidBuffer], function (err, rows) {
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
	ready(function () {
		const	dbFields	= [],
			sql	= 'SELECT uuid FROM user_data_fields WHERE name = ?';

		fieldName	= fieldName.trim();
		dbFields.push(fieldName);

		db.query(sql, dbFields, function (err, rows) {
			if (err) { cb(err); return; }

			if (rows.length) {
				cb(null, lUtils.formatUuid(rows[0].uuid));
			} else {
				const	options	= {'exchange': dataWriter.exchangeName},
					sendObj	= {};

				sendObj.action	= 'addUserFieldReq';
				sendObj.params 	= {};
				sendObj.params.name = fieldName;

				dataWriter.intercom.send(sendObj, options, function (err) {
					if (err) { cb(err); return; }

					dataWriter.emitter.once('addedField_' + fieldName, function (err) {
						if (err) { cb(err); return; }
						getFieldUuid(fieldName, cb);
					});
				});
			}
		});
	});
}

function ready(cb) {
	dataWriter	= require(__dirname + '/dataWriter.js'); // We must do this here since it might not be instanciated on module load
	dataWriter.ready(cb);
}

exports.getFieldName	= getFieldName;
exports.getFieldUuid	= getFieldUuid;
