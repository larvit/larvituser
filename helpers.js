'use strict';

const	topLogPrefix	= 'larvituser: helpers.js - ',
	LUtils	= require('larvitutils');

function Helpers(options) {
	const	logPrefix	= topLogPrefix + 'Helpers() - ',
		that	= this;

	if ( ! options.log) {
		const	tmpLUtils	= new LUtils();
		options.log	= new tmpLUtils.Log();
	}

	that.options	= options;

	for (const key of Object.keys(options)) {
		that[key]	= options[key];
	}

	that.lUtils	= new LUtils({'log': that.log});

	if ( ! that.log)	{
		const	err	= new Error('Required option log not set');
		that.log.error(logPrefix + err.message);
		throw err;
	}

	if ( ! that.dataWriter)	{
		const	err	= new Error('Required option dataWriter not set');
		that.log.error(logPrefix + err.message);
		throw err;
	}

	if ( ! that.db)	{
		const	err	= new Error('Required option db not set');
		that.log.error(logPrefix + err.message);
		throw err;
	}
}

/**
 * Get field name by uuid
 *
 * @param str uuid
 * @param func cb(err, name) - name is false if no match is found
 */
Helpers.prototype.getFieldName = function getFieldName(uuid, cb) {
	const	fieldUuidBuffer = this.lUtils.uuidToBuffer(uuid),
		logPrefix	= topLogPrefix + 'getFieldName() - ',
		that	= this,
		sql	= 'SELECT name FROM user_data_fields WHERE uuid = ?';

	if (fieldUuidBuffer === false) {
		const	err	= new Error('Invalid field uuid');
		that.log.verbose(logPrefix + err.message);
		return cb(err);
	}

	that.db.query(sql, [fieldUuidBuffer], function (err, rows) {
		if (err) return cb(err);

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
	const	dbFields	= [],
		that	= this,
		sql	= 'SELECT uuid FROM user_data_fields WHERE name = ?';

	fieldName	= fieldName.trim();
	dbFields.push(fieldName);

	that.db.query(sql, dbFields, function (err, rows) {
		if (err) return cb(err);

		if (rows.length) {
			cb(null, that.lUtils.formatUuid(rows[0].uuid));
		} else {
			const	options	= {'exchange': that.dataWriter.exchangeName},
				sendObj	= {};

			sendObj.action	= 'addUserFieldReq';
			sendObj.params 	= {};
			sendObj.params.name = fieldName;

			that.dataWriter.intercom.send(sendObj, options, function (err) {
				if (err) { cb(err); return; }

				that.dataWriter.emitter.once('addedField_' + fieldName, function (err) {
					if (err) { cb(err); return; }
					that.getFieldUuid(fieldName, cb);
				});
			});
		}
	});
};

exports = module.exports = Helpers;