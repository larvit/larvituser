'use strict';

const topLogPrefix = 'larvituser: src/datastore.js: ';
const Db = require('larvitdb');
const EventEmitter = require('events');
const DbMigration = require('larvitdbmigration');
const LUtils = require('larvitutils');
const path = require('path');
const uuidLib = require('uuid');

class Datastore {

	/**
	 * Datastore constructor
	 *
	 * @param {object} options -
	 * @param {object} options.log -
	 * @param {object} options.dbConf -
	 * @param {String} options.dbConf.host -
	 * @param {String} options.dbConf.user -
	 * @param {String} options.dbConf.password -
	 * @param {String} options.dbConf.database -
	 */
	constructor(options) {
		this.logPrefix = topLogPrefix + 'Datastore() - ';
		this.options = options;
		this.readyEmitter = new EventEmitter();
		this.isReady = false;
		this.readyInProgress = false;
		this.log = this.options.log;
		this.lUtils = new LUtils({log: this.log});
	}

	/**
	 * Connects to database and runs dbmigrations
	 *
	 * Safe to run multiple times,
	 * also fast enough to run before each db operation
	 *
	 * @returns {promise} -
	 */
	async ready() {
		const logPrefix = this.logPrefix + 'ready() - ';
		const {log, readyEmitter} = this;

		if (this.isReady) return true;
		if (this.readyInProgress) {
			log.debug(logPrefix + 'Another ready process is in progress, await its completion');

			return await new Promise(r => readyEmitter.once('ready', r));
		}

		log.verbose(logPrefix + 'Connect to database and run database migrations');

		this.readyInProgress = true;
		this.db = new Db(this.options.dbConf);

		const dbMigration = new DbMigration({
			dbType: 'mariadb',
			dbDriver: this.db,
			tableName: 'larvituser_db_version',
			migrationScriptPath: path.normalize(__dirname + '/../dbmigration'),
			log
		});
		await dbMigration.run();
		this.readyInProgress = false;
		this.isReady = true;
		readyEmitter.emit('ready');
	}

	async user({uuid, username, password}) {
		const logPrefix = this.logPrefix + 'user() - ';
		await this.ready();
		const {lUtils, db} = this;

		const userData = await db.query('SELECT uuid, username FROM user_users WHERE uuid = ?', lUtils.uuidToBuffer(uuid));

		return userData;

		const foundUser = usersData.find(user => user.uuid === uuid);

		if (!foundUser) return foundUser;

		return {
			uuid: foundUser.uuid,
			username: foundUser.username,
			fields: function fields({fieldNames}) {
				if (fieldNames === undefined) return foundUser.fields;

				const result = [];

				foundUser.fields.forEach(field => {
					if (fieldNames.includes(field.name)) {
						result.push(field);
					}
				});

				return result;
			}
		}
	}

	users(args, a, b) {
		const {uuids, usernames, q_or, q_and} = args;

		console.log('args:');
		console.log(args);

		/*
		console.log('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
		console.log(a);

		console.log('BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB');
		console.log(b);

		console.log('--------');
		console.log('--------');
		console.log('--------');
		console.log('--------');
		console.log('--------');
		*/

		return usersData;

		//return usersData.filter(user => {
		//	if (uuids !== undefined) {
		//		for (let i = 0; uuids.length !== i; i++) {
		//			const uuid = uuids[i];

		//			console.log('Checking "' + uuid + '" against user.uuid: "' + user.uuid + '"');

		//			if (uuid === user.uuid) return true;
		//		}
		//	}
		//	return false;
		//});
	}

	async createUser({uuid, username, password, fields}) {
		let logPrefix = this.logPrefix + 'createUser() - ';
		await this.ready();
		const {db, log, lUtils} = this;

		log.verbose(logPrefix + 'Trying to create a new user');

		if (!username) {
			const err = new Error('No username provided, can not create user');
			log.info(logPrefix + err.message);
			throw err;
		}

		logPrefix += 'username: "' + username + '" - ';

		if (!uuid) {
			uuid = uuidLib.v1();
			log.verbose(logPrefix + 'No uuid was supplied, generating one: "' + uuid + '"');
		}

		const uuidBuf = lUtils.uuidToBuffer(uuid);
		if (!uuidBuf) {
			const err = new Error('Invalid uuid supplied: "' + uuid + '"');
			log.info(logPrefix + err.message);
			throw err;
		}

		await db.query('INSERT INTO user_users (uuid, username, password) VALUES(?,?,?);', [uuidBuf, username, '']);

		return this.user({uuid});
	}

	replaceUser() {}

	updateUser() {}

	replaceUserField() {}

	addUserField() {}

	rmUserField() {}
}

exports = module.exports = Datastore;
