'use strict';

exports = module.exports = async options => {
	const {db} = options;

	await db.query('ALTER TABLE `user_users` ADD `inactive` int(1) NULL AFTER `password`;');
};
