'use strict';

const	UserLib	= require('../index.js'),
	assert	= require('assert'),
	lUtils	= new (require('larvitutils'))(),
	async	= require('async'),
	log	= new lUtils.Log('warning'),
	db	= require('larvitdb'),
	fs	= require('fs');

let	userLib;

before(function (done) {
	this.timeout(10000);
	const	tasks	= [];

	// Run DB Setup
	tasks.push(function (cb) {
		let	confFile;

		if (process.env.DBCONFFILE === undefined) {
			confFile	= __dirname + '/../config/db_test.json';
		} else {
			confFile	= process.env.DBCONFFILE;
		}

		log.verbose('DB config file: "' + confFile + '"');

		// First look for absolute path
		fs.stat(confFile, function (err) {
			let	conf;

			if (err) {

				// Then look for this string in the config folder
				confFile = __dirname + '/../config/' + confFile;
				fs.stat(confFile, function (err) {
					if (err) throw err;
					log.verbose('DB config: ' + JSON.stringify(require(confFile)));

					conf	= require(confFile);
					conf.log	= log;
					db.setup(conf, cb);
				});

				return;
			}

			log.verbose('DB config: ' + JSON.stringify(require(confFile)));
			conf	= require(confFile);
			conf.log	= log;
			db.setup(conf, cb);
		});
	});

	// Check for empty db
	tasks.push(function (cb) {
		db.query('SHOW TABLES', function (err, rows) {
			if (err) throw err;

			if (rows.length) {
				throw new Error('Database is not empty. To make a test, you must supply an empty database!');
			}

			cb();
		});
	});

	tasks.push(function (cb) {
		userLib = new UserLib({
			'log':	log,
			'db':	db
		}, cb);
	});

	async.series(tasks, done);
});

describe('User', function () {
	let createdUuid;

	it('should check if a username is available', function (done) {
		userLib.usernameAvailable('testuser', function (err, res) {
			if (err) throw err;
			assert.strictEqual(res, true);
			done();
		});
	});

	describe('fields', function () {
		let	fieldUuid;

		it('should return an UUID for the field we are asking for', function (done) {
			userLib.helpers.getFieldUuid('firstname', function (err, result) {
				if (err) throw err;
				fieldUuid	= result;
				assert.notStrictEqual(lUtils.formatUuid(fieldUuid), false);
				done();
			});
		});

		it('shold return field name "firstname" for the UUID we created above', function (done) {
			userLib.helpers.getFieldName(fieldUuid, function (err, fieldName) {
				if (err) throw err;
				assert.strictEqual(fieldName, 'firstname');
				done();
			});
		});
	});

	describe('passwordHash', function () {
		let hashedPassword;

		it('should create a hashed password', function (done) {
			userLib.hashPassword('foobar', function (err, hash) {
				if (err) throw err;
				hashedPassword	= hash;
				done();
			});
		});

		it('should check the hashed password back against the plain text password', function (done) {
			userLib.checkPassword('foobar', hashedPassword, function (err, res) {
				if (err) throw err;
				assert.strictEqual(res, true);
				done();
			});
		});

		it('should not crash when undefined is sent in', function (done) {
			userLib.hashPassword(undefined, function (err) {
				if (err) throw err;
				done();
			});
		});
	});

	describe('create', function () {
		it('should create a new user with random uuid', function (done) {
			userLib.create('lilleman', 'foobar', {'firstname': 'migal', 'lastname': ['Arvidsson', 'Göransson']}, function (err, user) {
				if (err) throw err;

				createdUuid	= user.uuid;

				assert.notStrictEqual(createdUuid, false);
				assert.strictEqual(user.fields.lastname[1], 'Göransson');
				assert(typeof user.uuid === 'string', 'uuid should be a string');
				assert(user.uuid.length === 36, 'uuid should be exactly 36 characters long');
				done();
			});
		});

		it('should try to create a new user with the same username and fail', function (done) {
			userLib.create('lilleman', 'foobar', {'firstname': 'migal', 'lastname': ['Arvidsson', 'Göransson']}, function (err, user) {
				assert.notEqual(err, null);
				assert.strictEqual(user, undefined);
				done();
			});
		});

		it('should try to create a user with a field that is undefined', function (done) {
			userLib.create('trams', false, {'firstname': undefined, 'lastname': ['biff', 'baff']}, function (err, user) {
				if (err) throw err;
				assert.notStrictEqual(user.uuid,	undefined);
				done();
			});
		});

	});

	describe('logins', function () {
		it('should log the created user in by username', function (done) {
			userLib.fromUsername('lilleman', function (err, user) {
				if (err) throw err;
				assert(user.uuid !== undefined, 'uuid should be set');
				assert(user.uuid === createdUuid, 'uuid should match the earlier created uuid');
				done();
			});
		});

		it('should log the created user in by username and password', function (done) {
			userLib.fromUserAndPass('lilleman', 'foobar', function (err, user) {
				if (err) throw err;
				assert(user.uuid === createdUuid, 'uuid should match the earlier created uuid');
				done();
			});
		});

		it('should fail to log the created user in by username and password', function (done) {
			userLib.fromUserAndPass('lilleman', 'nisse', function (err, user) {
				if (err) throw err;
				assert(user === false, 'user should be false');
				done();
			});
		});

		it('should fail to log in a non existing user by username and password', function (done) {
			userLib.fromUserAndPass('does_not_exist', 'foobar', function (err, user) {
				if (err) throw err;
				assert(user === false, 'user should be false');
				done();
			});
		});

		it('should log in user by field', function (done) {
			userLib.fromField('firstname', 'migal', function (err, user) {
				if (err) throw err;
				assert.notStrictEqual(user, false);
				done();
			});
		});

		it('should fail to log in user by an errorous field', function (done) {
			userLib.fromField('firstname', 'mupp', function (err, user) {
				if (err) throw err;
				assert.strictEqual(user, false);
				done();
			});
		});

		it('should log in user by multiple fields', function (done) {
			userLib.fromFields({'firstname': 'migal', 'lastname': 'Arvidsson'}, function (err, user) {
				if (err) throw err;
				assert.notStrictEqual(user, false);
				done();
			});
		});

		it('should fail to log in user by multiple fields when one is wrong', function (done) {
			userLib.fromFields({'firstname': 'migal', 'lastname': 'no its not'}, function (err, user) {
				if (err) throw err;
				assert.strictEqual(user, false);
				done();
			});
		});
	});

	describe('fields on logged in user', function () {
		it('should remove a field from a logged in user', function (done) {
			userLib.fromUsername('lilleman', function (err, user) {
				if (err) throw err;
				assert.deepEqual(user.fields.firstname, ['migal']);
				user.rmField('firstname', function () {
					assert.strictEqual(user.fields.firstname, undefined);
					assert.strictEqual(user.fields.lastname[0], 'Arvidsson');

					// Trying to load the user again to be sure
					userLib.fromUsername('lilleman', function (err, user) {
						if (err) throw err;
						assert.strictEqual(user.fields.firstname, undefined);

						done();
					});
				});
			});
		});

		it('should set a field on a logged in user', function (done) {
			userLib.fromUsername('lilleman', function (err, user) {
				if (err) throw err;
				user.addField('cell', 46709771337, function (err) {
					if (err) throw err;

					assert.strictEqual(user.fields.cell[0],	46709771337);
					assert.strictEqual(user.fields.lastname[0],	'Arvidsson');
					done();
				});
			});
		});

		it('should replace fields with new data', function (done) {
			userLib.fromUsername('lilleman', function (err, user) {
				const newFields = {
					'foo':	'bar',
					'income':	[670, 'more than you']
				};

				if (err) throw err;

				user.replaceFields(newFields, function (err) {
					if (err) throw err;

					assert.deepEqual(user.fields.foo,	['bar']);
					assert.strictEqual(user.fields.firstname,	undefined);
					assert.strictEqual(user.fields.income[1],	'more than you');

					// Reload user to make sure the fields are saved in database correctly
					userLib.fromUsername('lilleman', function (err, secondUser) {
						if (err) throw err;

						assert.deepEqual(secondUser.fields.foo,	['bar']);
						assert.strictEqual(secondUser.fields.firstname,	undefined);
						assert.strictEqual(secondUser.fields.income[1],	'more than you');

						done();
					});
				});
			});
		});

		it('should get field data from any user', function (done) {
			userLib.fromUsername('lilleman', function (err, user) {
				if (err) throw err;

				userLib.getFieldData(user.uuid, 'foo', function (err, data) {
					if (err) throw err;
					assert.deepEqual(data, ['bar']);
					done();
				});
			});
		});

		it('should set a new password for a user', function (done) {
			userLib.fromUsername('lilleman', function (err, user) {
				if (err) throw err;

				assert(user !== false, 'The user object should not be false');

				user.setPassword('biffelbaffel', function (err) {
					if (err) throw err;

					userLib.fromUserAndPass('lilleman', 'biffelbaffel', function (err, user) {
						if (err) throw err;

						assert(user !== false, 'The user object should not be false');

						user.setPassword('BOOM', function (err) {
							if (err) throw err;

							userLib.fromUserAndPass('lilleman', 'biffelbaffel', function (err, user) {
								if (err) throw err;

								assert(user === false, 'The user object should be false');
								done();
							});
						});
					});
				});
			});
		});

		it('should add a new field along side existing fields', function (done) {
			userLib.fromUsername('lilleman', function (err, user) {
				if (err) throw err;
				assert.notStrictEqual(user,	false);
				assert.strictEqual(user.fields.foo.length,	1);
				assert.strictEqual(user.fields.foo[0],	'bar');

				user.addFields({'foo': ['yes', 'no', 'bar']}, function (err) {
					if (err) throw err;

					assert.strictEqual(user.fields.foo.length, 4);

					done();
				});
			});
		});

		it('should set no fields on a user', function (done) {
			userLib.fromUsername('trams', function (err, user1) {
				if (err) throw err;

				userLib.addUserDataFields(user1.uuid, {}, function (err) {
					if (err) throw err;

					userLib.fromUsername('trams', function (err, user2) {
						if (err) throw err;

						assert.deepEqual(user1.fields,	user2.fields);

						done();
					});
				});
			});
		});
	});

	describe('set new username', function () {
		it('should set a new username', function (done) {
			let userUuid;

			userLib.create('habblabang', false, {}, function (err, user) {
				if (err) throw err;

				userUuid = user.uuid;

				userLib.setUsername(userUuid, 'blambadam', function (err) {
					if (err) throw err;

					userLib.fromUsername('blambadam', function (err, user) {
						if (err) throw err;

						assert(user.uuid === userUuid, 'User Uuids missmatch! Is "' + user.uuid + '" but should be "' + userUuid + '"');
						done();
					});
				});
			});
		});

		it('should refresh read the new value back on the user object', function (done) {
			userLib.create('böb', false, {}, function (err, user) {
				if (err) throw err;

				user.setUsername('untz-lord-69', function (err) {
					if (err) throw err;

					assert.strictEqual(user.username, 'untz-lord-69');
					done();
				});
			});
		});
	});

	describe('set new password', function () {
		let user;

		it('should log the created user in by username', function (done) {
			userLib.fromUsername('lilleman', function (err, result) {
				if (err) throw err;
				assert.equal(result.username, 'lilleman');
				user = result;
				done();
			});
		});

		it('should set new password', function (done) {
			userLib.setPassword(user.uuid, 'secretpassword', function (err) {
				if (err) throw err;
				done();
			});
		});

		it('should log the user in by the new password', function (done) {
			userLib.fromUserAndPass(user.username, 'secretpassword', function (err, result) {
				if (err) throw err;
				assert(user.uuid === result.uuid, 'uuid should match the earlier created uuid');
				done();
			});
		});
	});

	describe('remove user', function () {
		it('should remove a user', function (done) {
			userLib.rmUser(createdUuid, function (err) {
				if (err) throw err;

				db.query('SELECT * FROM user_users WHERE uuid = ?', [lUtils.uuidToBuffer(createdUuid)], function (err, rows) {
					if (err) throw err;

					assert.strictEqual(rows.length, 0);
					done();
				});
			});
		});
	});

	describe('Get list of users', function () {
		const uuids = [];

		this.timeout(5000);

		it('Get list of users', function (done) {
			const tasks	= [];

			tasks.push(function (cb) {
				userLib.create('user1', 'somepassword', { 'role' : ['customer', 'user'], 'veryUnique': ['muchUnique']}, function (err, user) {
					uuids.push(user.uuid);
					if (err) throw err;
					cb();
				});
			});

			tasks.push(function (cb) {
				userLib.create('user2', 'somepassword', { 'role' : ['not customer', 'user'], 'lastname': ['biff', 'bonk']}, function (err, user) {
					uuids.push(user.uuid);
					if (err) throw err;
					cb();
				});
			});

			tasks.push(function (cb) {
				let	users	= new UserLib.Users({'db': db, 'log': log});

				users.get(function (err, userList) {
					let	foundUser1	= false,
						foundUser2	= false;

					if (err) throw err;

					assert(userList.length >= 2,	'2 or more users should exist in database');

					for (let i = 0; i < userList.length; i ++) {
						if (userList[i].uuid === uuids[0]) {
							foundUser1	= true;
						}

						if (userList[i].uuid === uuids[1]) {
							foundUser2	= true;
						}
					}

					assert.strictEqual(foundUser1,	true,	'user1 not found');
					assert.strictEqual(foundUser2,	true,	'user2 not found');

					cb();
				});
			});

			async.series(tasks, done);
		});

		it('Get list of users with matching fields', function (done) {
			const	users	= new UserLib.Users({'db': db, 'log': log});

			users.matchAllFields	= { 'role': ['customer']};
			users.returnFields	= [];

			users.get(function (err, userList, totalElements) {
				if (err) throw err;
				assert.strictEqual(totalElements,	1);
				assert.strictEqual(userList.length,	1);
				assert.strictEqual(userList[0].username,	'user1');

				done();
			});
		});

		it('Get list of data values for field', function (done) {
			const	users	= new UserLib.Users({'db': db, 'log': log});

			users.getFieldData('lastname', function (err, result) {
				if (err) throw err;
				assert.strictEqual(result.length,	3);

				assert.strictEqual(result.indexOf('biff') > - 1,	true);
				assert.strictEqual(result.indexOf('baff') > - 1,	true);
				assert.strictEqual(result.indexOf('bonk') > - 1,	true);
				done();
			});
		});

		it('Get list of users with requested field data', function (done) {
			const	users	= new UserLib.Users({'db': db, 'log': log});

			users.returnFields	= ['lastname'];

			users.get(function (err, result) {
				const expectedFields = ['uuid', 'username', 'lastname'];

				if (err) throw err;
				assert.notStrictEqual(result,	undefined);
				assert.strictEqual(result.length,	5);

				for (let r of result) {
					for (let key in r) {
						assert.strictEqual(expectedFields.indexOf(key) > - 1,	true);
					}
				}

				done();
			});
		});

		it('Get list of users where fieldData exists', function (done) {
			const	users	= new UserLib.Users({'db': db, 'log': log});

			users.matchExistingFields	= ['veryUnique'];

			users.get(function (err, userList, totalElements) {
				if (err) throw err;

				assert.strictEqual(totalElements,	1);
				assert.strictEqual(userList.length,	1);
				assert.strictEqual(userList[0].username,	'user1');

				done();
			});
		});

		it('Get users by uuid', function (done) {
			const	users	= new UserLib.Users({'db': db, 'log': log});

			users.uuids	= [uuids[1]];

			users.get(function (err, userList) {
				if (err) throw err;

				assert.strictEqual(userList.length,	1);
				assert.strictEqual(uuids[1],	userList[0].uuid);
				done();
			});
		});
	});
});

after(function (done) {
	db.removeAllTables(done);
});