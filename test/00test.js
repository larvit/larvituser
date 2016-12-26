'use strict';

const	Intercom	= require('larvitamintercom'),
	userLib	= require('../index.js'),
	assert	= require('assert'),
	lUtils	= require('larvitutils'),
	async	= require('async'),
	log	= require('winston'),
	db	= require('larvitdb'),
	fs	= require('fs');

// Set up winston
log.remove(log.transports.Console);
/**/log.add(log.transports.Console, {
	'colorize':	true,
	'timestamp':	true,
	'level':	'warn',
	'json':	false
});
/**/

before(function(done) {
	this.timeout(10000);
	const	tasks	= [];

	// Run DB Setup
	tasks.push(function(cb) {
		let confFile;

		if (process.env.DBCONFFILE === undefined) {
			confFile = __dirname + '/../config/db_test.json';
		} else {
			confFile = process.env.DBCONFFILE;
		}

		log.verbose('DB config file: "' + confFile + '"');

		// First look for absolute path
		fs.stat(confFile, function(err) {
			if (err) {

				// Then look for this string in the config folder
				confFile = __dirname + '/../config/' + confFile;
				fs.stat(confFile, function(err) {
					if (err) throw err;
					log.verbose('DB config: ' + JSON.stringify(require(confFile)));
					db.setup(require(confFile), cb);
				});

				return;
			}

			log.verbose('DB config: ' + JSON.stringify(require(confFile)));
			db.setup(require(confFile), cb);
		});
	});

	// Check for empty db
	tasks.push(function(cb) {
		db.query('SHOW TABLES', function(err, rows) {
			if (err) throw err;

			if (rows.length) {
				throw new Error('Database is not empty. To make a test, you must supply an empty database!');
			}

			cb();
		});
	});

	// Setup intercom
	tasks.push(function(cb) {
		let confFile;

		if (process.env.INTCONFFILE === undefined) {
			confFile = __dirname + '/../config/amqp_test.json';
		} else {
			confFile = process.env.INTCONFFILE;
		}

		log.verbose('Intercom config file: "' + confFile + '"');

		// First look for absolute path
		fs.stat(confFile, function(err) {
			if (err) {

				// Then look for this string in the config folder
				confFile = __dirname + '/../config/' + confFile;
				fs.stat(confFile, function(err) {
					if (err) throw err;
					log.verbose('Intercom config: ' + JSON.stringify(require(confFile)));
					lUtils.instances.intercom = new Intercom(require(confFile).default);
					lUtils.instances.intercom.on('ready', cb);
				});

				return;
			}

			log.verbose('Intercom config: ' + JSON.stringify(require(confFile)));
			lUtils.instances.intercom = new Intercom(require(confFile).default);
			lUtils.instances.intercom.on('ready', cb);
		});
	});

	// Migrating user db etc
	tasks.push(function(cb) {
		userLib.ready(cb);
	});

	async.series(tasks, done);
});

describe('User', function() {
	let createdUuid;

	it('should check if a username is available', function(done) {
		userLib.usernameAvailable('testuser', function(err, res) {
			if (err) throw err;
			assert.deepEqual(res, true);
			done();
		});
	});

	describe('fields', function() {
		let	fieldUuid;

		it('should return an UUID for the field we are asking for', function(done) {
			userLib.getFieldUuid('firstname', function(err, result) {
				if (err) throw err;
				fieldUuid = result;
				assert.notDeepEqual(lUtils.formatUuid(fieldUuid), false);
				done();
			});
		});

		it('shold return field name "firstname" for the UUID we created above', function(done) {
			userLib.getFieldName(fieldUuid, function(err, fieldName) {
				if (err) throw err;
				assert.deepEqual(fieldName, 'firstname');
				done();
			});
		});
	});

	describe('passwordHash', function() {
		let hashedPassword;

		it('should create a hashed password', function(done) {
			userLib.hashPassword('foobar', function(err, hash) {
				if (err) throw err;
				hashedPassword = hash;
				done();
			});
		});

		it('should check the hashed password back against the plain text password', function(done) {
			userLib.checkPassword('foobar', hashedPassword, function(err, res) {
				if (err) throw err;
				assert.deepEqual(res, true);
				done();
			});
		});
	});

	describe('create', function() {
		it('should create a new user with random uuid', function(done) {
			userLib.create('lilleman', 'foobar', {'firstname': 'migal', 'lastname': ['Arvidsson', 'Göransson']}, function(err, user) {
				if (err) throw err;

				createdUuid = user.uuid;

				assert.deepEqual(user.fields.lastname[1], 'Göransson');
				assert(typeof user.uuid === 'string', 'uuid should be a string');
				assert(user.uuid.length === 36, 'uuid should be exactly 36 characters long');
				done();
			});
		});

		it('should try to create a new user with the same username and fail', function(done) {
			userLib.create('lilleman', 'foobar', {'firstname': 'migal', 'lastname': ['Arvidsson', 'Göransson']}, function(err, user) {
				assert.notEqual(err, null);
				assert.equal(user, undefined);
				done();
			});
		});

		it('should try to create a user with a field that is undefined', function(done) {
			userLib.create('trams', false, {'firstname': undefined, 'lastname': ['biff', 'baff']}, function(err, user) {
				if (err) throw err;
				assert(user.uuid !== undefined);
				done();
			});
		});

	});

	describe('logins', function() {
		it('should log the created user in by username', function(done) {
			userLib.fromUsername('lilleman', function(err, user) {
				if (err) throw err;
				assert(user.uuid !== undefined, 'uuid should be set');
				assert(user.uuid === createdUuid, 'uuid should match the earlier created uuid');
				done();
			});
		});

		it('should log the created user in by username and password', function(done) {
			userLib.fromUserAndPass('lilleman', 'foobar', function(err, user) {
				if (err) throw err;
				assert(user.uuid === createdUuid, 'uuid should match the earlier created uuid');
				done();
			});
		});

		it('should fail to log the created user in by username and password', function(done) {
			userLib.fromUserAndPass('lilleman', 'nisse', function(err, user) {
				if (err) throw err;
				assert(user === false, 'user should be false');
				done();
			});
		});

		it('should fail to log in a non existing user by username and password', function(done) {
			userLib.fromUserAndPass('does_not_exist', 'foobar', function(err, user) {
				if (err) throw err;
				assert(user === false, 'user should be false');
				done();
			});
		});

		it('should log in user by field', function(done) {
			userLib.fromField('firstname', 'migal', function(err, user) {
				if (err) throw err;
				assert.notDeepEqual(user, false);
				done();
			});
		});

		it('should fail to log in user by an errorous field', function(done) {
			userLib.fromField('firstname', 'mupp', function(err, user) {
				if (err) throw err;
				assert.deepEqual(user, false);
				done();
			});
		});

		it('should log in user by multiple fields', function(done) {
			userLib.fromFields({'firstname': 'migal', 'lastname': 'Arvidsson'}, function(err, user) {
				if (err) throw err;
				assert.notDeepEqual(user, false);
				done();
			});
		});

		it('should fail to log in user by multiple fields when one is wrong', function(done) {
			userLib.fromFields({'firstname': 'migal', 'lastname': 'no its not'}, function(err, user) {
				if (err) throw err;
				assert.deepEqual(user, false);
				done();
			});
		});
	});

	describe('fields on logged in user', function() {
		it('should remove a field from a logged in user', function(done) {
			userLib.fromUsername('lilleman', function(err, user) {
				if (err) throw err;
				assert.deepEqual(user.fields.firstname, ['migal']);
				user.rmField('firstname', function() {
					assert.deepEqual(user.fields.firstname, undefined);
					assert.deepEqual(user.fields.lastname[0], 'Arvidsson');

					// Trying to load the user again to be sure
					userLib.fromUsername('lilleman', function(err, user) {
						if (err) throw err;
						assert.deepEqual(user.fields.firstname, undefined);

						done();
					});
				});
			});
		});

		it('should set a field on a logged in user', function(done) {
			userLib.fromUsername('lilleman', function(err, user) {
				if (err) throw err;
				user.addField('cell', 46709771337, function(err) {
					if (err) throw err;

					assert.deepEqual(user.fields.cell[0],	46709771337);
					assert.deepEqual(user.fields.lastname[0],	'Arvidsson');
					done();
				});
			});
		});

		it('should replace fields with new data', function(done) {
			userLib.fromUsername('lilleman', function(err, user) {
				const newFields = {
					'foo':	'bar',
					'income':	[670, 'more than you']
				};

				if (err) throw err;

				user.replaceFields(newFields, function(err) {
					if (err) throw err;

					assert.deepEqual(user.fields.foo,       ['bar']);
					assert.deepEqual(user.fields.firstname, undefined);
					assert.deepEqual(user.fields.income[1], 'more than you');

					// Reload user to make sure the fields are saved in database correctly
					userLib.fromUsername('lilleman', function(err, secondUser) {
						if (err) throw err;

						assert.deepEqual(secondUser.fields.foo,       ['bar']);
						assert.deepEqual(secondUser.fields.firstname, undefined);
						assert.deepEqual(secondUser.fields.income[1], 'more than you');

						done();
					});
				});
			});
		});

		it('should get field data from any user', function(done) {
			userLib.fromUsername('lilleman', function(err, user) {
				if (err) throw err;

				userLib.getFieldData(user.uuid, 'foo', function(err, data) {
					if (err) throw err;
					assert.deepEqual(data, ['bar']);
					done();
				});
			});
		});

		it('should set a new password for a user', function(done) {
			userLib.fromUsername('lilleman', function(err, user) {
				if (err) throw err;

				assert(user !== false, 'The user object should not be false');

				user.setPassword('biffelbaffel', function(err) {
					if (err) throw err;

					userLib.fromUserAndPass('lilleman', 'biffelbaffel', function(err, user) {
						if (err) throw err;

						assert(user !== false, 'The user object should not be false');

						user.setPassword('BOOM', function(err) {
							if (err) throw err;

							userLib.fromUserAndPass('lilleman', 'biffelbaffel', function(err, user) {
								if (err) throw err;

								assert(user === false, 'The user object should be false');
								done();
							});
						});
					});
				});
			});
		});
	});

	describe('set new username', function() {
		it('should set a new username', function(done) {
			let userUuid;

			userLib.create('habblabang', false, {}, function(err, user) {
				if (err)
					assert( ! err, 'Err should be negative, but is: ' + err.message);

				userUuid = user.uuid;

				userLib.setUsername(userUuid, 'blambadam', function(err) {
					if (err)
						assert( ! err, 'Err should be negative, but is: ' + err.message);

					userLib.fromUsername('blambadam', function(err, user) {
						if (err)
							assert( ! err, 'Err should be negative, but is: ' + err.message);

						assert(user.uuid === userUuid, 'User Uuids missmatch! Is "' + user.uuid + '" but should be "' + userUuid + '"');
						done();
					});
				});
			});
		});
	});

	describe('remove user', function() {
		it('should remove a user', function(done) {
			userLib.rmUser(createdUuid, function(err) {
				if (err) throw err;

				db.query('SELECT * FROM user_users WHERE uuid = ?', [lUtils.uuidToBuffer(createdUuid)], function(err, rows) {
					if (err) throw err;

					assert.deepEqual(rows.length, 0);
					done();
				});
			});
		});
	});

	after(function(done) {
		db.removeAllTables(done);
	});
});
