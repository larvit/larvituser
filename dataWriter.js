'use strict';

const	EventEmitter	= require('events').EventEmitter,
	lUtils	= require('larvitutils'),
	intercom	= lUtils.instances.intercom,
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

function create(params, deliveryTag, msgUuid) {
	// Write the fields to the db
	function writeFieldsToDb() {
		replaceUserFields(uuid, fields, function(err) {
			if (err) {
				log.error('larvituser: create() - ' + err.message);
				cb(err);
				return;
			}

			log.debug('larvituser: create() - Fields written successfully to database', {'username': username, 'userUuid': uuid, 'fields': fields});

			fromUuid(uuid, function(err, user) {
				if (err) {
					log.error('larvituser: create() - ' + err.message);
					cb(err);
					return;
				}

				cb(null, user);
			});
		});
	}

		// Write to database - called from the above cb
		function writeToDb() {
			const	sql	= 'INSERT INTO user_users (uuid, username, password) VALUES(UNHEX(REPLACE(?, \'-\', \'\')),?,?);',
				dbFields	= [uuid, username, hashedPassword];

			log.verbose('larvituser: create() - Trying to write username and password to database', {'sql': sql, 'fields': dbFields});

			db.query(sql, dbFields, function(err) {
				if (err) { cb(err); return; }

				log.debug('larvituser: create() - Write to db successfull! Moving on to writing fields to database', {'username': username, 'uuid': uuid});
				writeFieldsToDb();
			});
		}

		// Hash password - called from the above cb
		function hashPassword() {
			if (password === false) {
				log.debug('larvituser: create() - Password set to empty string for no-login, moving on to writing username and password to database', {'username': username});
				hashedPassword	= '';
				writeToDb();
				return;
			}

			exports.hashPassword(password, function(err, hash) {
				if (err) {
					cb(err);
				} else {
					hashedPassword	= hash;
					log.debug('larvituser: create() - Password hashed, moving on to writing username and password to database', {'username': username});
					writeToDb();
				}
			});
		}

		checkDbStructure(function() {
			log.verbose('larvituser: create() - Trying to create user', {'username': username, 'fields': fields});

			username = username.trim();
			if (password !== false) {
				password	= password.trim();
			}

			if ( ! username.length) {
				const	err = new Error('Trying to create user with empty username');
				log.warn('larvituser: create() - ' + err.message);
				cb(err);
				return;
			}

			// Check if username is available
			usernameAvailable(username, function(err, res) {
				if (err) {
					cb(err);
				} else if ( ! res) {
					err = new Error('Trying to create user with taken username: "' + username + '"');
					log.info('larvituser: create() - ' + err.message);
					cb(err);
				} else {
					log.debug('larvituser: create() - Username available, moving on to hashing password', {'username': username});
					hashPassword();
				}
			});
		});
	}

}

exports.addField	= addField;
exports.create	= create;
exports.emitter	= new EventEmitter();
exports.exchangeName	= 'larvituser';

intercom.subscribe({'exchange': exports.exchangeName}, function(message, ack, deliveryTag) {
	ack(); // Ack first, if something goes wrong we log it and handle it manually

	if (typeof message !== 'object') {
		log.error('larvituser: dataWriter.js - intercom.subscribe() - Invalid message received, is not an object! deliveryTag: "' + deliveryTag + '"');
		return;
	}

	if (typeof exports[message.action] === 'function') {
		exports[message.action](message.params, deliveryTag, message.uuid);
	} else {
		log.warn('larvituser: dataWriter.js - intercom.subscribe() - Unknown message.action received: "' + message.action + '"');
	}
});
