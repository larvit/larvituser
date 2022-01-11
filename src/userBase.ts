import { LogInstance } from 'larvitutils';
import { UserLib } from './index';
import { arrayify } from './helpers';

const topLogPrefix = 'larvituser: userBase.ts:';

export type UserBaseOptions = {
	userInstance: UserLib,
	log: LogInstance,
	uuid: string,
	username: string,
	passwordIsFalse: boolean,
	fields?: Record<string, string[]>,
};

export class UserBase {
	private userInstance: UserLib;
	private log: LogInstance;
	public uuid: string;
	public username: string;
	public passwordIsFalse: boolean;
	public fields: Record<string, string[]>;

	constructor(options: UserBaseOptions) {
		this.userInstance = options.userInstance;
		this.log = options.log;

		this.uuid = options.uuid;
		this.username = options.username;
		this.passwordIsFalse = options.passwordIsFalse;
		this.fields = options.fields ?? {};
	}

	/**
	 * Add a field with value
	 *
	 * @param {string} name -
	 * @param {string} value -
	 * @returns {Promise<void>} -
	 */
	async addField(name: string, value: string | string[]): Promise<void> {
		await this.addFields({ [name]: value });
	}

	/**
	 * Adds one or more fields with values to the user object. Does not overwrite existing values. It is possible to add the same value multiple times
	 *
	 * @param {object} fields - field name as key, field values as array to that key - ex: {'role': ['admin','user']}
	 * @returns {Promise<void>} -
	 */
	async addFields(fields: Record<string, string | string[]>): Promise<void> {
		const logPrefix = `${topLogPrefix} UserBase.addFields() -`;

		if (!this.uuid) {
			const err = new Error('Cannot add field; no user loaded');
			this.log.verbose(`${logPrefix} ${err.message}`);
			throw err;
		}

		await this.userInstance.addUserDataFields(this.uuid, fields);

		for (const key in fields) {
			const value = arrayify(fields[key]);
			this.fields[key] ??= [];
			this.fields[key].push(...value);
		}
	}

	/**
	 * Replace all fields
	 * IMPORTANT!!! Will clear all data not given in the fields parameter
	 *
	 * @param {object} fields - field name as key, field values as array to that key - ex: {'role': ['admin','user']}
	 * @returns {Promise<void>} -
	 */
	async replaceFields(fields: Record<string, string | string[]>): Promise<void> {
		const logPrefix = `${topLogPrefix} UserBase.replaceFields() -`;

		if (!this.uuid) {
			const err = new Error('Cannot replace fields; no user loaded');
			this.log.verbose(`${logPrefix} ${err.message}`);
			throw err;
		}

		await this.userInstance.replaceUserFields(this.uuid, fields);

		// Reload everything
		const user = await this.userInstance.fromUuid(this.uuid);

		// Non-trivial to test
		/* istanbul ignore if */
		if (typeof user === 'boolean') {
			const err = new Error(`Failed to load user after replacing fields, userUuid: ${this.uuid}`);
			this.log.verbose(`${logPrefix} ${err.message}`);
			throw err;
		}

		this.fields = user.fields;
	}

	async rm(): Promise<void> {
		const logPrefix = `${topLogPrefix} UserBase.rm() -`;

		if (!this.uuid) {
			const err = new Error('Cannot remove field; no user loaded');
			this.log.verbose(`${logPrefix} ${err.message}`);
			throw err;
		}

		await this.userInstance.rmUser(this.uuid);

		this.username = '';
		this.fields = {};
	}

	/**
	 * Remove a field from this user
	 *
	 * @param {string} name -
	 * @returns {Promise<void>} -
	 */
	async rmField(name: string): Promise<void> {
		const logPrefix = `${topLogPrefix} UserBase.rmField() -`;

		if (!this.uuid) {
			const err = new Error('Cannot remove field; no user loaded');
			this.log.verbose(`${logPrefix} ${err.message}`);
			throw err;
		}

		await this.userInstance.rmUserField(this.uuid, name);

		delete this.fields[name];
	}

	async setPassword(newPassword: string): Promise<void> {
		const logPrefix = `${topLogPrefix} UserBase.setPassword() -`;

		if (!this.uuid) {
			const err = new Error('Cannot set password; no user loaded');
			this.log.verbose(`${logPrefix} ${err.message}`);
			throw err;
		}

		await this.userInstance.setPassword(this.uuid, newPassword);
	}

	async setUsername(newUsername: string): Promise<void> {
		const logPrefix = `${topLogPrefix} UserBase.setUsername() -`;

		if (!this.uuid) {
			const err = new Error('Cannot set username; no user loaded');
			this.log.verbose(`${logPrefix} ${err.message}`);
			throw err;
		}

		await this.userInstance.setUsername(this.uuid, newUsername);
		this.username = newUsername;
	}
}
