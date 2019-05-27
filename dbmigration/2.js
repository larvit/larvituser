'use strict';

const uuidLib = require('uuid');
const db = require('larvitdb');

exports = module.exports = function (cb) {
	(async () => {

		/* Create example data to test this migration against existing data * /
		let userUuid = uuidLib.v1();
		let username = 'fomme';

		await db.query('INSERT INTO user_data_fields (name) VALUES(\'foo\'),(\'bar\');');
		await db.query('INSERT INTO user_users (uuid, username, password) VALUES(UNHEX(?),?,?);', [userUuid.replace(/-/g, ''), username, 'false']);
		await db.query('INSERT INTO user_users_data (userUuid, fieldId, data) SELECT UNHEX(\'' + userUuid.replace(/-/g, '') + '\'), id, \'mepp\' FROM user_data_fields WHERE name = \'foo\';');
		await db.query('INSERT INTO user_users_data (userUuid, fieldId, data) SELECT UNHEX(\'' + userUuid.replace(/-/g, '') + '\'), id, \'waff\' FROM user_data_fields WHERE name = \'bar\';');
		/**/

		// Migrate stuff
		await db.query('ALTER TABLE `user_data_fields` ADD `uuid` binary(16) NOT NULL FIRST;');

		const rows = await db.query('SELECT id, name FROM user_data_fields');
		for (let i = 0; rows[i] !== undefined; i++) {
			const row = rows[i];

			await db.query('UPDATE user_data_fields SET uuid = UNHEX(?) WHERE id = ?;', [uuidLib.v1().replace(/-/g, ''), row.id]);
		}

		await db.query('ALTER TABLE `user_users_data` ADD `fieldUuid` binary(16) NOT NULL AFTER `userUuid`;');
		await db.query('UPDATE user_users_data uud SET fieldUuid = (SELECT uuid FROM user_data_fields WHERE id = uud.fieldId)');
		await db.query('ALTER TABLE `user_users_data` DROP FOREIGN KEY `user_users_data_ibfk_2`;');
		await db.query('ALTER TABLE `user_users_data` DROP `id`, DROP `fieldId`;');
		await db.query('ALTER TABLE `user_data_fields` DROP `id`;');
		await db.query('ALTER TABLE `user_data_fields` ADD PRIMARY KEY `uuid` (`uuid`);');
		await db.query('ALTER TABLE `user_users_data` ADD FOREIGN KEY (`fieldUuid`) REFERENCES `user_data_fields` (`uuid`) ON DELETE NO ACTION ON UPDATE NO ACTION;');
		await db.query('ALTER TABLE `user_users_data` DROP INDEX `userUuid_fieldId`;');
	})().catch(err => cb(err));
};
