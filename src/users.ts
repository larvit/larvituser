import { Log, LogInstance, Utils } from 'larvitutils';
import { arrayify } from './helpers';
import { DateTime } from 'luxon';

const topLogPrefix = 'larvituser: users.ts';

export type matchDate = {
	field: string,
	value: string,
	operation?: 'gt' | 'lt' | 'eq',
};

export type notEqual = {
	field: string,
	value: string,
};

export type UsersOptions = {
	db: any,
	limit?: string,
	log?: LogInstance,
	showInactive?: boolean,
	showInactiveOnly?: boolean,
	matchDateFields?: matchDate[],
	matchDates?: matchDate[],
	matchAllFields?: Record<string, string | Array<string>>,
	matchAllFieldsQ?: Record<string, string | Array<string>>,
	matchExistingFields?: string[],
	matchFieldHasValue?: string[],
	matchFieldHasNoValue?: string[],
	notEqualFields?: notEqual[],
	offset?: string,
	order?: {
		by?: string,
		direction?: 'asc' | 'desc',
	},
	q?: string,
	returnFields?: string[],
	uuids?: string | string[],
	createdAfter?: Date,
	updatedAfter?: Date,
};

export type UserFields = {
	[key: string]: string[]
};

export type UserModel = {
	uuid: string,
	username: string,
	created?: string,
	updated?: string,
	fields: UserFields,
};

export class Users {
	private log: LogInstance;
	private lUtils: Utils;
	private options: Omit<UsersOptions, 'log'>;

	constructor(options: UsersOptions) {
		if (!options.db) throw new Error('Required option "db" is missing');

		this.log = options.log ?? new Log();
		this.lUtils = new Utils({ log: this.log });
		this.options = options;
	}

	/**
	 * Gets distinct data values from speciefied field for all users
	 *
	 * @param {string} fieldName - the name of the field
	 * @returns {Array<string>} - an array with values liek ['value1', 'value2']
	 */
	async getFieldData(fieldName: string): Promise<string[]> {
		const { db } = this.options;
		const sql = 'SELECT DISTINCT d.data FROM user_users_data d JOIN user_data_fields f ON d.fieldUuid = f.uuid WHERE f.name = "' + fieldName + '"';
		const { rows } = await db.query(sql);

		return rows.map((r: any) => r.data);
	}

	async get(): Promise<{ users: Array<UserModel>, totalElements: number }> {
		const { log, options, lUtils } = this;
		const { db } = options;
		const logPrefix = `${topLogPrefix} get() -`;
		const dbCon = await db.getConnection();

		const dbFields: Array<string | string[] | Buffer | Date> = [];
		let sqlWhere = '';

		// Check if we should show inactive users or not
		if (options.showInactiveOnly === true) {
			// Show inactive users only
			sqlWhere += ' AND inactive = 1\n';
		} else if (!options.showInactive) {
			// Show active users
			sqlWhere += ' AND (inactive IS NULL OR inactive = 0)\n';
		}

		// Check createdAfter
		if (options.createdAfter) {
			sqlWhere += ' AND created >= ?\n';
			dbFields.push(options.createdAfter);
		}

		// Check updatedAfter
		if (options.updatedAfter) {
			sqlWhere += ' AND updated >= ?\n';
			dbFields.push(options.updatedAfter);
		}

		// Check headerDates
		if (options.matchDates && options.matchDates.length) {
			for (const matchExistingDate of options.matchDates) {
				const operation = matchExistingDate.operation || 'eq';
				const value = matchExistingDate.value;
				const field = matchExistingDate.field;
				if (!value) continue;
				if (!field) continue;

				sqlWhere += ' AND ' + dbCon.escapeId(field);

				if (operation === 'eq') sqlWhere += ' = CAST(? AS DATETIME)\n';
				else if (operation === 'gt') sqlWhere += ' > CAST(? AS DATETIME)\n';
				else if (operation === 'lt') sqlWhere += ' < CAST(? AS DATETIME)\n';

				dbFields.push(value);
			}
		}

		// Build where-statement
		if (options.matchExistingFields && options.matchExistingFields.length) {
			sqlWhere += 'AND uuid IN (\n';
			sqlWhere += 'SELECT DISTINCT userUuid FROM user_users_data WHERE fieldUuid IN (\n';
			sqlWhere += 'SELECT uuid FROM user_data_fields WHERE\n';

			for (const matchExsistingField of options.matchExistingFields) {
				sqlWhere += 'name = ? OR ';
				dbFields.push(matchExsistingField);
			}

			sqlWhere = sqlWhere.substring(0, sqlWhere.length - 4) + '))\n';
		}

		if (options.notEqualFields && options.notEqualFields.length) {
			for (const notEqual of options.notEqualFields) {
				const value = notEqual.value;
				const field = notEqual.field;

				if (!value) continue;
				if (!field) continue;

				sqlWhere += 'AND uuid NOT IN (SELECT userUuid FROM user_users_data WHERE data = ?\n';
				sqlWhere += ' AND fieldUuid = (SELECT uuid FROM user_data_fields WHERE name = ?))';

				dbFields.push(value);
				dbFields.push(field);
			}
		}

		if (options.matchFieldHasValue && options.matchFieldHasValue.length) {
			for (const matchFieldHasValue of options.matchFieldHasValue) {
				sqlWhere += 'AND uuid IN (\n';
				sqlWhere += 'SELECT userUuid FROM user_users_data WHERE fieldUuid IN (\n';
				sqlWhere += 'SELECT uuid FROM user_data_fields WHERE\n';
				sqlWhere += 'name = ?) ';
				sqlWhere += 'AND data IS NOT NULL AND data != "")\n';

				dbFields.push(matchFieldHasValue);
			}
		}

		if (options.matchFieldHasNoValue && options.matchFieldHasNoValue.length) {
			sqlWhere += 'AND (\n';
			sqlWhere += 'uuid IN (\n';
			sqlWhere += 'SELECT userUuid FROM user_users_data WHERE fieldUuid IN (\n';
			sqlWhere += 'SELECT uuid FROM user_data_fields WHERE\n';
			for (const matchFieldHasNoValue of options.matchFieldHasNoValue) {
				sqlWhere += 'name = ? OR ';
				dbFields.push(matchFieldHasNoValue);
			}
			sqlWhere = sqlWhere.substring(0, sqlWhere.length - 4) + ')\n';
			sqlWhere += 'AND (data IS NULL OR data = "")\n';
			sqlWhere += ')\n';
			sqlWhere += 'OR (\n';
			sqlWhere += 'uuid NOT IN (\n';
			sqlWhere += 'SELECT userUuid FROM user_users_data WHERE fieldUuid IN (\n';
			sqlWhere += 'SELECT uuid FROM user_data_fields WHERE\n';
			for (const matchFieldHasNoValue of options.matchFieldHasNoValue) {
				sqlWhere += 'name = ? OR ';
				dbFields.push(matchFieldHasNoValue);
			}
			sqlWhere = sqlWhere.substring(0, sqlWhere.length - 4) + ')\n';
			sqlWhere += ')\n';
			sqlWhere += ')\n';
			sqlWhere += ')\n';
		}

		if (options.matchAllFields && Object.keys(options.matchAllFields).length) {
			for (const field in options.matchAllFields) {
				if (Array.isArray(options.matchAllFields[field])) {
					sqlWhere += 'AND uuid IN (SELECT userUuid FROM user_users_data WHERE data IN (';
					for (const fieldValue of options.matchAllFields[field]) {
						dbFields.push(fieldValue);
						sqlWhere += '?,';
					}
					sqlWhere = sqlWhere.substring(0, sqlWhere.length - 1);
					sqlWhere += ')';
				} else {
					sqlWhere += 'AND uuid IN (SELECT userUuid FROM user_users_data WHERE data = ?\n';
					dbFields.push(options.matchAllFields[field]);
				}

				sqlWhere += ' AND fieldUuid = (SELECT uuid FROM user_data_fields WHERE name = ?))';
				dbFields.push(field);
			}
		}

		if (options.matchAllFieldsQ && Object.keys(options.matchAllFieldsQ).length) {
			for (const field in options.matchAllFieldsQ) {
				sqlWhere += 'AND uuid IN (SELECT userUuid FROM user_users_data WHERE data LIKE ?\n'
					+ ' AND fieldUuid = (SELECT uuid FROM user_data_fields WHERE name = ?))';
				dbFields.push('%' + options.matchAllFieldsQ[field] + '%');
				dbFields.push(field);
			}
		}

		if (options.matchDateFields && options.matchDateFields.length) {
			for (const matchExistingDateField of options.matchDateFields) {
				const operation = matchExistingDateField.operation || 'eq';
				const value = matchExistingDateField.value;
				const field = matchExistingDateField.field;

				if (!value) continue;
				if (!field) continue;

				sqlWhere += 'AND uuid IN (SELECT userUuid FROM user_users_data WHERE data ';
				if (operation === 'eq') sqlWhere += '= ?\n';
				else if (operation === 'gt') sqlWhere += '> ?\n';
				else if (operation === 'lt') sqlWhere += '< ?\n';

				sqlWhere += ' AND fieldUuid = (SELECT uuid FROM user_data_fields WHERE name = ?))\n';

				dbFields.push(value);
				dbFields.push(field);
			}
		}

		if (options.q) {
			sqlWhere += ' AND (\n';
			sqlWhere += '   uuid IN (SELECT userUuid FROM user_users_data WHERE data LIKE ?)\n';
			sqlWhere += '   OR username LIKE ?\n';
			sqlWhere += ')\n';
			dbFields.push('%' + options.q + '%');
			dbFields.push('%' + options.q + '%');
		}

		if (options.uuids) {
			const uuids = arrayify(options.uuids)
				.filter(uuid => {
					const uuidBuffer = lUtils.uuidToBuffer(uuid);
					if (uuidBuffer === false) {
						log.warn(`${logPrefix} Invalid field uuid "${uuid}", skipping`);

						return false;
					}

					return true;
				});

			if (!uuids.length) {
				sqlWhere += ' AND 1 = 2\n';
			} else {
				sqlWhere += ' AND uuid IN (';

				for (const uuid of uuids) {
					const uuidBuffer = lUtils.uuidToBuffer(uuid);

					sqlWhere += '?,';
					dbFields.push(uuidBuffer as Buffer);
				}

				sqlWhere = sqlWhere.substring(0, sqlWhere.length - 1) + ')\n';
			}
		}

		const mainDbFields = dbFields.slice(0);

		const returnFields = options.returnFields ? arrayify(options.returnFields) : undefined;

		let sql = 'SELECT user_users.uuid as uuid, user_users.username as username, user_users.created as created, user_users.updated as updated';

		// SORT ORDERING
		if (options.order !== undefined && typeof options.order === 'object') {
			const allowedSortables = ['uuid', 'username', 'created', 'updated', ...returnFields ?? []];

			if (options.order.by !== undefined && allowedSortables.includes(options.order.by)) {
				if (!['uuid', 'username', 'created', 'updated'].includes(options.order.by)) {
					sql += ', group_concat(user_users_data.data) as ' + dbCon.escapeId(options.order.by) + ' FROM user_users ';
					sql += 'LEFT JOIN user_users_data on (user_users_data.fieldUuid = (SELECT uuid FROM user_data_fields WHERE name = ?) AND user_users_data.userUuid = user_users.uuid) ';
					sql += 'WHERE 1 ';
					mainDbFields.unshift(options.order.by);
				} else {
					sql += ' FROM user_users WHERE 1 ';
				}

				sql += sqlWhere;
				sql += ' GROUP BY uuid';
				sql += ' ORDER BY ' + dbCon.escapeId(options.order.by);

				if (options.order?.direction?.toUpperCase() !== 'DESC') {
					sql += ' ASC';
				} else {
					sql += ' DESC';
				}
			} else {
				throw new Error('The sorting column did not exist in the \'returnFields\' array');
			}
		} else {
			sql += ' FROM user_users WHERE 1 ' + sqlWhere;
		}

		if (options.limit && !isNaN(parseInt(options.limit))) {
			sql += ' LIMIT ' + parseInt(options.limit);

			if (options.offset && !isNaN(parseInt(options.offset))) {
				sql += ' OFFSET ' + parseInt(options.offset);
			}
		}

		const { rows } = await dbCon.query(sql, mainDbFields);
		dbCon.release();

		const users: Array<UserModel> = [];

		for (const row of rows) {
			const user: UserModel = {
				uuid: String(lUtils.formatUuid(row.uuid)),
				username: row.username,
				fields: {},
			};

			if (row.created instanceof Date) {
				user.created = DateTime
					.fromJSDate(row.created)
					.toUTC()
					.toISO() || undefined;
			} else {
				// We do this extra conversion since mariadb returns non-ISO format
				// NOTE: THIS ASSUMES THAT MARIADB IS CONFIGURED FOR UTC TIMEZONE
				//       for a proper solution we have to look at the timezone in DB conf and
				//       handle it accordingly.
				user.created = row.created ? `${row.created.replace(' ', 'T')}.000Z` : undefined;
			}

			if (row.updated instanceof Date) {
				user.updated = DateTime
					.fromJSDate(row.updated)
					.toUTC()
					.toISO() || undefined;
			} else {
				// We do this extra conversion since mariadb returns non-ISO format
				// NOTE: THIS ASSUMES THAT MARIADB IS CONFIGURED FOR UTC TIMEZONE
				//       for a proper solution we have to look at the timezone in DB conf and
				//       handle it accordingly.
				user.updated = row.updated ? `${row.updated.replace(' ', 'T')}.000Z` : user.created;
			}

			users.push(user);
		}

		// Fetch field data for users, if requested
		if (returnFields && returnFields.length > 0) {
			for (const user of users) {
				const uuidBuffer = lUtils.uuidToBuffer(user.uuid as string);
				// Non-tivial to test
				/* istanbul ignore if */
				if (uuidBuffer === false) {
					log.warn(`${logPrefix} Invalid user uuid: "${user.uuid}", skipping`);
					continue;
				}

				const subFields = [];
				let sql = 'SELECT uf.uuid AS fieldUuid,\n' +
					'uf.name AS fieldName,\n' +
					'ud.data AS fieldData,\n' +
					'ud.userUuid AS userUuid\n' +
					'FROM\n' +
						'user_data_fields uf\n' +
							'LEFT JOIN user_users_data ud ON ud.fieldUuid = uf.uuid\n' +
						'WHERE uf.name IN (';

				for (const fn of returnFields) {
					sql += '?,';
					subFields.push(fn);
				}
				sql = sql.substring(0, sql.length - 1);

				sql += ') AND ud.userUuid = ?';

				subFields.push(uuidBuffer);

				const { rows } = await db.query(sql, subFields);
				for (const row of rows) {
					if (!row.fieldUuid) continue;

					user.fields[row.fieldName] ??= [];
					user.fields[row.fieldName].push(row.fieldData);
				}
			}
		}

		// Total number of elements
		const totalElementsSql = 'SELECT COUNT(*) AS totalElements FROM user_users WHERE 1 ' + sqlWhere;
		const { rows: totalElementsRows } = await db.query(totalElementsSql, dbFields);
		const totalElements = totalElementsRows[0].totalElements;

		return { users, totalElements };
	}
}
