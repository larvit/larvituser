'use strict';

const userLib = require('../larvituser.js'),
      assert  = require('assert'),
      log     = require('winston'),
      db      = require('larvitdb'),
      fs      = require('fs');

// Set up winston
log.remove(log.transports.Console);

before(function(done) {
	let confFile;

	function runDbSetup(confFile) {
		log.verbose('DB config: ' + JSON.stringify(require(confFile)));

		db.setup(require(confFile), function(err) {
			assert( ! err, 'err should be negative');

			done();
		});
	}

	if (process.argv[3] === undefined)
		confFile = __dirname + '/../config/db_test.json';
	else
		confFile = process.argv[3].split('=')[1];

	log.verbose('DB config file: "' + confFile + '"');

	fs.stat(confFile, function(err) {
		const altConfFile = __dirname + '/../config/' + confFile;

		if (err) {
			log.info('Failed to find config file "' + confFile + '", retrying with "' + altConfFile + '"');

			fs.stat(altConfFile, function(err) {
				if (err)
					assert( ! err, 'fs.stat failed: ' + err.message);

				if ( ! err)
					runDbSetup(altConfFile);
			});
		} else {
			runDbSetup(confFile);
		}
	});
});

describe('User', function() {
	let createdUuid;

	before(function(done) {
		// Check for empty db
		db.query('SHOW TABLES', function(err, rows) {
			if (err) {
				assert( ! err, 'err should be negative');
				log.error(err);
				process.exit(1);
			}

			if (rows.length) {
				assert.deepEqual(rows.length, 0);
				log.error('Database is not empty. To make a test, you must supply an empty database!');
				process.exit(1);
			}

			userLib.checkDbStructure(function(err) {
				assert( ! err, 'err should be negative');

				done();
			});
		});
	});

	it('should check if a username is available', function(done) {
		userLib.usernameAvailable('testuser', function(err, res) {
			assert( ! err, 'err should be negative');
			assert.deepEqual(res, true);
			done();
		});
	});

	describe('fields', function() {
		it('should return an ID for the field we are asking for', function(done) {
			userLib.getFieldId('firstname', function(err, fieldId) {
				assert( ! err, 'err should be negative');
				assert.deepEqual(fieldId, 1);
				done();
			});
		});

		it('shold return field name "firstname" for ID 1 we created above', function(done) {
			userLib.getFieldName(1, function(err, fieldName) {
				assert( ! err, 'err should be negative');
				assert.deepEqual(fieldName, 'firstname');
				done();
			});
		});
	});

	describe('passwordHash', function() {
		let hashedPassword;

		it('should create a hashed password', function(done) {
			userLib.hashPassword('foobar', function(err, hash) {
				assert( ! err, 'err should be negative');
				hashedPassword = hash;
				done();
			});
		});

		it('should check the hashed password back against the plain text password', function(done) {
			userLib.checkPassword('foobar', hashedPassword, function(err, res) {
				assert( ! err, 'err should be negative');
				assert.deepEqual(res, true);
				done();
			});
		});
	});

	describe('create', function() {
		it('should create a new user with random uuid', function(done) {
			userLib.create('lilleman', 'foobar', {'firstname': 'migal', 'lastname': ['Arvidsson', 'Göransson']}, function(err, user) {
				assert( ! err, 'err should be negative');

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
				assert( ! err, 'err should be negative');
				assert(user.uuid !== undefined);
				done();
			});
		});
	});

	describe('logins', function() {
		it('should log the created user in by username', function(done) {
			userLib.fromUsername('lilleman', function(err, user) {
				assert( ! err, 'err should be negative');
				assert(user.uuid !== undefined, 'uuid should be set');
				assert(user.uuid === createdUuid, 'uuid should match the earlier created uuid');
				done();
			});
		});

		it('should log the created user in by username and password', function(done) {
			userLib.fromUserAndPass('lilleman', 'foobar', function(err, user) {
				assert( ! err, 'err should be negative');
				assert(user.uuid === createdUuid, 'uuid should match the earlier created uuid');
				done();
			});
		});

		it('should fail to log the created user in by username and password', function(done) {
			userLib.fromUserAndPass('lilleman', 'nisse', function(err, user) {
				assert( ! err, 'err should be negative');
				assert(user === false, 'user should be false');
				done();
			});
		});
	});

	describe('fields on logged in user', function() {
		it('should remove a field from a logged in user', function(done) {
			userLib.fromUsername('lilleman', function(err, user) {
				assert( ! err, 'err should be negative');
				assert.deepEqual(user.fields.firstname, ['migal']);
				user.rmField('firstname', function() {
					assert.deepEqual(user.fields.firstname, undefined);
					assert.deepEqual(user.fields.lastname[0], 'Arvidsson');

					// Trying to load the user again to be sure
					userLib.fromUsername('lilleman', function(err, user) {
						assert( ! err, 'err should be negative');
						assert.deepEqual(user.fields.firstname, undefined);

						done();
					});
				});
			});
		});

		it('should set a field on a logged in user', function(done) {
			userLib.fromUsername('lilleman', function(err, user) {
				assert( ! err, 'err should be negative');
				user.addField('cell', 46709771337, function() {
					assert.deepEqual(user.fields.cell[0], 46709771337);
					assert.deepEqual(user.fields.lastname[0], 'Arvidsson');
					done();
				});
			});
		});

		it('should replace fields with new data', function(done) {
			userLib.fromUsername('lilleman', function(err, user) {
				const newFields = {
					'foo':    'bar',
					'income': [670, 'more than you']
				};

				assert( ! err, 'err should be negative');

				user.replaceFields(newFields, function() {
					assert.deepEqual(user.fields.foo,       ['bar']);
					assert.deepEqual(user.fields.firstname, undefined);
					assert.deepEqual(user.fields.income[1], 'more than you');
					done();
				});
			});
		});

		it('should get field data from any user', function(done) {
			userLib.fromUsername('lilleman', function(err, user) {
				assert( ! err, 'err should be negative');
				userLib.getFieldData(user.uuid, 'foo', function(err, data) {
					assert( ! err, 'err should be negative');
					assert.deepEqual(data, ['bar']);
					done();
				});
			});
		});

		it('should set a new password for a user', function(done) {
			userLib.fromUsername('lilleman', function(err, user) {
				assert( ! err, 'err should be negative');

				assert(user !== false, 'The user object should not be false');

				user.setPassword('biffelbaffel', function(err) {
					assert( ! err, 'err should be negative');

					userLib.fromUserAndPass('lilleman', 'biffelbaffel', function(err, user) {
						assert( ! err, 'err should be negative');

						assert(user !== false, 'The user object should not be false');

						user.setPassword('BOOM', function(err) {
							assert( ! err, 'err should be negative');

							userLib.fromUserAndPass('lilleman', 'biffelbaffel', function(err, user) {
								assert( ! err, 'err should be negative');

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

	after(function(done) {
		db.removeAllTables(done);
	});
});