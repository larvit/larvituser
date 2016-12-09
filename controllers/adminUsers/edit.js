'use strict';

const	userLib	= require(__dirname + '/../../index.js'),
	async	= require('async');

exports.run = function(req, res, cb) {
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

		let	user;

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
			tasks.push(function(cb) {
				userLib.usernameAvailable(data.global.formFields.username.trim(), function(err, result) {
					if (err) { cb(err); return; }

					if (result !== true) {
						data.global.errors.push('Username is taken by another user');
					}

					cb(err);
				});
			});

			// Create the user
			tasks.push(function(cb) {
				if (data.global.errors.length) { cb(); return; }

				userLib.create(data.global.formFields.username, data.global.formFields.password, userFields, function(err, result) {
					user = result;
					cb(err);
				});
			});
		} else {
			tasks.push(function(cb) {
				userLib.fromUuid(data.global.urlParsed.query.uuid, function(err, result) {
					user = result;
					cb(err);
				});
			});
		}

		// Update username
		tasks.push(function(cb) {
			if (data.global.formFields.username.trim() === user.username) {
				cb();
				return;
			}

			userLib.usernameAvailable(data.global.formFields.username.trim(), function(err, result) {
				if (err) { cb(err); return; }

				if (result !== true) {
					data.global.errors.push('Username is taken by another user');
				}

				cb(err);
			});
		});

		tasks.push(function(cb) {
			if (data.global.formFields.username.trim() === user.username) {
				cb();
				return;
			}

			if (data.global.errors.length) { cb(); return; }

			user.setUsername(data.global.formFields.username.trim(), cb);
		});

		// Update password
		if (data.global.formFields.password.trim() !== '') {
			tasks.push(function(cb) {
				if (data.global.errors.length) { cb(); return; }

				user.setPassword(data.global.formFields.password.trim(), cb);
			});
		}

		// Replace user fields
		tasks.push(function(cb) {
			if (data.global.errors.length) { cb(); return; }

			user.replaceFields(userFields, cb);
		});

		tasks.push(function(cb) {
			if (data.global.errors.length) { cb(); return; }

			data.global.messages = ['Saved'];
			cb();
		});
	}

	if (data.global.urlParsed.query.uuid !== undefined) {
		tasks.push(function(cb) {
			userLib.fromUuid(data.global.urlParsed.query.uuid, function(err, user) {
				if (err) { cb(err); return; }

				data.user = {
					'uuid':	user.uuid,
					'username':	user.username,
					'fields':	user.fields
				};

				cb();
			});
		});
	}

	async.series(tasks, function(err) {
		cb(err, req, res, data);
	});
};
