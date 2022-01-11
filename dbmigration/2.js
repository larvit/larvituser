'use strict';

const uuidLib = require('uuid');

exports = module.exports = async options => {
	const {db} = options;

	// Migrate stuff
	await db.query('ALTER TABLE `user_data_fields` ADD `uuid` binary(16) NOT NULL FIRST;');

	const {rows} = await db.query('SELECT id, name FROM user_data_fields');
	for (const row of rows) {
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
};
