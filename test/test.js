'use strict';

// Simulate local runtime - assume to run in closest node_modules or the tests will fail
require.main.filename = __dirname + '/../../../server.js';

var assert  = require('assert'),
    log     = require('winston'),
    db      = require('larvitdb'),
    fs      = require('fs'),
    path    = require('path'),
    appPath = path.dirname(require.main.filename),
    userLib = require('larvituser');

describe('User', function() {

	before(function(done) {
		// Set up winston
		log.remove(log.transports.Console);
		log.add(log.transports.Console, {
			'level': 'error',
			'colorize': true,
			'timestamp': true
		});

		if (fs.existsSync(appPath + '/logs')) {
			log.add(log.transports.File, {
				'filename': appPath + '/logs/mocha.log',
				'timestamp': true,
				'handleExceptions': true, // THis makes winston handle exceptions instead of node native
				'level': 'debug'
			});
		}

		// Check for empty db
		db.query('SHOW TABLES', function(err, rows) {
			if (err) {
				log.error(err);
				process.exit(1);
			}

			if (rows.length) {
				log.error('Database is not empty. To make a test, you must supply an empty database!');
				process.exit(1);
			}

			done();
		});
	});

	it('should check if a username is available', function(done) {
		userLib.usernameAvailable('testuser', function(err, res) {
			assert.deepEqual(res, true);
			done();
		});
	});

	describe('fields', function() {

		it('should return an ID for the field we are asking for', function(done) {
			userLib.getFieldId('firstname', function(err, fieldId) {
				assert.deepEqual(fieldId, 1);
				done();
			});
		});

		it('shold return field name "firstname" for ID 1 we created above', function(done) {
			userLib.getFieldName(1, function(err, fieldName) {
				assert.deepEqual(fieldName, 'firstname');
				done();
			});
		});
	});

	describe('passwordHash', function() {
		var hashedPassword;

		it('should create a hashed password', function(done) {
			userLib.hashPassword('foobar', function(err, hash) {
				hashedPassword = hash;
				done();
			});
		});

		it('should check the hashed password back against the plain text password', function(done) {
			userLib.checkPassword('foobar', hashedPassword, function(err, res) {
				assert.deepEqual(res, true);
				done();
			});
		});
	});

	describe('create', function() {

		it('should create a new user', function(done) {
			userLib.create('lilleman', 'foobar', {'firstname': 'migal', 'lastname': ['Arvidsson', 'Göransson']}, function(err, user) {
				assert.deepEqual(user.fields.lastname[1], 'Göransson');
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
	});

	describe('logins', function() {

		it('should log the created user in by username', function(done) {
			userLib.fromUsername('lilleman', function(err, user) {
				assert.deepEqual(user.id, 1);
				done();
			});
		});

		it('should log the created user in by username and password', function(done) {
			userLib.fromUserAndPass('lilleman', 'foobar', function(err, user) {
				assert.deepEqual(user.id, 1);
				done();
			});
		});

	});

	describe('fields on logged in user', function() {
		it('should remove a field from a logged in user', function(done) {
			userLib.fromUsername('lilleman', function(err, user) {
				assert.deepEqual(user.fields.firstname, ['migal']);
				user.rmField('firstname', function(err) {
					assert.deepEqual(user.fields.firstname, undefined);
					assert.deepEqual(user.fields.lastname[0], 'Arvidsson');

					// Trying to load the user again to be sure
					userLib.fromUsername('lilleman', function(err, user) {
						assert.deepEqual(user.fields.firstname, undefined);

						done();
					});
				});
			});
		});

		it('should set a field on a logged in user', function(done) {
			userLib.fromUsername('lilleman', function(err, user) {
				user.addField('cell', 46709771337, function(err) {
					assert.deepEqual(user.fields.cell[0], 46709771337);
					assert.deepEqual(user.fields.lastname[0], 'Arvidsson');
					done();
				});
			});
		});

		it('should replace fields with new data', function(done) {
			userLib.fromUsername('lilleman', function(err, user) {
				var newFields = {
					'foo': 'bar',
					'income': [670, 'more than you']
				};

				user.replaceFields(newFields, function(err) {
					assert.deepEqual(user.fields.foo, ['bar']);
					assert.deepEqual(user.fields.firstname, undefined);
					assert.deepEqual(user.fields.income[1], 'more than you');
					done();
				});
			});
		});

		it('should get field data from any user', function(done) {
			userLib.fromUsername('lilleman', function(err, user) {
				userLib.getFieldData(user.id, 'foo', function(err, data) {
					assert.deepEqual(data, ['bar']);
					done();
				});
			});
		});

	});

	after(function(done) {
		db.query('DROP TABLE user_users_data', function(err, rows) {
			if (err) {
				console.error(err);
				process.exit(1);
			}

			db.query('DROP TABLE user_roles_rights', function(err, rows) {
				if (err) {
					console.error(err);
					process.exit(1);
				}

				db.query('DROP TABLE user_data_fields', function(err, rows) {
					if (err) {
						console.error(err);
						process.exit(1);
					}

					db.query('DROP TABLE user_users', function(err, rows) {
						if (err) {
							console.error(err);
							process.exit(1);
						}

						done();
					});
				});
			});
		});
	});

});