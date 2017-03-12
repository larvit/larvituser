'use strict';

const	userLib	= require('larvituser'),
	async	= require('async');

exports.run = function (req, res, cb) {
	const	tasks	= [],
		data	= {'global': res.globalData};

	data.global.errors = [];

	// Make sure the user have the correct rights
	// This is set in larvitadmingui controllerGlobal
	if ( ! res.adminRights) {
		cb(new Error('Invalid rights'), req, res, {});
		return;
	}

	data.global.menuControllerName	= 'adminUsers';

	if (data.global.formFields.save !== undefined) {
		const	userFields	= {};

		let	newPassword,
			user;

		if (data.global.formFields.disableLogin === 'yes') {
			newPassword = false;
		} else {
			newPassword = data.global.formFields.password.trim();
		}

		// Format userFields
		for (let i = 0; data.global.formFields.fieldName[i] !== undefined; i ++) {
			const	fieldName	= data.global.formFields.fieldName[i],
				fieldValue	= data.global.formFields.fieldValue[i];

			if (fieldValue !== '' && fieldValue !== undefined) {
				if (userFields[fieldName] === undefined) {
					userFields[fieldName] = [];
				}

				userFields[fieldName].push(fieldValue);
			}
		}

		// Create user if it did not exist
		if (data.global.urlParsed.query.uuid === undefined) {

			// Check so username is not taken
			tasks.push(function (cb) {
				userLib.usernameAvailable(data.global.formFields.username.trim(), function (err, result) {
					if (err) { cb(err); return; }

					if (result !== true) {
						const	err	= new Error('Username is taken by another user');
						data.global.errors.push(err.message);
						return cb(err);
					}

					cb(err);
				});
			});

			// Create the user
			tasks.push(function (cb) {
				if (data.global.errors.length) { return cb(); }

				userLib.create(data.global.formFields.username, newPassword, userFields, function (err, result) {
					user = result;
					cb(err);
				});
			});
		} else {
			tasks.push(function (cb) {
				userLib.fromUuid(data.global.urlParsed.query.uuid, function (err, result) {
					user = result;
					cb(err);
				});
			});
		}

		// Update username
		tasks.push(function (cb) {
			if ( ! user) {
				throw new Error('Ingen user?!??!');
			}

			if (data.global.formFields.username.trim() === user.username) {
				cb();
				return;
			}

			userLib.usernameAvailable(data.global.formFields.username.trim(), function (err, result) {
				if (err) { cb(err); return; }

				if (result !== true) {
					data.global.errors.push('Username is taken by another user');
				}

				cb(err);
			});
		});

		tasks.push(function (cb) {
			if (data.global.formFields.username.trim() === user.username) {
				cb();
				return;
			}

			if (data.global.errors.length) { return cb(); }

			user.setUsername(data.global.formFields.username.trim(), cb);
		});

		// Update password
		if (data.global.formFields.password.trim() !== '' || newPassword === false) {
			tasks.push(function (cb) {
				if (data.global.errors.length) { return cb(); }

				user.setPassword(newPassword, cb);
			});
		}

		// Replace user fields
		tasks.push(function (cb) {
			if (data.global.errors.length) { return cb(); }

			user.replaceFields(userFields, cb);
		});

		tasks.push(function (cb) {
			if (data.global.errors.length) { return cb(); }

			req.session.data.nextCallData = {'global': {'messages': ['New user created']}};
			res.statusCode = 302;
			res.setHeader('Location', '/adminUsers/edit?uuid=' + user.uuid);

			cb();
		});
	}

	if (data.global.formFields.rmUser !== undefined) {
		tasks.push(function (cb) {
			userLib.rmUser(data.global.urlParsed.query.uuid, function (err) {
				if (err) { cb(err); return; }

				req.session.data.nextCallData = {'global': {'messages': ['User "' + data.global.urlParsed.query.uuid + '" erased']}};
				res.statusCode = 302;
				res.setHeader('Location', '/adminUsers/list');
				cb();
			});
		});
	}

	if (data.global.urlParsed.query.uuid !== undefined) {
		tasks.push(function (cb) {
			userLib.fromUuid(data.global.urlParsed.query.uuid, function (err, user) {
				if (err) { cb(err); return; }

				data.user = {
					'uuid':	user.uuid,
					'username':	user.username,
					'passwordIsFalse':	user.passwordIsFalse,
					'fields':	user.fields
				};

				cb();
			});
		});
	}

	async.series(tasks, function (err) {
		if (err && ! data.global.errors) {
			cb(err, req, res, data);
		} else {
			cb(null, req, res, data);
		}
	});
};
