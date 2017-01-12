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
		let sql = 'SELECT uuid, username FROM user_users WHERE 1 ';

		if (that.matchAllFields !== undefined) {
			for (let field in that.matchAllFields) {
				sql	+= 'AND uuid IN (SELECT userUuid FROM user_users_data WHERE data = ?\n'
					+	' AND fieldUuid = (SELECT uuid FROM user_data_fields WHERE name = ?))';
				dbFields.push(that.matchAllFields[field]);
				dbFields.push(field);
			}
		}

		if (that.limit !== undefined && ! isNaN(parseInt(that.limit))) {
			sql += ' LIMIT ' + parseInt(that.limit);

			if (that.offset !== undefined && ! isNaN(parseInt(that.offset))) {
				sql += ' OFFSET ' + parseInt(that.offset);
			}
		}

		db.query(sql, dbFields, function(err, rows) {
			if (err) { cb(err); return; }

			result = [];

			for (let i = 0; rows[i] !== undefined; i ++) {

				const user = {};

				user.uuid	= lUtils.formatUuid(rows[i].uuid);
				user.username	= rows[i].username;

				result.push(user);
			}

			cb(err);
		});
	});

	tasks.push(function(cb) {
		const	dbFields	= [];

		let	sql	= 'SELECT COUNT(*) AS totalElements FROM user_users WHERE 1 ';

		if (that.matchAllFields !== undefined) {
			for (let field in that.matchAllFields) {
				sql	+= 'AND uuid IN (SELECT userUuid FROM user_users_data WHERE data = ?\n'
					+	' AND fieldUuid = (SELECT uuid FROM user_data_fields WHERE name = ?))';

				dbFields.push(that.matchAllFields[field]);
				dbFields.push(field);
			}
		}

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
