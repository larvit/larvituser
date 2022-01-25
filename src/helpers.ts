import { Utils, Log, LogInstance } from 'larvitutils';
import { DataWriter } from './dataWriter';

const topLogPrefix = 'larvituser: helpers.ts -';

export type HelpersOptions = {
	dataWriter: DataWriter,
	db: any,
	log: LogInstance,
}

export function arrayify<T>(value: T | Array<T>): Array<T> {
	return Array.isArray(value) ? value : [value];
}

export class Helpers {
	private dataWriter: DataWriter;
	private db: any;
	private log: LogInstance;
	private lUtils: Utils;

	constructor(options: HelpersOptions) {
		if (!options.db) throw new Error('Required option "db" not set');
		if (!options.dataWriter) throw new Error('Required option "dataWriter" not set');

		options.log = options.log ?? new Log('info');

		this.dataWriter = options.dataWriter;
		this.db = options.db;
		this.log = options.log;

		this.lUtils = new Utils({ log: options.log });

	}

	valueOrThrow<T>(value: T | boolean, logPrefix: string, errMsg: string): T {
		if (value === false || value === undefined || value === null) {
			const err = new Error(errMsg);
			this.log.warn(`${logPrefix} ${err.message}`);
			throw err;
		}

		// value should never be set to true, therefore this is safe
		return value as T;
	}

	async getFieldName(uuid: string): Promise<string | boolean> {
		const logPrefix = `${topLogPrefix} getFieldName() -`;
		const sql = 'SELECT name FROM user_data_fields WHERE uuid = ?';

		const fieldUuidBuffer = this.lUtils.uuidToBuffer(uuid);
		if (!fieldUuidBuffer) {
			const err = new Error('Invalid field uuid');
			this.log.verbose(`${logPrefix} ${err.message}`);
			throw err;
		}

		const { rows } = await this.db.query(sql, [fieldUuidBuffer]);

		if (!rows.length) return false;

		return rows[0].name;
	}

	async getFieldUuid(fieldName: string, dbConn?: any): Promise<string | boolean> {
		const dbFields = [];
		const sql = 'SELECT uuid FROM user_data_fields WHERE name = ?';

		fieldName = fieldName.trim();
		dbFields.push(fieldName);

		const db = dbConn || this.db;
		const { rows } = await db.query(sql, dbFields);

		if (!rows.length) {
			await this.dataWriter.addUserField(fieldName);

			return await this.getFieldUuid(fieldName);
		}

		return this.lUtils.formatUuid(rows[0].uuid);
	}
}
