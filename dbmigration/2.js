'use strict';

const	uuidLib	= require('uuid'),
	async	= require('async'),
	db	= require('larvitdb');

exports = module.exports = function(cb) {
	const	tasks	= [];

	/* Create example data to test this migration against existing data * /
	let userUuid	= uuidLib.v1();
	let username	= 'fomme';
	tasks.push(function(cb) {
		db.query('INSERT INTO user_data_fields (name) VALUES(\'foo\'),(\'bar\');', cb);
	});
	tasks.push(function(cb) {
		db.query('INSERT INTO user_users (uuid, username, password) VALUES(UNHEX(?),?,?);', [userUuid.replace(/-/g, ''), username, 'false'], cb);
	});
	tasks.push(function(cb) {
		const	sql	= 'INSERT INTO user_users_data (userUuid, fieldId, data) SELECT UNHEX(\'' + userUuid.replace(/-/g, '') + '\'), id, \'mepp\' FROM user_data_fields WHERE name = \'foo\';';

		db.query(sql, cb);
	});
	tasks.push(function(cb) {
		const	sql	= 'INSERT INTO user_users_data (userUuid, fieldId, data) SELECT UNHEX(\'' + userUuid.replace(/-/g, '') + '\'), id, \'waff\' FROM user_data_fields WHERE name = \'bar\';';

		db.query(sql, cb);
	});/**/

	// Migrate stuff
	tasks.push(function(cb) {
		db.query('ALTER TABLE `user_data_fields` ADD `uuid` binary(16) NOT NULL FIRST;', cb);
	});

	tasks.push(function(cb) {
		db.query('SELECT id, name FROM user_data_fields', function(err, rows) {
			const	tasks	= [];

			if (err) { cb(err); return; }

			for (let i = 0; rows[i] !== undefined; i ++) {
				const	row	= rows[i];

				tasks.push(function(cb) {
					db.query('UPDATE user_data_fields SET uuid = UNHEX(?) WHERE id = ?;', [uuidLib.v1().replace(/-/g, ''), row.id], cb);
				});
			}

			async.parallel(tasks, cb);
		});
	});

	tasks.push(function(cb) { db.query('ALTER TABLE `user_users_data` ADD `fieldUuid` binary(16) NOT NULL AFTER `userUuid`;',	cb); });
	tasks.push(function(cb) { db.query('UPDATE user_users_data uud SET fieldUuid = (SELECT uuid FROM user_data_fields WHERE id = uud.fieldId)',	cb); });
	tasks.push(function(cb) { db.query('ALTER TABLE `user_users_data` DROP FOREIGN KEY `user_users_data_ibfk_2`;',	cb); });
	tasks.push(function(cb) { db.query('ALTER TABLE `user_users_data` DROP `id`, DROP `fieldId`;',	cb); });
	tasks.push(function(cb) { db.query('ALTER TABLE `user_data_fields` DROP `id`;',	cb); });
	tasks.push(function(cb) { db.query('ALTER TABLE `user_data_fields` ADD PRIMARY KEY `uuid` (`uuid`);',	cb); });
	tasks.push(function(cb) { db.query('ALTER TABLE `user_users_data` ADD FOREIGN KEY (`fieldUuid`) REFERENCES `user_data_fields` (`uuid`) ON DELETE NO ACTION ON UPDATE NO ACTION;',	cb); });
	tasks.push(function(cb) { db.query('ALTER TABLE `user_users_data` DROP INDEX `userUuid_fieldId`;',	cb); });

	async.series(tasks, cb);
};
