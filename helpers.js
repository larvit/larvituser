'use strict';

const	EventEmitter	= require('events').EventEmitter,
	eventEmitter	= new EventEmitter(),
	dbmigration	= require('larvitdbmigration')({'tableName': 'users_db_version', 'migrationScriptsPath': __dirname + '/dbmigration'}),
	uuidLib	= require('uuid'),
	lUtils	= require('larvitutils'),
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
			log.error('larvituser: helpers.js: Database error: ' + err.message);
			return;
		}

		isReady	= true;
		eventEmitter.emit('ready');

		cb();
	});
}

exports.getFieldName	= getFieldName;
exports.getFieldUuid	= getFieldUuid;
