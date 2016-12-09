'use strict';

const	lUtils	= require('larvitutils'),
	async	= require('async'),
	db	= require('larvitdb');

function Users() {
}

Users.prototype.get = function(cb) {
	const	tasks	= [],
		that	= this;

	let	totalElements,
		result;

	tasks.push(function(cb) {
		const	dbFields	= [];

		let	sql	= 'SELECT uuid, username FROM user_users';

		if (that.limit !== undefined && ! isNaN(parseInt(that.limit))) {
			sql += ' LIMIT ' + parseInt(that.limit);

			if (that.offset !== undefined && ! isNaN(parseInt(that.offset))) {
				sql += ' OFFSET ' + parseInt(that.offset);
			}
		}

		db.query(sql, dbFields, function(err, rows) {
			if (err) { cb(err); return; }

			for (let i = 0; rows[i] !== undefined; i ++) {
				rows[i].uuid = lUtils.formatUuid(rows[i].uuid);
			}

			result = rows;

			cb(err);
		});
	});

	tasks.push(function(cb) {
		const	dbFields	= [];

		let	sql	= 'SELECT COUNT(*) AS totalElements FROM user_users';

		db.query(sql, dbFields, function(err, rows) {
			if (err) { cb(err); return; }

			totalElements = rows[0].totalElements;

			cb(err);
		});
	});

	async.parallel(tasks, function(err) {
		cb(err, result, totalElements);
	});
};

exports = module.exports = Users;
