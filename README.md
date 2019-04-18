[![Build Status](https://travis-ci.org/larvit/larvituser.svg?branch=master)](https://travis-ci.org/larvit/larvituser) [![Dependencies](https://david-dm.org/larvit/larvituser.svg)](https://david-dm.org/larvit/larvituser.svg)

# larvituser

User module for node.js

## Basic usage

First fire up the library connections like this:

```javascript
const	UserLib	= require('larvituser'),
	Intercom	= require('larvitamintercom'),
	winston	= require('winston'),
	log	= winston.createLogger({'transports': [new winston.transports.Console()]}),
	userLib = new UserLib({
		'db':	require('larvitdb'),

		// Optional parameters
		'mode':	'noSync', // Other options are "master" or "slave"
		'intercom':	new Intercom({'conStr': 'loopback interface', 'log': log}),
		'log':	log
	});

db.setup(...); // See https://github.com/larvit/larvitdb for configuration details
```

Create a new user in the database, do like this:

```javascript
const userData = {
	'firstname':	'Nisse',
	'lastname':	'Nilsson',
	'role': [
		'user',
		'subscriber'
	]
}

userLib.create('myUsername', 'myPassword', userData, function (err, user) {
	console.log('New user UUID: ' + user.uuid);
});
```

When creating a new user you can also give the user a uuid of your choice:

```javascript

const uuidLib	= require('uuid');
const uuid = uuidLib.v1();
const userData = {
	'firstname':	'Nisse',
	'lastname':	'Nilsson',
	'role': [
		'user',
		'subscriber'
	]
}

userLib.create('myUsername', 'myPassword', userData, uuid, function (err, user) {
	console.log('New user UUID: ' + user.uuid);
});
```

To fetch a user from database based on username and password, do like this:

```javascript
userLib.fromUserAndPass('myUsername', 'myPassword', function (err, user) {
	if (err) {
		throw err;
	}

	if ( ! user) {
		// No match found, or other more serious error
	} else {
		console.log('Fetched user ID: ' + user.id);
	}
});
```

List multiple users

```javascript
const	users	= new UserLib.Users({'db': db, 'log': log});

users.get(function (err, userList) {
	if (err) throw err;

	console.log(userList); // An array of objects
});
```

Get distinct values for field from all users

```javascript
const	users	= new UserLib.Users({'db': db, 'log': log});

users.getFieldData('fieldName', function (err, result) {
	if (err) throw err;

	console.log(userList); // An array of strings
});
```

### Advanced usage

#### Add data to a user

```javascript
userLib.addUserDataField(userUuid, fieldName, fieldValue, function (err) {
	// Field have been added
});
```

#### Check a password for validity

```javascript
userLib.checkPassword('passwordToTest', 'theHashToTestAgainst', function (err, result) {
	// Result being either true or false
});
```

#### Create a new user

```javascript
userLib.create('username', 'password', {'firstname': 'John', 'lastname': 'Smith'}, function (err, user) {
	console.log(user.uuid); // 91f15599-c1fa-4051-9e0e-906cab9819fe (or rather, a random Uuid)
});
```

Or set an Uuid manually like this:

```javascript
userLib.create('username', 'password', {'firstname': 'John', 'lastname': 'Smith'}, 'f9684592-b245-42fa-88c6-9f16b9236ac3', function (err, user) {
	console.log(user.uuid); // f9684592-b245-42fa-88c6-9f16b9236ac3
});
```

#### Fetch a user based on a field

Will fetch the first occurance in the database with this field name and field value.

```javascript
userLib.fromField('firstname', 'John', function (err, user) {
	console.log(user.uuid); // f9684592-b245-42fa-88c6-9f16b9236ac3
});
```

#### Fetch a user based on several fields

Will fetch the first occurance in the database that matches all these field names and field values

```javascript
userLib.fromFields({'firstname': 'John', 'lastname': 'Smith'}, function (err, user) {
	console.log(user.uuid); // f9684592-b245-42fa-88c6-9f16b9236ac3
});
```

#### Fetch a user based on just username

```javascript
userLib.fromUsername('username', function (err, user) {
	console.log(user.uuid); // f9684592-b245-42fa-88c6-9f16b9236ac3 or user will be false if no user is found
});
```

#### Fetch a user from Uuid

```javascript
userLib.fromUuid('f9684592-b245-42fa-88c6-9f16b9236ac3', function (err, user) {
	console.log(user.uuid); // f9684592-b245-42fa-88c6-9f16b9236ac3
});
```

#### Get field data from a user

```javascript
userLib.getFieldData('f9684592-b245-42fa-88c6-9f16b9236ac3', 'firstname', function (err, data) {
	console.log(data); // ['John'] - Observe this will always be an array with values, since a field can hold several values
});
```

#### Replace user fields for a user

IMPORTANT!!! Will clear all data not given in the fields parameter

```javascript
userLib.replaceUserFields('f9684592-b245-42fa-88c6-9f16b9236ac3', {'lastname': ['Smith', 'Johnsson']}, function (err) {
	// The field "lastname" will now be replaced with the two values "Smith" and "Johnsson"
	// And all other fields will be removed

	userLib.getFieldData('f9684592-b245-42fa-88c6-9f16b9236ac3', 'lastname', function (err, data) {
		console.log(data); // ['Smith', 'Johnsson']
	});
});
```

#### Remove a field from a user

```javascript
userLib.rmUserField('f9684592-b245-42fa-88c6-9f16b9236ac3', 'lastname', function (err) {
	userLib.fromUuid('f9684592-b245-42fa-88c6-9f16b9236ac3', function (err, user) {
		console.log(user.fields); // {'firstname': ['John']}
	});
});
```

#### Set password for a user

```javascript
userLib.setPassword('f9684592-b245-42fa-88c6-9f16b9236ac3', 'newSuperSecretPwd', function (err) {
	// Now the users password is updated to "newSuperSecretPwd"
});
```

To disable a login, use boolean false as the new password:

```javascript
userLib.setPassword('f9684592-b245-42fa-88c6-9f16b9236ac3', false, function (err) {
	// This user can no longer login
});
```

#### Set username for a user

```javascript
userLib.setUsername('f9684592-b245-42fa-88c6-9f16b9236ac3', 'theNewUsername', function (err) {
	// Now the users username is updated to "theNewUsername"
});
```

## Tests

Run tests with mocha, make sure to have an empty database configured for tests to pass correctly!

The default config file will be _application path_/config/db_test.json

Or a custom one can be used by running

```bash
mocha test/test.js /path/to/config/db_another.json
```
