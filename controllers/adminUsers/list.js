'use strict';

const Users = require(__dirname + '/../../index.js').Users,
	async = require('async');

function run(req, res, cb) {
	res.data = {'global': res.globalData};
	const data = res.data,
		tasks = [];

	// Make sure the user have the correct rights
	// This is set in larvitadmingui controllerGlobal
	if ( ! res.adminRights) {
		cb(new Error('Invalid rights'));
		return;
	}

	data.global.menuControllerName	= 'adminUsers';
	data.pagination	= {};
	data.pagination.urlParsed	= data.global.urlParsed;
	data.pagination.elementsPerPage	= 100;

	tasks.push(function (cb) {
		const	users	= new Users({'db': req.userLib.db});

		//users.returnFields	= ['firstname', 'lastname'];
		users.limit	= data.pagination.elementsPerPage;
		users.offset	= parseInt(data.global.urlParsed.query.offset)	|| 0;

		if (isNaN(users.offset) || users.offset < 0) {
			users.offset = 0;
		}

		//if (data.global.urlParsed.query.filterStatus) {
		//	users.matchAllFields = {'status': data.global.urlParsed.query.filterStatus};
		//}

		users.get(function (err, result, totalElements) {
			data.users	= result;
			data.pagination.totalElements	= totalElements;
			cb(err);
		});
	});

	async.series(tasks, function (err) {
		cb(err);
	});
};

module.exports = run;
module.exports.run = run;
