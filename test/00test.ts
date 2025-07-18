import { Log, LogInstance, Utils } from 'larvitutils';
import { UserBase } from '../src/userBase';
import { UserLib, Users } from '../src/index';
import { v4 } from 'uuid';
import assert, { AssertionError } from 'assert';
import Db from 'larvitdb';
import { DataWriter } from '../src/dataWriter';

let userLib: UserLib;
let db: any;
let log: LogInstance;
let lUtils: Utils;

async function assertThrows(fn: () => void, msg?: string): Promise<void> {
	try {
		await fn();
		throw new AssertionError({ message: 'Did not get expected exception' });
	} catch (_err) {
		if (_err instanceof AssertionError) {
			throw _err;
		}

		const err = _err as Error;
		if (msg !== undefined && msg !== err.message) {
			throw new AssertionError({
				message: `Exceptions message was not the expected one,\n\texpected: "${msg}" \n\tactual: "${err.message}"`,
			});
		}
	}
}

async function createDb(): Promise<unknown> {
	const confFile = process.env.DBCONFFILE ? process.env.DBCONFFILE : __dirname + '/../config/db_test.json';
	log.verbose('DB config file: "' + confFile + '"');

	// eslint-disable-next-line @typescript-eslint/no-var-requires
	const conf = require(confFile);
	log.verbose('DB config: ' + JSON.stringify(conf));

	conf.log = log;

	const db = new Db(conf);
	await db.connect();

	return db;
}

before(async () => {
	// Create log
	log = new Log('error');

	// Run DB Setup
	db = await createDb();

	// Create LarvitUtils
	lUtils = new Utils({ log });

	// Create UserLib
	userLib = new UserLib({
		log: log,
		db: db,
	});
});

beforeEach(async () => {
	await db.removeAllTables();
	await userLib.runDbMigrations(`${__dirname}/../dbmigration`);
});

describe('User', () => {
	it('should check if a username is available', async () => {
		const isAvailable = await userLib.usernameAvailable('testuser');
		assert.strictEqual(isAvailable, true, '"testuser" username should be available');
	});

	it('should return false if trying to get user by non-existing uuid', async () => {
		const isAvailable = await userLib.fromUuid(v4());
		assert.strictEqual(isAvailable, false, 'user should not be available');
	});

	it('should return true if verifying if user exists with a valid uuid', async () => {
		const user = await userLib.create('testuser123', '');
		const isAvailable = await userLib.userExists(user.uuid);
		assert.strictEqual(isAvailable, true, 'user should be available');
	});

	it('should return false if verifying if user exists with a non-existing uuid', async () => {
		const isAvailable = await userLib.userExists(v4());
		assert.strictEqual(isAvailable, false, 'user should not be available');
	});

	it('should throw error if trying to use an UserBase with empty uuid', async () => {
		const userBase = new UserBase({
			log, userInstance: userLib, username: 'user1', passwordIsFalse: false, uuid: '',
		});

		await assertThrows(async () => await userBase.addField('f', 'v'));
		await assertThrows(async () => await userBase.replaceFields({ korv: 'tolv' }));
		await assertThrows(async () => await userBase.rmField('korv'));
		await assertThrows(async () => await userBase.setPassword('p'));
		await assertThrows(async () => await userBase.setUsername('u'));
		await assertThrows(async () => await userBase.rm());
	});

	describe('fields', async () => {
		it('should return an UUID for the field we are asking for', async () => {
			const fieldUuid = await userLib.helpers.getFieldUuid('firstname');
			assert.notStrictEqual(fieldUuid, false);
			assert.notStrictEqual(lUtils.formatUuid(fieldUuid as string), false);
		});

		it('shold return field name for a created field UUID', async () => {
			const fieldUuid = await userLib.helpers.getFieldUuid('korv');

			const fieldName = await userLib.helpers.getFieldName(fieldUuid as string);
			assert.strictEqual(fieldName, 'korv');
		});
	});

	describe('passwordHash', () => {
		it('should create a hashed password', async () => {
			const hashedPassword = await userLib.hashPassword('foobar');
			const isOkPassword = await userLib.checkPassword('foobar', hashedPassword);
			assert.strictEqual(isOkPassword, true);
		});

		it('should not crash when undefined is sent in', async () => {
			assert.doesNotThrow(async () => await userLib.hashPassword(undefined as unknown as string));
		});
	});

	describe('create', () => {
		it('should create a new user with random uuid', async () => {
			const user = await userLib.create('lilleman', '', { firstname: 'migal', lastname: ['Arvidsson', 'Göransson'] });
			assert.notStrictEqual(user.uuid, false);
			assert.strictEqual(user.fields.lastname[1], 'Göransson');
			assert(typeof user.uuid === 'string', 'uuid should be a string');
			assert(user.uuid.length === 36, 'uuid should be exactly 36 characters long');
		});

		it('should try to create a new user with empty username and fail', async () => {
			await assertThrows(async () => await userLib.create('', ''));
		});

		it('should try to create a new user with the same username and fail', async () => {
			await userLib.create('korvuser', '');

			await assertThrows(async () => await userLib.create('korvuser', ''));
		});

		it('should convert undefined field to empty string when creating user', async () => {
			const user = await userLib.create('trams', '', { firstname: undefined as any, lastname: ['biff', 'baff'] });

			assert.deepStrictEqual(user.fields.firstname, ['']);
			assert.deepStrictEqual(user.fields.lastname, ['biff', 'baff']);
		});

		it('should throw error when trying to create user with same uuid', async () => {
			const uuid = v4();
			await userLib.create('user1', '', {}, uuid);
			await assertThrows(async () => await userLib.create('user2', '', {}, uuid), `No user created, duplicate key on uuid: "${uuid}" or username: "user2"`);
		});

		it('should create a user with password set to false to disallow logins', async () => {
			await userLib.create('korv', false, {});
			const user = await userLib.fromUserAndPass('korv', '');
			assert(typeof user === 'boolean', 'user should be boolean');
			assert.strictEqual(user, false);
		});
	});

	describe('logins', async () => {
		it('should get a user by username', async () => {
			await userLib.create('user1', '');

			const user = await userLib.fromUsername('user1');
			assert(typeof user !== 'boolean', 'uuid should not be a boolean');
			assert(user.uuid !== undefined, 'uuid should be set');
			assert.strictEqual(user.username, 'user1');
		});

		it('should get user by username and password', async () => {
			await userLib.create('user2', 'foobar');

			const user = await userLib.fromUserAndPass('user2', 'foobar');
			assert(typeof user !== 'boolean', 'uuid should not be a boolean');
			assert(user.username === 'user2', 'username should match the earlier created user');
		});

		it('should fail to get user by username and password if wrong password', async () => {
			await userLib.create('user3', 'foobar');

			const user = await userLib.fromUserAndPass('user3', 'asdf');
			assert.strictEqual(user, false);
		});

		it('should fail to get a non existing user by username and password', async () => {
			const user = await userLib.fromUserAndPass('user4', 'asdf');
			assert.strictEqual(user, false);
		});

		it('should fail fromUserAndPass if username is an array', async () => {
			await assertThrows(
				async () => await userLib.fromUserAndPass(['eeh', 'asdf'] as unknown as string, 'asdf'),
				'Username must be a string',
			);
		});

		it('should fail fromUserAndPass if password is an array', async () => {
			await assertThrows(
				async () => await userLib.fromUserAndPass('asdf', ['eeh', 'asdf'] as unknown as string),
				'Password must be a string',
			);
		});

		it('should get user by field', async () => {
			await userLib.create('user5', '', { firstname: 'korv' });

			const user = await userLib.fromField('firstname', 'korv');
			assert(typeof user !== 'boolean', 'user should not be a boolean');
			assert.strictEqual(user.username, 'user5');
		});

		it('should fail to get user by an errorous field', async () => {
			await userLib.create('user6', '', { firstname: 'korv' });

			const user = await userLib.fromField('tolvtolv', 'korv');
			assert.strictEqual(user, false);
		});

		it('should get user by multiple fields', async () => {
			await userLib.create('nisse', '', { firstname: 'nisse', lastname: 'korv' });
			await userLib.create('another_nisse', '', { firstname: 'nisse', lastname: 'korv2' });

			const user = await userLib.fromFields({ firstname: 'nisse', lastname: 'korv' });
			assert(typeof user !== 'boolean', 'user should not be a boolean');
			assert.strictEqual(user.username, 'nisse');
		});

		it('should fail to get user by multiple fields if one field does not match', async () => {
			await userLib.create('nisse', '', { firstname: 'korv', lastname: 'tolv' });

			const user = await userLib.fromFields({ firstname: 'korv', lastname: 'asdf' });
			assert.strictEqual(user, false);
		});
	});

	describe('fields on a user', async () => {
		it('should remove a field from a user', async () => {
			await userLib.create('nisse', '', { firstname: 'korv', lastname: 'tolv' });

			const user = await userLib.fromUsername('nisse');
			assert(typeof user !== 'boolean', 'user should not be a boolean');
			await user.rmField('firstname');

			assert.strictEqual(user.fields.firstname, undefined);
			assert.strictEqual(user.fields.lastname[0], 'tolv');
			const loadedUser = await userLib.fromUsername('nisse');
			assert(typeof loadedUser !== 'boolean', 'user should not be a boolean');
			assert.strictEqual(loadedUser.fields.firstname, undefined);
			assert.strictEqual(loadedUser.fields.lastname[0], 'tolv');
		});

		it('should add a field on a user', async () => {
			await userLib.create('nisse', '', { firstname: 'korv', lastname: 'tolv' });

			const user = await userLib.fromUsername('nisse');
			assert(typeof user !== 'boolean', 'user should not be a boolean');
			await user.addField('cell', '46701121337');

			assert.strictEqual(user.fields.cell[0], '46701121337');
			const loadedUser = await userLib.fromUsername('nisse');
			assert(typeof loadedUser !== 'boolean', 'user should not be a boolean');
			assert.strictEqual(loadedUser.fields.cell[0], '46701121337');
		});

		it('should add a field on a user using addUserDataField', async () => {
			const user = await userLib.create('nisse', '', { firstname: 'korv', lastname: 'tolv' });

			await userLib.addUserDataField(user.uuid, 'newField', ['value1', 'value2']);

			const loadedUser = await userLib.fromUsername('nisse');
			assert(typeof loadedUser !== 'boolean', 'user should not be a boolean');
			assert.deepStrictEqual(loadedUser.fields.newField, ['value1', 'value2']);
		});

		it('should add a field on a user using addUserDataField with undefined values as empty strings', async () => {
			const user = await userLib.create('nisse', '', { firstname: 'korv', lastname: 'tolv' });

			await userLib.addUserDataField(user.uuid, 'newField', undefined as unknown as string);

			const loadedUser = await userLib.fromUsername('nisse');
			assert(typeof loadedUser !== 'boolean', 'user should not be a boolean');
			assert.deepStrictEqual(loadedUser.fields.newField, ['']);
		});

		it('should replace and add fields on a user', async () => {
			await userLib.create('nisse', '', { firstname: 'korv', lastname: 'tolv' });

			const user = await userLib.fromUsername('nisse');
			assert(typeof user !== 'boolean', 'user should not be a boolean');
			await user.replaceFields({ lastname: 'asdf', size: '12' });

			assert.strictEqual(user.fields.lastname[0], 'asdf');
			assert.strictEqual(user.fields.size[0], '12');
			const loadedUser = await userLib.fromUsername('nisse');
			assert(typeof loadedUser !== 'boolean', 'user should not be a boolean');
			assert.strictEqual(loadedUser.fields.lastname[0], 'asdf');
			assert.strictEqual(loadedUser.fields.size[0], '12');
		});

		it('should replace field with different number of values', async () => {
			const user = await userLib.create('user1', '', { firstname: 'korv', lastname: 'tolv' });

			await user.replaceFields({ firstname: ['korv', 'bert'] });
			const loadedUser = await userLib.fromUsername('user1');
			assert(typeof loadedUser !== 'boolean', 'user should not be a boolean');
			assert.strictEqual(loadedUser.fields.firstname.length, 2);
			assert.strictEqual(loadedUser.fields.firstname[0], 'korv');
			assert.strictEqual(loadedUser.fields.firstname[1], 'bert');
		});

		it('should replace fields and handle undefined values as empty strings', async () => {
			const user = await userLib.create('user1', '', { firstname: 'korv', lastname: 'tolv' });

			// NOTE: This is tested due to a bug found in real js code (hence the brutal type casting)
			await user.replaceFields({ firstname: undefined as unknown as string, lastname: '' });
			const loadedUser = await userLib.fromUsername('user1');
			assert(typeof loadedUser !== 'boolean', 'user should not be a boolean');
			assert.strictEqual(Object.keys(loadedUser.fields).length, 2);
			assert.deepStrictEqual(loadedUser.fields.firstname, ['']);
			assert.deepStrictEqual(loadedUser.fields.lastname, ['']);
		});

		it('should get field data from user', async () => {
			await userLib.create('nisse', '', { firstname: 'korv', lastname: 'tolv' });

			const user = await userLib.fromUsername('nisse');
			assert(typeof user !== 'boolean', 'user should not be a boolean');
			const fieldData = await userLib.getFieldData(user.uuid, 'lastname');

			assert.strictEqual(fieldData[0], 'tolv');
		});

		it('should set a new password for a user', async () => {
			await userLib.create('nisse', 'pass', { firstname: 'korv', lastname: 'tolv' });

			const user = await userLib.fromUsername('nisse');
			assert(typeof user !== 'boolean', 'user should not be a boolean');
			await user.setPassword('new_pass');

			const userWithNewPass = await userLib.fromUserAndPass('nisse', 'new_pass');
			assert(typeof userWithNewPass !== 'boolean', 'user should not be a boolean');
			assert.strictEqual(userWithNewPass.username, 'nisse');

			const userWithOldPass = await userLib.fromUserAndPass('nisse', 'pass');
			assert.strictEqual(userWithOldPass, false);
		});

		it('should set no fields on a user', async () => {
			await userLib.create('nisse', '', { firstname: 'korv', lastname: 'tolv' });

			const user = await userLib.fromUsername('nisse');
			assert(typeof user !== 'boolean', 'user should not be a boolean');
			await userLib.addUserDataFields(user.uuid, {});

			const loadedUser = await userLib.fromUsername('nisse');
			assert(typeof loadedUser !== 'boolean', 'user should not be a boolean');
			assert.deepEqual(user.fields, loadedUser.fields);
		});

		it('should replace fields on user to no fields when object is empty', async () => {
			const user = await userLib.create('nisse', '', { firstname: 'korv', lastname: 'tolv' });

			await user.replaceFields({});

			const loadedUser = await userLib.fromUsername('nisse');
			assert(typeof loadedUser !== 'boolean', 'user should not be a boolean');
			assert.strictEqual(Object.keys(loadedUser.fields).length, 0);
		});

		it('should throw error if trying to replace fields on non-existing user uuid', async () => {
			const uuid = v4();
			await assertThrows(async () => userLib.replaceUserFields(uuid, { field: 'value' }), `Invalid user uuid: "${uuid}", no records found in database of this user`);
		});

		it('should add the same field to two different users', async () => {
			const user1 = await userLib.create('user1', '');
			const user2 = await userLib.create('user2', '');

			await user1.addField('f', 'v1');
			await user2.addField('f', 'v2');

			const loadedUser1 = await userLib.fromUsername('user1');
			const loadedUser2 = await userLib.fromUsername('user2');
			assert(typeof loadedUser1 !== 'boolean', 'user should not be a boolean');
			assert(typeof loadedUser2 !== 'boolean', 'user should not be a boolean');
			assert.strictEqual(loadedUser1.fields.f[0], 'v1');
			assert.strictEqual(loadedUser2.fields.f[0], 'v2');
		});
	});

	describe('set new username', async () => {
		it('should set a new username', async () => {
			await userLib.create('nisse', '', { firstname: 'korv', lastname: 'tolv' });

			const user = await userLib.fromUsername('nisse');
			assert(typeof user !== 'boolean', 'user should not be a boolean');
			await user.setUsername('olle');
			assert.strictEqual(user.username, 'olle');

			const loadedUser = await userLib.fromUsername('olle');
			assert(typeof loadedUser !== 'boolean', 'user should not be a boolean');
			assert.strictEqual(loadedUser.uuid, user.uuid);

			const loadedOldUser = await userLib.fromUsername('nisse');
			assert.strictEqual(loadedOldUser, false);
		});

		it('should throw error if no new username is specified', async () => {
			const user = await userLib.create('nisse', '');

			await assertThrows(async () => await user.setUsername(''));
		});

		it('should throw error if trying to set an existing username', async () => {
			await userLib.create('nisse', '');
			const user = await userLib.create('olle', '');

			await assertThrows(async () => await user.setUsername('nisse'));
		});
	});

	describe('remove user', async () => {
		it('should remove a user', async () => {
			const user = await userLib.create('nisse', '');
			const createdUuid = user.uuid;
			await user.rm();

			const loadedUser = await userLib.fromUsername('nisse');
			assert.strictEqual(loadedUser, false);
			const { rows } = await db.query('SELECT * FROM user_users WHERE uuid = ?', [
				lUtils.uuidToBuffer(createdUuid),
			]);
			assert.strictEqual(rows.length, 0);
		});
	});

	describe('Get list of users', async () => {
		it('Get list of users', async () => {
			await userLib.create('user1', '', { firstname: 'korv', lastname: 'tolv' });
			await userLib.create('user2', '', { firstname: 'fjös', lastname: 'lös' });

			const users = new Users({ log, db });
			const result = await users.get();
			assert.strictEqual(result.totalElements, 2);
			assert.strictEqual(result.users.length, 2);
			assert.strictEqual(result.users[0].username, 'user1');
			assert.strictEqual(result.users[1].username, 'user2');
		});

		it('Get list of users with matching field', async () => {
			await userLib.create('user1', '', { firstname: 'korv', lastname: 'tolv' });
			await userLib.create('user2', '', { firstname: 'fjös', lastname: 'lös', role: 'customer' });

			const users = new Users({ log, db, matchAllFields: { role: ['customer'] } });
			const result = await users.get();
			assert.strictEqual(result.totalElements, 1);
			assert.strictEqual(result.users[0].username, 'user2');
		});

		it('Get list of users with matching field, when it is a string ', async () => {
			await userLib.create('user1', '', { firstname: 'korv', lastname: 'tolv' });
			await userLib.create('user2', '', { firstname: 'fjös', lastname: 'lös', role: 'customer' });

			const users = new Users({ log, db, matchAllFields: { role: 'customer' } });
			const result = await users.get();
			assert.strictEqual(result.totalElements, 1);
			assert.strictEqual(result.users[0].username, 'user2');
		});

		it('Get list of users with matching field, when it is an array', async () => {
			await userLib.create('user1', '', { firstname: 'korv', lastname: 'tolv' });
			await userLib.create('user2', '', { firstname: 'fjös', lastname: 'lös', role: 'chef' });
			await userLib.create('user3', '', { firstname: 'brö', lastname: 'söl', role: 'gosse' });

			const users = new Users({ log, db, matchAllFields: { role: ['chef', 'gosse'] } });
			const result = await users.get();
			assert.strictEqual(result.totalElements, 2);
			assert.strictEqual(result.users[0].username, 'user2');
			assert.strictEqual(result.users[1].username, 'user3');
		});

		it('Get list of users with matching query field', async () => {
			await userLib.create('user1', '', { firstname: 'korv', lastname: 'tolv', code: 'so123kotte' });
			await userLib.create('user2', '', { firstname: 'fjös', lastname: 'lös', code: 'asdf123' });
			await userLib.create('user3', '', { firstname: 'brö', lastname: 'kurt', code: '123kotte' });

			const users = new Users({ log, db, matchAllFieldsQ: { code: ['kotte'] } });
			const result = await users.get();
			assert.strictEqual(result.totalElements, 2);
			assert.strictEqual(result.users[0].username, 'user1');
			assert.strictEqual(result.users[1].username, 'user3');
		});

		it('Get list of users with matching query fields', async () => {
			await userLib.create('user1', '', { firstname: 'korv', lastname: 'tolv', code: 'so123kotte' });
			await userLib.create('user2', '', { firstname: 'fjös', lastname: 'lös', code: 'asdf123' });
			await userLib.create('user3', '', { firstname: 'brö', lastname: 'kurt', code: '123kotte' });

			const result = await userLib.getUsers({ matchAllFieldsQ: { code: ['kotte'], firstname: 'brö' } });
			assert.strictEqual(result.totalElements, 1);
			assert.strictEqual(result.users[0].username, 'user3');
		});

		it('Get list of data values for field', async () => {
			await userLib.create('user1', '', { firstname: 'korv' });
			await userLib.create('user2', '', { firstname: 'fjös' });
			await userLib.create('user3', '', { firstname: 'brö' });
			await userLib.create('user4', '', { firstname: 'brö' });

			const users = new Users({ log, db, matchAllFieldsQ: { code: ['kotte'] } });
			const result = await users.getFieldData('firstname');
			assert.strictEqual(result.length, 3);
			assert.ok(result.includes('korv'));
			assert.ok(result.includes('fjös'));
			assert.ok(result.includes('brö'));
		});

		it('Get list of users with specific return fields', async () => {
			await userLib.create('user1', '', { firstname: 'korv', lastname: 'tolv', code: 'so123kotte' });
			await userLib.create('user2', '', { firstname: 'fjös', lastname: 'lös', code: 'asdf123' });
			await userLib.create('user3', '', { firstname: 'brö', lastname: 'kurt', code: '123kotte' });

			const result = await userLib.getUsers({ returnFields: ['lastname'] });
			for (const user of result.users) {
				assert.strictEqual(Object.keys(user.fields).length, 1);
			}
			assert.ok(result.users.find(u => u.fields.lastname[0] === 'tolv'));
			assert.ok(result.users.find(u => u.fields.lastname[0] === 'lös'));
			assert.ok(result.users.find(u => u.fields.lastname[0] === 'kurt'));
		});

		it('Get list of users where field data exists', async () => {

			await userLib.create('user1', '', { firstname: 'korv' });
			await userLib.create('user2', '', { firstname: 'fjös', lastname: 'lös' });
			await userLib.create('user3', '', { firstname: 'brö' });

			const result = await userLib.getUsers({ matchExistingFields: ['lastname'] });
			assert.strictEqual(result.users.length, 1);
			assert.strictEqual(result.users[0].username, 'user2');

		});

		it('Get list of users where field data does not exists', async () => {

			await userLib.create('user1', '', { firstname: 'korv', verified: 'yes' });
			await userLib.create('user2', '', { firstname: 'fjös', verified: 'no' });
			await userLib.create('user3', '', { firstname: 'brö' });

			const result = await userLib.getUsers({ matchFieldHasValue: ['verified'] });
			assert.strictEqual(result.users.length, 2);
			assert.strictEqual(result.users[0].username, 'user1');
			assert.strictEqual(result.users[1].username, 'user2');

			const result2 = await userLib.getUsers({ matchFieldHasNoValue: ['verified'] });

			assert.strictEqual(result2.users.length, 1);
			assert.strictEqual(result2.users[0].username, 'user3');

		});

		it('Get list of users sorted on username with ascending order', async () => {
			await userLib.create('user2', '', { firstname: 'korv' });
			await userLib.create('user3', '', { firstname: 'fjös', lastname: 'lös' });
			await userLib.create('user1', '', { firstname: 'brö' });

			const result = await userLib.getUsers({
				order: {
					by: 'username',
					direction: 'asc',
				},
			});
			assert.strictEqual(result.users.length, 3);
			assert.strictEqual(result.users[0].username, 'user1');
			assert.strictEqual(result.users[1].username, 'user2');
			assert.strictEqual(result.users[2].username, 'user3');
		});

		it('Get list of users sorted on username with descending order', async () => {
			await userLib.create('user2', '', { firstname: 'korv' });
			await userLib.create('user3', '', { firstname: 'fjös', lastname: 'lös' });
			await userLib.create('user1', '', { firstname: 'brö' });

			const result = await userLib.getUsers({
				order: {
					by: 'username',
					direction: 'desc',
				},
			});
			assert.strictEqual(result.users.length, 3);
			assert.strictEqual(result.users[0].username, 'user3');
			assert.strictEqual(result.users[1].username, 'user2');
			assert.strictEqual(result.users[2].username, 'user1');
		});

		it('Get list of users sorted on a data field', async () => {
			await userLib.create('user1', '', { firstname: 'korv' });
			await userLib.create('user2', '', { firstname: 'fjös' });
			await userLib.create('user3', '', { firstname: 'brö' });

			const resultAsc = await userLib.getUsers({
				order: {
					by: 'firstname',
					direction: 'asc',
				},
				returnFields: ['firstname'],
			});
			assert.strictEqual(resultAsc.users.length, 3);
			assert.strictEqual(resultAsc.users[0].fields.firstname[0], 'brö');
			assert.strictEqual(resultAsc.users[1].fields.firstname[0], 'fjös');
			assert.strictEqual(resultAsc.users[2].fields.firstname[0], 'korv');

			const resultDesc = await userLib.getUsers({
				order: {
					by: 'firstname',
					direction: 'desc',
				},
				returnFields: ['firstname'],
			});
			assert.strictEqual(resultDesc.users.length, 3);
			assert.strictEqual(resultDesc.users[0].fields.firstname[0], 'korv');
			assert.strictEqual(resultDesc.users[1].fields.firstname[0], 'fjös');
			assert.strictEqual(resultDesc.users[2].fields.firstname[0], 'brö');
		});

		it('Get list of users sorted on a data field fails if field is not in returnFields', async () => {
			await assertThrows(async () => await userLib.getUsers({
				order: {
					by: 'firstname',
					direction: 'asc',
				},
				returnFields: ['username'],
			}), 'The sorting column did not exist in the \'returnFields\' array');
		});

		it('Get list of users sorted on a data field with multiple values', async () => {
			await userLib.create('user1', '', { sortable: ['bbb', '111'] });
			await userLib.create('user2', '', { sortable: ['ccc', '222'] });
			await userLib.create('user3', '', { sortable: ['aaa', '333'] });

			const resultAsc = await userLib.getUsers({
				order: {
					by: 'sortable',
					direction: 'asc',
				},
				returnFields: ['sortable'],
			});
			assert.strictEqual(resultAsc.users.length, 3);
			assert.strictEqual(resultAsc.users[0].fields.sortable[0], 'aaa');
			assert.strictEqual(resultAsc.users[1].fields.sortable[0], 'bbb');
			assert.strictEqual(resultAsc.users[2].fields.sortable[0], 'ccc');

			const resultDesc = await userLib.getUsers({
				order: {
					by: 'sortable',
					direction: 'desc',
				},
				returnFields: ['sortable'],
			});
			assert.strictEqual(resultDesc.users.length, 3);
			assert.strictEqual(resultDesc.users[0].fields.sortable[0], 'ccc');
			assert.strictEqual(resultDesc.users[1].fields.sortable[0], 'bbb');
			assert.strictEqual(resultDesc.users[2].fields.sortable[0], 'aaa');
		});

		it('Get users by uuid, invalid uuids are skipped', async () => {
			await userLib.create('user1', '');
			const user2 = await userLib.create('user2', '');
			const user3 = await userLib.create('user3', '');

			const result = await userLib.getUsers({ uuids: [user2.uuid, user3.uuid, 'asdf'] });
			assert.strictEqual(result.users.length, 2);
			assert.strictEqual(result.users[0].username, 'user2');
			assert.strictEqual(result.users[1].username, 'user3');
		});

		it('Get users by uuid returns nothing if no valid uuids are provided', async () => {
			await userLib.create('user1', '');
			await userLib.create('user2', '');
			await userLib.create('user3', '');

			const result = await userLib.getUsers({ uuids: ['asdf'] });
			assert.strictEqual(result.users.length, 0);
		});

		it('should search by query on all available fields and username', async () => {
			await userLib.create('user1', '');
			await userLib.create('user2', '', { field1: 'Contains USER1 in value and caps' });
			await userLib.create('user3', '', { field1: 'value1', hasValue: 'user1' });
			await userLib.create('user4', '', { field1: 'user1 is the start of value' });
			await userLib.create('user5', '', { field1: 'part ofuser1word' });
			await userLib.create('username-contains-user1', '');
			await userLib.create('non-matching-user', '');

			const result = await userLib.getUsers({ q: 'user1' });
			assert.strictEqual(result.users.length, 6);
			assert.ok(result.users.find(u => u.username === 'user1'));
			assert.ok(result.users.find(u => u.username === 'user2'));
			assert.ok(result.users.find(u => u.username === 'user3'));
			assert.ok(result.users.find(u => u.username === 'user4'));
			assert.ok(result.users.find(u => u.username === 'user5'));
			assert.ok(result.users.find(u => u.username === 'username-contains-user1'));
		});

		it('get users by limit and offset', async () => {
			await userLib.create('user1', '');
			await userLib.create('user2', '');
			await userLib.create('user3', '');
			await userLib.create('user4', '');
			await userLib.create('user5', '');

			const result = await userLib.getUsers({ limit: '2', offset: '3' });
			assert.strictEqual(result.users.length, 2);
			assert.ok(result.users.find(u => u.username === 'user4'));
			assert.ok(result.users.find(u => u.username === 'user5'));
		});

		it('should get users based on create date', async () => {
			const user1 = await userLib.create('test1', '', { firstname: 'tolv', lastname: 'korvar' });
			await new Promise(resolve => setTimeout(resolve, 1000));
			const user2 = await userLib.create('test2', '', { firstname: 'tolv', lastname: 'korvarna' });
			const result1 = await userLib.getUsers({
				createdAfter: user1.created,
				returnFields: ['lastname'],
			});
			const result2 = await userLib.getUsers({
				createdAfter: user2.created,
				returnFields: ['lastname'],
			});

			assert.strictEqual(result1.totalElements, 2);
			assert.strictEqual(result2.totalElements, 1);

			assert.strictEqual(result1.users[0].fields.lastname[0], 'korvar');
			assert.strictEqual(result2.users[0].fields.lastname[0], 'korvarna');
		});

		it('should get users based on create and updated date', async () => {
			const user1 = await userLib.create('testUpdate1', '', { firstname: 'tolv', lastname: 'korvar' });
			const user2 = await userLib.create('testUpdate2', '', { firstname: 'tolv', lastname: 'ölkorvarna' });

			await new Promise(resolve => setTimeout(resolve, 1000));
			await user1.replaceFields({ lastname: ['korvarna', 'korvarnas'] });

			const updatedUser1 = await userLib.fromUuid(user1.uuid);

			assert(typeof updatedUser1 !== 'boolean', 'should not be a boolean');

			const result1 = await userLib.getUsers({
				updatedAfter: updatedUser1.updated,
				returnFields: ['lastname'],
			});
			const result2 = await userLib.getUsers({
				updatedAfter: user2.updated,
				returnFields: ['lastname'],
			});

			assert.strictEqual(result1.totalElements, 1);
			assert.strictEqual(result2.totalElements, 2);

			assert.strictEqual(result1.users[0].fields.lastname[0], 'korvarna');
			assert.strictEqual(result1.users[0].fields.lastname[1], 'korvarnas');

			assert.strictEqual(result2.users[0].fields.lastname[0], 'korvarna');
			assert.strictEqual(result2.users[0].fields.lastname[1], 'korvarnas');
			assert.strictEqual(result2.users[1].fields.lastname[0], 'ölkorvarna');
		});

		it('verify that we have a created date and updated date set correctly', async () => {
			const user = await userLib.create('testUser', '', { firstname: 'korv', lastname: 'tolv' });
			assert(typeof user !== 'boolean', 'testUser should not be a boolean');

			let loadedUser = await userLib.fromUsername('testUser');
			assert(typeof loadedUser !== 'boolean', 'user should not be a boolean');

			assert.ok(loadedUser.created);
			assert.strictEqual(String(loadedUser.created), String(loadedUser.updated));

			await new Promise(resolve => setTimeout(resolve, 1000));

			await loadedUser.replaceFields({ firstname: ['bert'] });

			loadedUser = await userLib.fromUsername('testUser');
			assert(typeof loadedUser !== 'boolean', 'user should not be a boolean');

			assert.strictEqual(String(loadedUser.created), String(user.created));
			assert.notStrictEqual(String(loadedUser.updated), String(user.updated));
			assert.strictEqual(loadedUser.fields.firstname[0], 'bert');
		});

		it('should get users based on dates', async () => {
			async function setCreatedAndUpdated(user: UserBase, created: Date, updated: Date): Promise<void> {
				await db.query('UPDATE user_users SET created = CAST(? AS DATETIME), updated = CAST(? AS DATETIME) WHERE uuid = ?', [
					created.toISOString().replace('T', ' ').substring(0, 19),
					updated.toISOString().replace('T', ' ').substring(0, 19),
					lUtils.uuidToBuffer(user.uuid),
				]);
			}

			const user1Dates = {
				created: new Date('2025-02-11 12:15:01'),
				updated: new Date('2025-02-12 12:15:01'),
				testDate: new Date('2025-02-11 12:15:01'),
			};
			const user2Dates = {
				created: new Date('2024-02-11 12:15:01'),
				updated: new Date('2024-02-12 12:15:01'),
				testDate: new Date('2024-02-11 12:15:01'),
			};

			const user1 = await userLib.create('testUpdate1', '', { firstname: 'tolv', lastname: 'korvar', testDate: user1Dates.testDate.toISOString() });
			const user2 = await userLib.create('testUpdate2', '', { firstname: 'tolv', lastname: 'ölkorvarna', testDate: user2Dates.testDate.toISOString() });

			// Update users created and updated dates..
			await setCreatedAndUpdated(user1, user1Dates.created, user1Dates.updated);
			await setCreatedAndUpdated(user2, user2Dates.created, user2Dates.updated);

			const updated1_eq = new Date(user1Dates.updated.getTime());
			const updated1_gt = new Date(user1Dates.updated.getTime());
			updated1_gt.setSeconds(updated1_gt.getSeconds() - 10);
			const updated1_lt = new Date(user1Dates.updated.getTime());
			updated1_lt.setSeconds(updated1_lt.getSeconds() + 10);

			const testDate1_eq = new Date(user1Dates.testDate.getTime());
			const testDate1_gt = new Date(user1Dates.testDate.getTime());
			testDate1_gt.setSeconds(testDate1_gt.getSeconds() - 10);
			const testDate1_lt = new Date(user1Dates.testDate.getTime());
			testDate1_lt.setSeconds(testDate1_lt.getSeconds() + 10);

			const result1_1 = await userLib.getUsers({
				matchDates: [
					{
						field: 'updated',
						value: updated1_eq.toISOString(),
						operation: 'eq',
					},
				],
				returnFields: ['firstname', 'lastname', 'testDate'],
			});

			const result1_2 = await userLib.getUsers({
				matchDates: [
					{
						field: 'updated',
						value: updated1_gt.toISOString(),
						operation: 'gt',
					},
					{
						field: 'updated',
						value: updated1_lt.toISOString(),
						operation: 'lt',
					},
				],
				returnFields: ['firstname', 'lastname', 'testDate'],
			});

			const result1_3 = await userLib.getUsers({
				matchDates: [
					{
						field: 'updated',
						value: updated1_eq.toISOString(),
						operation: 'eq',
					},
					{
						field: 'updated',
						value: updated1_gt.toISOString(),
						operation: 'gt',
					},
					{
						field: 'updated',
						value: updated1_lt.toISOString(),
						operation: 'lt',
					},
				],
				returnFields: ['firstname', 'lastname', 'testDate'],
			});

			const result1_4 = await userLib.getUsers({
				matchDates: [
					{
						field: 'updated',
						value: updated1_gt.toISOString(),
						operation: 'eq',
					},
				],
				returnFields: ['firstname', 'lastname', 'testDate'],
			});

			const result1_5 = await userLib.getUsers({
				matchDateFields: [
					{
						field: 'testDate',
						value: testDate1_eq.toISOString(),
						operation: 'eq',
					},
				],
				returnFields: ['firstname', 'lastname', 'testDate'],
			});

			const result1_6 = await userLib.getUsers({
				matchDateFields: [
					{
						field: 'testDate',
						value: testDate1_gt.toISOString(),
						operation: 'gt',
					},
					{
						field: 'testDate',
						value: testDate1_lt.toISOString(),
						operation: 'lt',
					},
				],
				returnFields: ['firstname', 'lastname', 'testDate'],
			});

			const result1_7 = await userLib.getUsers({
				matchDateFields: [
					{
						field: 'testDate',
						value: testDate1_eq.toISOString(),
						operation: 'eq',
					},
					{
						field: 'testDate',
						value: testDate1_gt.toISOString(),
						operation: 'gt',
					},
					{
						field: 'testDate',
						value: testDate1_lt.toISOString(),
						operation: 'lt',
					},
				],
				returnFields: ['firstname', 'lastname', 'testDate'],
			});

			const result1_8 = await userLib.getUsers({
				matchDateFields: [
					{
						field: 'testDate',
						value: testDate1_gt.toISOString(),
						operation: 'eq',
					},
				],
				returnFields: ['firstname', 'lastname', 'testDate'],
			});

			const updated2_eq = new Date(user2Dates.updated.getTime());
			const updated2_gt = new Date(user2Dates.updated.getTime());
			updated2_gt.setSeconds(updated2_gt.getSeconds() - 10);
			const updated2_lt = new Date(user2Dates.updated.getTime());
			updated2_lt.setSeconds(updated2_lt.getSeconds() + 10);

			const result2_1 = await userLib.getUsers({
				matchDates: [
					{
						field: 'updated',
						value: updated2_eq.toISOString(),
						operation: 'eq',
					},
				],
				returnFields: ['firstname', 'lastname', 'testDate'],
			});

			const result2_2 = await userLib.getUsers({
				matchDates: [
					{
						field: 'updated',
						value: updated2_gt.toISOString(),
						operation: 'gt',
					},
					{
						field: 'updated',
						value: updated2_lt.toISOString(),
						operation: 'lt',
					},
				],
				returnFields: ['firstname', 'lastname', 'testDate'],
			});

			const result2_3 = await userLib.getUsers({
				matchDates: [
					{
						field: 'updated',
						value: updated2_gt.toISOString(),
						operation: 'gt',
					},
				],
				returnFields: ['firstname', 'lastname', 'testDate'],
				order: {
					by: 'updated',
					direction: 'desc',
				},
			});

			assert.strictEqual(result1_1.totalElements, 1);
			assert.strictEqual(result1_2.totalElements, 1);
			assert.strictEqual(result1_3.totalElements, 1);
			assert.strictEqual(result1_4.totalElements, 0);
			assert.strictEqual(result1_5.totalElements, 1);
			assert.strictEqual(result1_6.totalElements, 1);
			assert.strictEqual(result1_7.totalElements, 1);
			assert.strictEqual(result1_8.totalElements, 0);

			assert.strictEqual(result1_1.users[0].fields.lastname[0], 'korvar');
			assert.strictEqual(result1_2.users[0].fields.lastname[0], 'korvar');
			assert.strictEqual(result1_3.users[0].fields.lastname[0], 'korvar');
			assert.strictEqual(result1_4.users.length, 0);
			assert.strictEqual(result1_5.users[0].fields.lastname[0], 'korvar');
			assert.strictEqual(result1_6.users[0].fields.lastname[0], 'korvar');
			assert.strictEqual(result1_7.users[0].fields.lastname[0], 'korvar');
			assert.strictEqual(result1_8.users.length, 0);

			assert.strictEqual(result2_1.totalElements, 1);
			assert.strictEqual(result2_2.totalElements, 1);
			assert.strictEqual(result2_3.totalElements, 2);

			assert.strictEqual(result2_1.users[0].fields.lastname[0], 'ölkorvarna');
			assert.strictEqual(result2_2.users[0].fields.lastname[0], 'ölkorvarna');
			assert.strictEqual(result2_3.users[0].fields.lastname[0], 'korvar');
			assert.strictEqual(result2_3.users[1].fields.lastname[0], 'ölkorvarna');
		});

		it('should get user based in notEqualFields', async () => {
			await userLib.create('user1', '', { firstname: 'korv' });
			await userLib.create('user2', '', { firstname: 'fjös' });
			await userLib.create('user3', '', { firstname: 'brö' });

			const result1 = await userLib.getUsers({ notEqualFields: [{ field: 'firstname', value: 'fjös' }, { field: 'firstname', value: 'brö' }] });
			assert.strictEqual(result1.totalElements, 1);
			assert.ok(result1.users.find(u => u.username === 'user1'));

			const result2 = await userLib.getUsers({ notEqualFields: [{ field: 'firstname', value: 'korv' }, { field: 'firstname', value: 'körv' }] });
			assert.strictEqual(result2.totalElements, 2);
			assert.ok(result2.users.find(u => u.username === 'user2'));
			assert.ok(result2.users.find(u => u.username === 'user3'));
		});
	});

	describe('inactive users', async () => {
		it('create a new user', async () => {
			const user = await userLib.create('testInactiveUser', '');

			assert.strictEqual(user.inactive, undefined);
		});

		it('inactivate the user', async () => {
			const user = await userLib.create('testInactiveUser', '');

			assert(typeof user !== 'boolean', 'testInactiveUser should not be a boolean');
			assert.strictEqual(user.inactive, undefined);
			await user.setInactive(true);
			assert.strictEqual(user.inactive, true);
		});

		it('inactivate and activate the user', async () => {
			const user = await userLib.create('testInactiveUser', '');

			assert(typeof user !== 'boolean', 'testInactiveUser should not be a boolean');
			assert.strictEqual(user.inactive, undefined);
			await user.setInactive(true);
			assert.strictEqual(user.inactive, true);
			await user.setInactive(false);
			assert.strictEqual(user.inactive, false);
		});

		it('inactive users should be found using fromUuid if "includeInactive" is provided', async () => {
			const user = await userLib.create('testInactiveUser', '');

			assert(typeof user !== 'boolean', 'testInactiveUser should not be a boolean');
			await user.setInactive(true);
			assert.strictEqual(user.inactive, true);

			const isAvailable = await userLib.fromUuid(user.uuid);
			assert.strictEqual(isAvailable, false);

			const isAvailable2 = await userLib.fromUuid(user.uuid, true);
			assert(typeof isAvailable2 !== 'boolean', 'should not be a boolean');
			assert.strictEqual(isAvailable2.username, 'testInactiveUser');
		});

		it('inactive users should not be listed using get unless options showInactiveOnly and showInactive are used', async () => {
			const testInactiveUser = await userLib.create('testInactiveUser', '');
			const testActiveUser = await userLib.create('testActiveUser', '');

			assert(typeof testInactiveUser !== 'boolean', 'testInactiveUser should not be a boolean');
			assert(typeof testActiveUser !== 'boolean', 'testActiveUser should not be a boolean');
			assert.strictEqual(testInactiveUser.inactive, undefined);
			assert.strictEqual(testActiveUser.inactive, undefined);
			await testInactiveUser.setInactive(true);
			assert.strictEqual(testInactiveUser.inactive, true);

			let users = new Users({ log, db });
			let result = await users.get();
			assert.strictEqual(result.totalElements, 1);
			assert.strictEqual(result.users.length, 1);
			assert.strictEqual(result.users[0].username, 'testActiveUser');

			users = new Users({ log, db, showInactiveOnly: true });
			result = await users.get();
			assert.strictEqual(result.totalElements, 1);
			assert.strictEqual(result.users.length, 1);
			assert.strictEqual(result.users[0].username, 'testInactiveUser');

			users = new Users({ log, db, showInactive: true });
			result = await users.get();
			assert.strictEqual(result.totalElements, 2);
			assert.strictEqual(result.users.length, 2);
			assert.ok(result.users.some(u => u.username === 'testInactiveUser'));
			assert.ok(result.users.some(u => u.username === 'testActiveUser'));

			await testInactiveUser.setInactive(false);

			result = await users.get();
			assert.strictEqual(result.totalElements, 2);
			assert.strictEqual(result.users.length, 2);
			assert.ok(result.users.some(u => u.username === 'testInactiveUser'));
			assert.ok(result.users.some(u => u.username === 'testActiveUser'));
		});

		it('Verify that inactive users are not found using fromUsername, fromUserAndPass and fromFields', async () => {
			const user = await userLib.create('testInactiveUser', '', { firstname: 'tolv', lastname: 'korvar' });

			assert(typeof user !== 'boolean', 'testInactiveUser should not be a boolean');
			assert.strictEqual(user.inactive, undefined);
			await user.setInactive(true);
			assert.strictEqual(user.inactive, true);

			const fromUsername = await userLib.fromUsername('testInactiveUser');
			const fromUserAndPass = await userLib.fromUserAndPass('testInactiveUser', '');
			const fromFields = await userLib.fromFields({ firstname: 'tolv', lastname: 'korvar' });
			assert.strictEqual(fromUsername, false);
			assert.strictEqual(fromUserAndPass, false);
			assert.strictEqual(fromFields, false);
		});
	});
});

describe('Helpers', async () => {
	describe('valueOrThrow', async () => {
		it('should throw if value is false, null or undefined', async () => {
			await assertThrows(async () => await userLib.helpers.valueOrThrow(false, 'prefix', 'msg'), 'msg');
			await assertThrows(async () => await userLib.helpers.valueOrThrow(null, 'prefix', 'msg'), 'msg');
			await assertThrows(async () => await userLib.helpers.valueOrThrow(undefined, 'prefix', 'msg'), 'msg');
		});

		it('should return value for 0', async () => {
			assert.strictEqual(userLib.helpers.valueOrThrow(0, 'prefix', 'msg'), 0);
		});

		it('should return value for empty string', async () => {
			assert.strictEqual(userLib.helpers.valueOrThrow('', 'prefix', 'msg'), '');
		});
	});

	describe('getFieldName', async () => {
		it('should throw error on invalid uuid', async () => {
			await assertThrows(async () => await userLib.helpers.getFieldName('asdf'));
		});

		it('should return false if field cannot be found', async () => {
			assert.strictEqual(await userLib.helpers.getFieldName(v4()), false);
		});
	});
});

describe('DataWriter', async () => {
	it('should throw if db is not provided', async () => {
		assertThrows(() => new DataWriter({} as any));
	});
});

after(async () => {
	await db.removeAllTables();
});
