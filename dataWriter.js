'use strict';

const	Intercom	= require('larvitamintercom').Intercom,
	conStr	= require(__dirname + '/config/amqp.json').default,
	intercom	= new Intercom(conStr),
	log	= require('winston');

/* TESTING STUFF - REMOVE !!1!1!! */

(function() {
	const intercom	= new Intercom(conStr);

	setInterval(function() {
		intercom.publish({'exchange': 'users'}, 'BAJSEN', function() {
			log.verbose('Delivered to all consumers!');
		});
	}, 500);
})();

/**********/

intercom.subscribe({'exchange': 'users'}, function(msg) {
	console.log(msg);
	console.log(msg.content.toString());
}, function(err) {
	if (err) {
		log.error('larvituser: dataWriter.js - Could not establish connection to queue, err: ' + err.message);
	}
});

/**
 * Get data field id by field name
 *
 * @param str fieldName
 * @param func cb(err, id)
 * /
function getFieldId(fieldName, cb) {
	checkDbStructure(function() {
		var sql = 'SELECT id FROM user_data_fields WHERE name = ?',
		    dbFields;

		fieldName = _.trim(fieldName);
		dbFields  = [fieldName];

		db.query(sql, dbFields, function(err, rows) {
			// Use INSERT IGNORE to avoid race conditions
			var sql = 'INSERT IGNORE INTO user_data_fields (name) VALUES(?)';

			if (err) {
				cb(err);
				return;
			}

			if (rows.length) {
				cb(null, rows[0].id);
			} else {
				db.query(sql, dbFields, function(err) {
					if (err) {
						cb(err);
						return;
					}

					// Rerun this function, it should return correct now!
					getFieldId(fieldName, function(err, id) {
						cb(err, id);
					});
				});
			}
		});
	});
}
/**/
