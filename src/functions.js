'use strict';

function user({uuid, username, password}, a, b) {
	const foundUser = usersData.find(user => user.uuid === uuid);

	if (!foundUser) return foundUser;

	return {
		uuid: foundUser.uuid,
		username: foundUser.username,
		fields: function fields({fieldNames}) {
			if (fieldNames === undefined) return foundUser.fields;

			const result = [];

			foundUser.fields.forEach(field => {
				if (fieldNames.includes(field.name)) {
					result.push(field);
				}
			});

			return result;
		}
	}
}

function users(args, a, b) {
	const {uuids, usernames, q_or, q_and} = args;

	console.log('args:');
	console.log(args);

	/*
	console.log('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
	console.log(a);

	console.log('BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB');
	console.log(b);

	console.log('--------');
	console.log('--------');
	console.log('--------');
	console.log('--------');
	console.log('--------');
	*/

	return usersData;

	//return usersData.filter(user => {
	//	if (uuids !== undefined) {
	//		for (let i = 0; uuids.length !== i; i++) {
	//			const uuid = uuids[i];

	//			console.log('Checking "' + uuid + '" against user.uuid: "' + user.uuid + '"');

	//			if (uuid === user.uuid) return true;
	//		}
	//	}
	//	return false;
	//});
}

function createUser() {}
function replaceUser() {}
function updateUser() {}
function replaceUserField() {}
function addUserField() {}
function rmUserField() {}

exports.user = user;
exports.users = users;
exports.createUser = createUser;
exports.replaceUser = replaceUser;
exports.updateUser = updateUser;
exports.replaceUserField = replaceUserField;
exports.addUserField = addUserField;
exports.rmUserField = rmUserField;
