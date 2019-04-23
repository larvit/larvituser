'use strict';

const	topLogPrefix = 'larvituser: users.js ',
	LUtils	= require('larvitutils'),
	async	= require('async');

function Users(options) {
	const	logPrefix	= topLogPrefix + 'Users() - ',
		that	= this;

	that.options	= options || {};

	if ( ! that.options.log) {
		const	tmpLUtils	= new LUtils();
		options.log	= new tmpLUtils.Log();
	}

	that.options	= options;

	for (const key of Object.keys(options)) {
		that[key]	= options[key];
	}

	that.lUtils	= new LUtils({'log': that.log});

	if ( ! that.db) {
		const	err	= new Error('Required option db is missing');
		that.log.error(logPrefix + err.message);
		throw err;
	}
}

/**
 * Gets distinct data values from speciefied field for all users
 *
 * @param str fieldName - the name of the field
 * @param func cb(err, result) - an array with values liek ['value1', 'value2']
 */
Users.prototype.getFieldData = function (fieldName, cb) {
	const	that	= this,
		sql	= 'SELECT DISTINCT d.data FROM user_users_data d JOIN user_data_fields f ON d.fieldUuid = f.uuid WHERE f.name = "' + fieldName + '"';

	that.db.query(sql, function (err, rows) {
		const	result	= [];

		if (err) return cb(err);

		for (let row of rows) {
			result.push(row.data);
		}

		cb(err, result);
	});
};

Users.prototype.get = function (cb) {
	const	logPrefix = topLogPrefix + ' get() - ',
		dbFields	= [],
		tasks	= [],
		that	= this;

	let	sqlWhere	= '',
		totalElements,
		result;

	// Build where-statement
	tasks.push(function (cb) {
		if (that.matchExistingFields !== undefined) {
			sqlWhere	+= 'AND uuid IN (\n';
			sqlWhere	+= 'SELECT DISTINCT userUuid FROM user_users_data WHERE fieldUuid IN (\n';
			sqlWhere	+= 'SELECT uuid FROM user_data_fields WHERE\n';

			for (let i = 0; that.matchExistingFields[i] !== undefined; i ++) {
				sqlWhere += 'name = ? OR ';
				dbFields.push(that.matchExistingFields[i]);
			}

			sqlWhere	= sqlWhere.substring(0, sqlWhere.length - 4) + '))\n';
		}

		if (that.matchAllFields !== undefined) {
			for (const field in that.matchAllFields) {
				sqlWhere	+= 'AND uuid IN (SELECT userUuid FROM user_users_data WHERE data = ?\n'
					+	' AND fieldUuid = (SELECT uuid FROM user_data_fields WHERE name = ?))';
				dbFields.push(that.matchAllFields[field]);
				dbFields.push(field);
			}
		}

		if (that.matchAllFieldsQ !== undefined) {
			for (const field in that.matchAllFieldsQ) {
				sqlWhere	+= 'AND uuid IN (SELECT userUuid FROM user_users_data WHERE data LIKE ?\n'
					+	' AND fieldUuid = (SELECT uuid FROM user_data_fields WHERE name = ?))';
				dbFields.push('%' + that.matchAllFieldsQ[field] + '%');
				dbFields.push(field);
			}
		}

		if (that.q !== undefined) {
			sqlWhere += ' AND (\n';
			sqlWhere += '   uuid IN (SELECT userUuid FROM user_users_data WHERE data LIKE ?)\n';
			sqlWhere += '   OR username LIKE ?\n';
			sqlWhere += ')\n';
			dbFields.push('%' + that.q + '%');
			dbFields.push('%' + that.q + '%');
		}

		if (that.uuids !== undefined) {
			if ( ! Array.isArray(that.uuids)) {
				that.uuids	= [that.uuids];
			}

			if (that.uuids.length === 0) {
				sqlWhere += ' AND 1 = 2\n';
				return cb();
			}

			sqlWhere += ' AND uuid IN (';

			for (let i = 0; that.uuids[i] !== undefined; i ++) {
				if (that.lUtils.uuidToBuffer(that.uuids[i]) === false) {
					that.log.warn(logPrefix  + 'Invalid field uuid, skipping');
					continue;
				}

				sqlWhere += '?,';
				dbFields.push(that.lUtils.uuidToBuffer(that.uuids[i]));
			}

			sqlWhere = sqlWhere.substring(0, sqlWhere.length - 1) + ')\n';
		}

		cb();
	});

	tasks.push(function (cb) {
		let	sql	= 'SELECT uuid, username FROM user_users WHERE 1 ' + sqlWhere;

		if (that.limit !== undefined && ! isNaN(parseInt(that.limit))) {
			sql += ' LIMIT ' + parseInt(that.limit);

			if (that.offset !== undefined && ! isNaN(parseInt(that.offset))) {
				sql += ' OFFSET ' + parseInt(that.offset);
			}
		}

		that.db.query(sql, dbFields, function (err, rows) {
			if (err) return cb(err);

			result	= [];

			for (let i = 0; rows[i] !== undefined; i ++) {
				const	user	= {};

				user.uuid	= that.lUtils.formatUuid(rows[i].uuid);
				user.username	= rows[i].username;

				result.push(user);
			}

			if (that.returnFields !== undefined && ! Array.isArray(that.returnFields)) {
				that.returnFields = [that.returnFields];
			}

			// Fetch field data for users, if requested
			if (that.returnFields !== undefined && that.returnFields.length > 0) {
				const subTasks = [];

				for (let u of result) {
					subTasks.push(function (cb) {
						let	subFields	= [],
							sql = 'SELECT uf.uuid AS fieldUuid,\n' +
							'uf.name AS fieldName,\n' +
							'ud.data AS fieldData,\n' +
							'ud.userUuid AS userUuid\n' +
							'FROM\n' +
								'user_data_fields uf\n' +
									'LEFT JOIN user_users_data ud ON ud.fieldUuid = uf.uuid\n' +
								'WHERE uf.name IN (';

						for (let fn of that.returnFields) {
							sql += '?,';
							subFields.push(fn);
						}

						sql	= sql.substring(0, sql.length - 1);

						sql += ') AND ud.userUuid = ?';

						if (that.lUtils.uuidToBuffer(u.uuid) === false) {
							that.log.warn(logPrefix + 'Inavlid user uuid, skipping');
							return cb();
						}

						subFields.push(that.lUtils.uuidToBuffer(u.uuid));

						that.db.query(sql, subFields, function (err, rows) {
							if (err) return cb(err);

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
		const	sql	= 'SELECT COUNT(*) AS totalElements FROM user_users WHERE 1 ' + sqlWhere;

		that.db.query(sql, dbFields, function (err, rows) {
			if (err) return cb(err);

			totalElements	= rows[0].totalElements;

			cb(err);
		});
	});

	async.parallel(tasks, function (err) {
		cb(err, result, totalElements);
	});
};

exports = module.exports = Users;