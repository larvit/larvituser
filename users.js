'use strict';

const	dataWriter	= require(__dirname + '/dataWriter.js'),
	lUtils	= require('larvitutils'),
	async	= require('async'),
	db	= require('larvitdb');

function Users() {
}

/**
 * Gets distinct data values from speciefied field for all users
 *
 * @param str fieldName - the name of the field
 * @param func cb(err, result) - an array with values liek ['value1', 'value2']
 */
Users.prototype.getFieldData = function (fieldName, cb) {

	db.query('SELECT DISTINCT d.data FROM user_users_data d '
	+ 'JOIN user_data_fields f ON d.fieldUuid = f.uuid '
	+ 'WHERE f.name = "' + fieldName + '"', function (err, rows) {
		if (err) { cb(err); return; }

		let result = [];

		for (let row of rows) {
			result.push(row.data);
		}

		cb(err, result);
	});
};

Users.prototype.get = function (cb) {
	const	tasks	= [],
		that	= this;

	let	totalElements,
		result;

	tasks.push(dataWriter.ready);

	tasks.push(function (cb) {
		const	dbFields	= [];

		let	sql	= 'SELECT uuid, username FROM user_users WHERE 1 ';

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

		db.query(sql, dbFields, function (err, rows) {
			if (err) { cb(err); return; }

			result = [];

			for (let i = 0; rows[i] !== undefined; i ++) {

				const	user	= {};

				user.uuid	= lUtils.formatUuid(rows[i].uuid);
				user.username	= rows[i].username;

				result.push(user);
			}

			if (that.returnFields !== undefined && ! Array.isArray(that.returnFields)) {
				that.returnFields = [that.returnFields];
			}

			// fetch field data for users, if requested
			if (that.returnFields !== undefined && that.returnFields.length > 0) {
				
				const subTasks = [];

				for (let u of result) {

					subTasks.push(function (cb) {
						let subFields = [],
							sql = 'SELECT uf.uuid AS fieldUuid,\n' +
							'uf.name AS fieldName,\n' +
							'ud.data AS fieldData,\n' +
							'ud.userUuid AS userUuid\n' +
								'FROM\n' +
        							'user_data_fields uf\n' +
                						'LEFT JOIN user_users_data       ud ON ud.fieldUuid       = uf.uuid\n' +
        					'WHERE uf.name IN (';
					
						for (let fn of that.returnFields) {
							sql += '?,';
							subFields.push(fn);
						}

						sql = sql.substring(0, sql.length - 1);

						sql += ') AND ud.userUuid = ?';
						subFields.push(lUtils.uuidToBuffer(u.uuid));

						db.query(sql, subFields, function (err, rows) {

							if (err) { return cb(err); }

							for (let i = 0; rows[i] !== undefined; i ++) {
								const	row	= rows[i];

								if (row.fieldUuid) {
									if (u[row.fieldName] === undefined) {
										u[row.fieldName] = [];
									}

									u[row.fieldName].push(row.fieldData);
								}
							}

							cb();
						});
					});
				}

				async.parallel(subTasks, cb);

			} else {
				cb(err);
			}
		});
	});

	tasks.push(function (cb) {
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

		db.query(sql, dbFields, function (err, rows) {
			if (err) { cb(err); return; }

			totalElements = rows[0].totalElements;

			cb(err);
		});
	});

	async.parallel(tasks, function (err) {
		cb(err, result, totalElements);
	});
};

exports = module.exports = Users;
