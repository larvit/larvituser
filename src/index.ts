import { DataWriter } from './dataWriter';
import { Helpers } from './helpers';
import { Log, LogInstance, Utils } from 'larvitutils';
import { UserBase, UserBaseOptions } from './userBase';
import { Users, UsersOptions } from './users';
import * as uuidLib from 'uuid';
import bcrypt from 'bcryptjs';

const topLogPrefix = 'larvituser: index.ts:';

export { Users } from './users';
export { UserBase } from './userBase';

export type UserLibOptions = {
	db: any,
	log?: LogInstance,
}

export class UserLib {
	public helpers: Helpers;

	private dataWriter: DataWriter;
	private log: LogInstance;
	private lUtils: Utils;
	private options: Omit<UserLibOptions, 'log'>;

	constructor(options: UserLibOptions) {
		if (!options.db) throw new Error('Required option db is missing');

		this.log = options.log ?? new Log();
		this.options = options;
		this.lUtils = new Utils({ log: this.log });
		this.dataWriter = new DataWriter({
			log: this.log,
			db: options.db,
		});
		this.helpers = new Helpers({
			dataWriter: this.dataWriter,
			log: this.log,
			db: options.db,
		});
	}

	async runDbMigrations(scriptPath?: string): Promise<void> {
		await this.dataWriter.runDbMigrations(scriptPath);
	}

	/**
	 * Add a single user field to database
	 *
	 * @param {string} userUuid -
	 * @param {string} fieldName -
	 * @param {string} fieldValue -
	 * @returns {Promise<void>} -
	 */
	async addUserDataField(userUuid: string, fieldName: string, fieldValue: string | string[])
		: Promise<void> {
		const fields: Record<string, string | string[]> = {
			[fieldName]: fieldValue,
		};

		await this.addUserDataFields(userUuid, fields);
	}

	/**
	 * Add user fields
	 *
	 * @param {string} userUuid -
	 * @param {object} fields - field name as key, field values as array to that key - ex: {'role': ['admin','user']}
	 * @returns {Promise<void>} -
	 */
	async addUserDataFields(userUuid: string, fields: Record<string, string | string[]>)
		: Promise<void> {
		await this.dataWriter.addUserDataFields(userUuid, fields);
	}

	/**
	 * Checks a password for validity
	 * @param {string} password - plain text password
	 * @param {string} hash - hash to check password against
	 * @param {Promise<boolean>} - True if password matches
	 */
	async checkPassword(password: string, hash: string): Promise<boolean> {
		password = password.trim();

		return await bcrypt.compare(password, hash);
	}

	/**
	 * Creates a new user (and adds to it to db)
	 *
	 * @param {string} username -
	 * @param {string} password (plain text) or false for no password (user will not be able to login at all)
	 * @param {object} userFields - key, value pairs, where value can be an array of values
	 * @param {string} uuid - if not supplied a random will be generated
	 * @returns {Promise<UserBase>} - The newly created user
	 */
	async create(username: string, password: string | boolean, userFields?: Record<string, string | string[]>, uuid?: string)
		: Promise<UserBase> {
		const logPrefix = `${topLogPrefix} create() -`;

		userFields ??= {};
		uuid ??= uuidLib.v1();
		username = username.trim();

		if (!username.length) {
			const err = new Error('Trying to create user with empty username');
			this.log.warn(`${logPrefix} ${err.message}`);
			throw err;
		}

		// Check for username availability
		const isAvailable = await this.usernameAvailable(username);
		if (isAvailable) {
			this.log.debug(`${logPrefix} Username available: "${username}"`);
		} else {
			const err = new Error('Trying to create user with taken username: "' + username + '"');
			this.log.info(`${logPrefix} ${err.message}`);
			throw err;
		}

		// Hash Password
		let hashedPassword = '';
		if (typeof password === 'boolean' || !password) {
			this.log.debug(`${logPrefix} Password set to empty string/false for no-login, username: "${username}"`);
			hashedPassword = '';
		} else {
			hashedPassword = await this.hashPassword(password.trim());
			this.log.debug(`${logPrefix} Password hashed, username: "${username}"`);
		}

		// Create all fields
		// TODO: Parallel?
		for (const fieldName of Object.keys(userFields)) {
			await this.helpers.getFieldUuid(fieldName);
		}

		// Write new user
		await this.dataWriter.create({
			uuid,
			username,
			password: hashedPassword,
			fields: userFields,
		});

		// Get new user
		const user = await this.fromUuid(uuid);

		// Non-tivial to test
		/* istanbul ignore if */
		if (typeof user === 'boolean') {
			const err = new Error(`Failed to get newly created user, uuid: ${uuid}`);
			this.log.warn(`${logPrefix} ${err.message}`);
			throw err;
		}

		return user;
	}

	/**
	 * Checks if a unsername is available
	 *
	 * @param {string} username -
	 * @returns {Promise<boolean>} -
	 */
	async usernameAvailable(username: string): Promise<boolean> {
		username = username.trim();

		const { rows } = await this.options.db.query('SELECT uuid FROM user_users WHERE username = ?', [username]);

		return rows.length === 0;
	}

	/**
	 * Create a user object from a field
	 * IMPORTANT! Only fetches first matching user!
	 *
	 * @param {string} fieldName -
	 * @param {string} fieldValue -
	 * @returns {Promise<UserBase | boolean>} - "user" being a new user object or boolean false on failed search
	 */
	async fromField(fieldName: string, fieldValue: string): Promise<UserBase | boolean> {
		const user = await this.fromFields({ [fieldName]: fieldValue });

		return user;
	}

	/**
	 * Create a user object from fields
	 * IMPORTANT! Only fetches first matching user that matches all fields!
	 *
	 * @param {object} fields - {'fieldName': 'fieldValue', 'fieldName2': 'fieldValue2'}
	 * @returns {Promise<UserBase | false>} - "user" being a new user object or boolean false on failed search
	 */
	async fromFields(fields: Record<string, string>): Promise<UserBase | boolean> {
		const dbFields = [];
		let sql = 'SELECT uuid FROM user_users u\nWHERE\n 1 + 1\n';

		for (const fieldName of Object.keys(fields)) {
			sql += ' AND uuid IN (SELECT userUuid FROM user_users_data WHERE data = ? AND fieldUuid = (SELECT uuid FROM user_data_fields WHERE name = ?))\n';
			dbFields.push(fields[fieldName].trim());
			dbFields.push(fieldName.trim());
		}

		sql += ' AND (inactive IS NULL OR inactive = 0)\n';
		sql += 'LIMIT 1';

		const { rows } = await this.options.db.query(sql, dbFields);
		if (rows.length === 0) return false;

		const userUuid = this.lUtils.formatUuid(rows[0].uuid);
		if (typeof userUuid === 'boolean') return false;

		const user = await this.fromUuid(userUuid);

		return user;
	}

	/**
	 * Create a user object from username and password
	 *
	 * @param {string} username -
	 * @param {string} password -
	 * @returns {Promise<UserBase | boolean>} - "user" being a new user object or boolean false on failed login
	 */
	async fromUserAndPass(username: string, password: string): Promise<UserBase | boolean> {
		if (typeof username !== 'string') throw new Error('Username must be a string');
		if (typeof password !== 'string') throw new Error('Password must be a string');

		username = username.trim();
		if (password) password = password.trim();

		const dbFields = [username];
		const sql = 'SELECT uuid, password FROM user_users WHERE username = ? AND (inactive IS NULL OR inactive = 0)';
		const { rows } = await this.options.db.query(sql, dbFields);
		if (!rows.length) return false;

		const hashedPassword = rows[0].password;
		const userUuidBuffer = rows[0].uuid;

		if (!hashedPassword) return false;

		const isCorrectPassword = await this.checkPassword(password, hashedPassword);
		if (!isCorrectPassword) return false;

		const userUuid = this.lUtils.formatUuid(userUuidBuffer);
		if (typeof userUuid === 'boolean') return false;
		const user = await this.fromUuid(userUuid);

		return user;
	}

	/**
	 * Create a user object from username
	 *
	 * @param {string} username -
	 * @returns {Promise<UserBase | boolean>} - "user" being a new user object
	 */
	async fromUsername(username: string): Promise<UserBase | boolean> {
		const logPrefix = `${topLogPrefix}fromUsername() -`;
		const dbFields = [];
		const sql = 'SELECT uuid FROM user_users WHERE username = ? AND (inactive IS NULL OR inactive = 0)';

		username = username.trim();
		dbFields.push(username);

		const { rows } = await this.options.db.query(sql, dbFields);
		if (!rows.length) {
			this.log.debug(`${logPrefix}No user found for username: "${username}"`);

			return false;
		}

		const userUuid = this.lUtils.formatUuid(rows[0].uuid);
		if (typeof userUuid === 'boolean') return false;
		const user = await this.fromUuid(userUuid);

		return user;
	}

	/**
	 * Instanciate user object from user id
	 *
	 * @param {number} userUuid -
	 * @param {boolean} includeInactive - If true, will also load inactive users
	 * @returns {Promise<UserBase>} userObj will be false if no user is found
	 */
	async fromUuid(userUuid: string, includeInactive: boolean = false): Promise<UserBase | false> {
		const { helpers, lUtils } = this;
		const { db } = this.options;
		const { log } = this;
		const logPrefix = `${topLogPrefix} fromUuid() -`;
		let sql = 'SELECT\n' +
				' u.uuid,\n' +
				' u.username,\n' +
				' u.inactive,\n' +
				' u.password,\n' +
				' uf.uuid AS fieldUuid,\n' +
				' uf.name AS fieldName,\n' +
				' ud.data AS fieldData\n' +
				'FROM\n' +
				' user_users u\n' +
				'  LEFT JOIN user_users_data ud ON ud.userUuid = u.uuid\n' +
				'  LEFT JOIN user_data_fields uf ON uf.uuid = ud.fieldUuid\n' +
				'WHERE u.uuid = ?';

		if (!includeInactive) {
			sql += '\nAND (inactive IS NULL OR inactive = 0)';
		}

		const userUuidBuf = helpers.valueOrThrow(lUtils.uuidToBuffer(userUuid), logPrefix, 'Invalid userUuid');

		const dbFields = [userUuidBuf];

		const { rows } = await db.query(sql, dbFields);
		if (rows.length === 0) {
			const err = new Error(`No user found for userUuid: "${userUuid}"`);
			log.debug(logPrefix + err.message);

			return false;
		}

		const fields: Record<string, string[]> = {};
		for (const row of rows) {
			if (row.fieldUuid) {
				fields[row.fieldName] ??= [];
				fields[row.fieldName].push(row.fieldData);
			}
		}

		const userBaseOptions: UserBaseOptions = {
			userInstance: this,
			log,
			uuid: userUuid,
			username: rows[0].username,
			inactive: !!rows[0].inactive,
			passwordIsFalse: !rows[0].password,
			fields,
		};

		return new UserBase(userBaseOptions);
	}

	/**
	 * Get field data for a user
	 *
	 * @param {string} userUuid -
	 * @param {string} fieldName -
	 * @returns {Promise<string[]>} data is always an array of data (or empty array)
	 */
	async getFieldData(userUuid: string, fieldName: string): Promise<string[]> {
		const { helpers, lUtils } = this;
		const logPrefix = `${topLogPrefix} getFieldData() -`;

		const userUuidBuffer = helpers.valueOrThrow(lUtils.uuidToBuffer(userUuid), logPrefix, 'Invalid user uuid');
		const fieldUuid = await helpers.getFieldUuid(fieldName);
		const fieldUuidBuffer = helpers.valueOrThrow(lUtils.uuidToBuffer(fieldUuid as string), logPrefix, 'Invalid field uuid');

		const dbFields = [userUuidBuffer, fieldUuidBuffer];
		const sql = 'SELECT data FROM user_users_data WHERE userUuid = ? AND fieldUuid = ?';

		const { rows } = await this.options.db.query(sql, dbFields);
		const data = [];
		for (const row of rows) {
			data.push(row.data);
		}

		return data;
	}

	/**
	 * Hashes a new password
	 *
	 * @param {string} password -
	 * @returns {Promise<string>} Hashed password
	 */
	async hashPassword(password: string): Promise<string> {
		password = password?.trim() ?? '';

		const hash = await bcrypt.hash(password, 10);

		return hash;
	}

	/**
	 * Replace all fields
	 * IMPORTANT!!! Will clear all data not given in the fields parameter
	 *
	 * @param {string} userUuid -
	 * @param {object} fields - field name as key, field values as array to that key - ex: {'role': ['admin','user']}
	 * @returns {Promise<void>} -
	 */
	async replaceUserFields(userUuid: string, fields: Record<string, string | string[]>): Promise<void> {
		await this.dataWriter.replaceFields(userUuid, fields);
	}

	/**
	 * Remove a user
	 *
	 * @param {string} userUuid -
	 * @returns {Promise<void>} -
	 */
	async rmUser(userUuid: string): Promise<void> {
		await this.dataWriter.rmUser(userUuid);
	}

	/**
	 * Remove a user field
	 *
	 * @param {string} userUuid -
	 * @param {string} fieldName -
	 * @returns {Promise<void>} -
	 */
	async rmUserField(userUuid: string, fieldName: string): Promise<void> {
		await this.dataWriter.rmUserField(userUuid, fieldName);
	}

	/**
	 * Set password for a user
	 *
	 * @param {string} userUuid -
	 * @param {string} newPassword (plain text) or false for no valid password (user will not be able to login at all)
	 * @returns {Promise<void>} -
	 */
	async setPassword(userUuid: string, newPassword: string | boolean): Promise<void> {
		const hashedPassword = typeof newPassword === 'string'
			? await this.hashPassword(newPassword.trim())
			: '';

		await this.dataWriter.setPassword(userUuid, hashedPassword);
	}

	/**
	 * Set the username for a user
	 *
	 * @param {string} userUuid -
	 * @param {string} newUsername -
	 * @returns {Promise<void>} -
	 */
	async setUsername(userUuid: string, newUsername: string): Promise<void> {
		const { helpers, lUtils } = this;
		const logPrefix = `${topLogPrefix} setUsername() -`;

		newUsername = newUsername.trim();
		if (!newUsername) {
			const err = new Error('No new username supplied');
			this.log.warn(logPrefix + err.message);
			throw err;
		}

		const userUuidBuf = helpers.valueOrThrow(lUtils.uuidToBuffer(userUuid), logPrefix, 'Invalid user uuid');

		const { rows } = await this.options.db.query('SELECT uuid FROM user_users WHERE username = ? AND uuid != ?', [newUsername, userUuidBuf]);
		if (rows.length && lUtils.formatUuid(rows[0].uuid) !== userUuid) {
			const err = new Error('Username is already taken');
			throw err;
		}

		await this.dataWriter.setUsername(userUuid, newUsername);
	}

	/**
	 * Set inactive for a user
	 *
	 * @param {string} userUuid -
	 * @param {string} newInactive -
	 * @returns {Promise<void>} -
	 */
	async setInactive(userUuid: string, newInactive: boolean): Promise<void> {
		const logPrefix = `${topLogPrefix} setInactive() -`;

		if (newInactive === undefined) {
			const err = new Error('No new inactive value supplied');
			this.log.warn(logPrefix + err.message);
			throw err;
		}

		await this.dataWriter.setInactive(userUuid, newInactive);
	}

	async getUsers(options: Omit<UsersOptions, 'log' | 'db'> = {}): ReturnType<Users['get']> {
		const users = new Users({
			db: this.options.db,
			log: this.log,
			...options,
		});

		return await users.get();
	}
}
