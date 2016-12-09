'use strict';

const	userLib	= require(__dirname + '/../../index.js'),
	async	= require('async');

exports.run = function(req, res, cb) {
	const	tasks	= [],
		data	= {'global': res.globalData};

	// Make sure the user have the correct rights
	// This is set in larvitadmingui controllerGlobal
	if ( ! res.adminRights) {
		cb(new Error('Invalid rights'), req, res, {});
		return;
	}

	data.global.menuControllerName	= 'adminUsers';
	data.pagination	= {};
	data.pagination.urlParsed	= data.global.urlParsed;
	data.pagination.elementsPerPage	= 100;

	tasks.push(function(cb) {
		const	users	= new userLib.Users();

		//users.returnFields	= ['firstname', 'lastname'];
		users.limit	= data.pagination.elementsPerPage;
		users.offset	= parseInt(data.global.urlParsed.query.offset)	|| 0;

		if (isNaN(users.offset) || users.offset < 0) {
			users.offset = 0;
		}

		//if (data.global.urlParsed.query.filterStatus) {
		//	users.matchAllFields = {'status': data.global.urlParsed.query.filterStatus};
		//}

		users.get(function(err, result, totalElements) {
			data.users	= result;
			data.pagination.totalElements	= totalElements;
			cb(err);
		});
	});

	async.series(tasks, function(err) {
		cb(err, req, res, data);
	});
};
