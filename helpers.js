'use strict';

const	lUtils	= new (require('larvitutils'))();

function Helpers(options) {
	this.options = options;

	if ( ! options.log) throw new Error('Required option log not set');
	if ( ! options.dataWriter) throw new Error('Required option dataWriter not set');
	if ( ! options.db) throw new Error('Required option db not set');
}

/**
 * Get field name by uuid
 *
 * @param str uuid
 * @param func cb(err, name) - name is false if no match is found
 */
Helpers.prototype.getFieldName = function getFieldName(uuid, cb) {
	const	that	= this,
		fieldUuidBuffer = lUtils.uuidToBuffer(uuid),
		sql	= 'SELECT name FROM user_data_fields WHERE uuid = ?';

	if (fieldUuidBuffer === false) {
		const e = new Error('Invalid field uuid');
		return cb(e);
	}

	that.options.db.query(sql, [fieldUuidBuffer], function (err, rows) {
		if (err) { cb(err); return; }

		if (rows.length) {
			cb(null, rows[0].name);
		} else {
			cb(null, false);
		}
	});
};

/**
 * Get data field uuid by field name
 *
 * @param str fieldName
 * @param func cb(err, uuid)
 */
Helpers.prototype.getFieldUuid = function getFieldUuid(fieldName, cb) {
	const	that	= this,
		dbFields	= [],
		sql	= 'SELECT uuid FROM user_data_fields WHERE name = ?';

	fieldName	= fieldName.trim();
	dbFields.push(fieldName);

	that.options.db.query(sql, dbFields, function (err, rows) {
		if (err) return cb(err);

		if (rows.length) {
			cb(null, lUtils.formatUuid(rows[0].uuid));
		} else {
			const	options	= {'exchange': that.options.dataWriter.exchangeName},
				sendObj	= {};

			sendObj.action	= 'addUserFieldReq';
			sendObj.params 	= {};
			sendObj.params.name = fieldName;

			that.options.dataWriter.intercom.send(sendObj, options, function (err) {
				if (err) { cb(err); return; }

				that.options.dataWriter.emitter.once('addedField_' + fieldName, function (err) {
					if (err) { cb(err); return; }
					that.getFieldUuid(fieldName, cb);
				});
			});
		}
	});
};

exports = module.exports = Helpers;