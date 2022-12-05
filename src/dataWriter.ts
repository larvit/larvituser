import { Log, LogInstance, Utils } from 'larvitutils';
import { Helpers, arrayify } from './helpers';

import { DbMigration } from 'larvitdbmigration';
import * as uuidLib from 'uuid';

const topLogPrefix = 'larvituser: dataWriter.ts -';

export type DataWriterOptions = {
	log?: LogInstance,
	db: any,
};

export class DataWriter {
	private lUtils: Utils;
	private helpers: Helpers;
	private log: LogInstance;
	private db: any;

	constructor(options: DataWriterOptions) {
		if (!options.db) throw new Error('Required option "db" not set');

		this.db = options.db;
		this.log = options.log ?? new Log();
		this.lUtils = new Utils({ log: this.log });
		this.helpers = new Helpers({
			dataWriter: this,
			log: this.log,
			db: this.db,
		});
	}

	async runDbMigrations(scriptPath?: string): Promise<void> {
		// Change tablename from larvituser_db_version to users_db_version
		// In case larvituser_db_version exists, that is.
		// This is due to a breaking change in 0.17.0 and this was added as
		// a patch in 0.17.1 to make applications not crash
		const { rows } = await this.db.query('SHOW TABLES LIKE \'larvituser_db_version\'');
		/* istanbul ignore if */ // Nasty to test
		if (rows.length) {
			await this.db.query('RENAME TABLE larvituser_db_version TO users_db_version');
		}

		const dbMigration = new DbMigration({
			dbType: 'mariadb',
			dbDriver: this.db,
			tableName: 'users_db_version',
			migrationScriptPath: scriptPath ?? `${__dirname}/../dbmigration`,
			log: this.log,
		});

		await dbMigration.run();
	}

	async addUserDataFields(userUuid: string, fields: Record<string, string | string[]>)
		: Promise<void> {
		const { helpers, lUtils } = this;
		const logPrefix = `${topLogPrefix} addUserDataFields() -`;

		let sql = 'INSERT INTO user_users_data (userUuid, fieldUuid, data) VALUES';

		if (!Object.keys(fields).length) {
			this.log.verbose(`${logPrefix} No fields specifed`);

			return;
		}

		const userUuidBuffer = helpers.valueOrThrow(lUtils.uuidToBuffer(userUuid), logPrefix, 'Invalid userUuid');
		const dbValues: Array<string | Buffer> = [];
		for (const key in fields) {
			const fieldUuid = helpers.valueOrThrow(await helpers.getFieldUuid(key), logPrefix, `Failed to get field uuid for: ${key}`);
			const fieldUuidBuffer = helpers.valueOrThrow(lUtils.uuidToBuffer(fieldUuid), logPrefix, 'Invalid fieldUuid');
			const values = arrayify(fields[key] ?? '');
			for (const value of values) {
				sql += '(?,?,?),';
				dbValues.push(userUuidBuffer, fieldUuidBuffer, value);
			}
		}

		sql = sql.substring(0, sql.length - 1) + ';';

		if (dbValues.length) {
			await this.db.query(sql, dbValues);
		}
	}

	async addUserField(name: string): Promise<void> {
		const { lUtils, helpers } = this;
		const logPrefix = `${topLogPrefix} addUserField() -`;
		const sql = 'INSERT IGNORE INTO user_data_fields (uuid, name) VALUES(?,?)';

		// Check if this is already set in the database
		const { rows } = await this.db.query('SELECT uuid FROM user_data_fields WHERE name = ?', [name]);
		const uuid = rows.length ? lUtils.formatUuid(rows[0].uuid) : uuidLib.v1();

		const uuidBuffer = helpers.valueOrThrow(lUtils.uuidToBuffer(uuid as string), logPrefix, 'Invalid field uuid');

		await this.db.query(sql, [uuidBuffer, name]);
	}

	async create(user: {
		uuid: string, username: string, password: string, fields: Record<string, string | string[]>
	}): Promise<void> {
		const { helpers, lUtils } = this;
		const logPrefix = `${topLogPrefix} create() -`;
		const dbFields = [];
		const sql = 'INSERT IGNORE INTO user_users (uuid, username, password) VALUES(?,?,?);';

		const uuidBuffer = helpers.valueOrThrow(lUtils.uuidToBuffer(user.uuid), logPrefix, `Invalid user uuid supplied: "${user.uuid}`);

		dbFields.push(uuidBuffer);
		dbFields.push(user.username);
		dbFields.push(user.password);

		const results = await this.db.query(sql, dbFields);

		if (results.rows.affectedRows === 0) {
			const err = new Error('No user created, duplicate key on uuid: "' + user.uuid + '" or username: "' + user.username + '"');
			this.log.warn(`${logPrefix} ${err.message}`);
			throw err;
		}

		await this.addUserDataFields(user.uuid, user.fields);
	}

	async replaceFields(userUuid: string, fields: Record<string, string | string[]> | null)
		: Promise<void> {
		const { helpers, lUtils } = this;
		const logPrefix = `${topLogPrefix} replaceFields() -`;

		const userUuidBuf = helpers.valueOrThrow(lUtils.uuidToBuffer(userUuid), logPrefix, `Invalid user uuid supplied: "${userUuid}`);
		const dbConn = await this.db.getConnection();

		async function commitAndRelease(dbConn: any): Promise<void> {
			await dbConn.commit();
			await dbConn.release();
		}

		// Check so the user uuid is valid
		const { rows } = await dbConn.query('SELECT * FROM user_users WHERE uuid = ?', userUuidBuf);
		if (!rows.length) {
			const err = new Error(`Invalid user uuid: "${userUuid}", no records found in database of this user`);
			this.log.warn(`${logPrefix} ${err.message}`);
			await dbConn.release();
			throw err;
		}

		// Begin transaction
		await dbConn.beginTransaction();

		try {
			// Clean out previous data
			await dbConn.query('DELETE FROM user_users_data WHERE userUuid = ?', [userUuidBuf]);

			// Get field uuids
			if (!fields) {
				await commitAndRelease(dbConn);

				return;
			}

			const fieldNamesToUuidBufs: Record<string, Buffer> = {};
			for (const fieldName of Object.keys(fields)) {
				const fieldUuid = helpers.valueOrThrow(await helpers.getFieldUuid(fieldName, dbConn), logPrefix, `Invalid field uuid for field: ${fieldName}`);
				const asBuffer = helpers.valueOrThrow(lUtils.uuidToBuffer(fieldUuid), logPrefix, `Failed to convert field uuid to buffer, uuid: ${fieldUuid}`);

				fieldNamesToUuidBufs[fieldName] = asBuffer;
			}

			// Add new data
			const dbFields = [];
			let sql = 'INSERT INTO user_users_data (userUuid, fieldUuid, data) VALUES';

			for (const fieldName of Object.keys(fields)) {
				const fieldValues = arrayify(fields[fieldName] ?? '');

				for (const fieldValue of fieldValues) {
					sql += '(?,?,?),';
					dbFields.push(userUuidBuf);
					dbFields.push(fieldNamesToUuidBufs[fieldName]);
					dbFields.push(fieldValue);
				}
			}

			sql = sql.substring(0, sql.length - 1) + ';';

			if (dbFields.length) {
				await dbConn.query(sql, dbFields);
			}

			await commitAndRelease(dbConn);
		} catch (_err) {
			await dbConn.rollback();
			await dbConn.release();
			throw _err;
		}
	}

	async rmUser(userUuid: string): Promise<void> {
		const { helpers, lUtils } = this;
		const logPrefix = `${topLogPrefix} rmUser() -`;

		const uuidBuffer = helpers.valueOrThrow(lUtils.uuidToBuffer(userUuid), logPrefix, 'Invalid user uuid');

		let sql = 'DELETE FROM user_users_data WHERE userUuid = ?;';
		await this.db.query(sql, [uuidBuffer]);

		sql = 'DELETE FROM user_users WHERE uuid = ?;';
		await this.db.query(sql, [uuidBuffer]);
	}

	async rmUserField(userUuid: string, fieldName: string): Promise<void> {
		const { helpers, lUtils } = this;
		const logPrefix = `${topLogPrefix} rmUserField() -`;

		const userUuidBuffer = helpers.valueOrThrow(lUtils.uuidToBuffer(userUuid), logPrefix, 'Invalid user uuid');
		const fieldUuid = helpers.valueOrThrow(await helpers.getFieldUuid(fieldName), logPrefix, `Could not get field uuid for field: ${fieldName}`);
		const fieldUuidBuffer = helpers.valueOrThrow(lUtils.uuidToBuffer(fieldUuid), logPrefix, 'Invalid field uuid');

		const sql = 'DELETE FROM user_users_data WHERE userUuid = ? AND fieldUuid = ?';
		await this.db.query(sql, [userUuidBuffer, fieldUuidBuffer]);
	}

	async setPassword(userUuid: string, password: string): Promise<void> {
		const { helpers, lUtils } = this;
		const logPrefix = `${topLogPrefix} setPassword() -`;

		const userUuidBuffer = helpers.valueOrThrow(lUtils.uuidToBuffer(userUuid), logPrefix, 'Invalid user uuid');

		const dbFields: Array<string | Buffer> = [];
		dbFields.push(password);
		dbFields.push(userUuidBuffer);

		const sql = 'UPDATE user_users SET password = ? WHERE uuid = ?;';
		await this.db.query(sql, dbFields);
	}

	async setUsername(userUuid: string, username: string): Promise<void> {
		const { helpers, lUtils } = this;
		const logPrefix = `${topLogPrefix} setUsername() -`;

		const userUuidBuffer = helpers.valueOrThrow(lUtils.uuidToBuffer(userUuid), logPrefix, 'Invalid user uuid');

		const sql = 'UPDATE user_users SET username = ? WHERE uuid = ?;';
		const dbFields = [username, userUuidBuffer];
		await this.db.query(sql, dbFields);
	}
}
