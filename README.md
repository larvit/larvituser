[![Build Status](https://travis-ci.org/larvit/larvituser.svg?branch=master)](https://travis-ci.org/larvit/larvituser) [![Dependencies](https://david-dm.org/larvit/larvituser.svg)](https://david-dm.org/larvit/larvituser.svg)

# larvituser

User module for node.js

## Basic usage

First fire up the library connections like this:

```javascript
const UserLib = require('larvituser'),
	Intercom = require('larvitamintercom'),
	winston = require('winston'),
	log = winston.createLogger({'transports': [new winston.transports.Console()]}),
	userLib = new UserLib({
		'db': require('larvitdb'),

		// Optional parameters
		'log': log
	});

db.setup(...); // See https://github.com/larvit/larvitdb for configuration details
```

Create a new user in the database, do like this:

```javascript
const userData = {
	'firstname': 'Nisse',
	'lastname': 'Nilsson',
	'role': [
		'user',
		'subscriber'
	]
}

const user = await userLib.create('myUsername', 'myPassword', userData);
console.log('New user UUID: ' + user.uuid);
```

When creating a new user you can also give the user a uuid of your choice:

```javascript

const uuidLib = require('uuid');
const uuid = uuidLib.v1();
const userData = {
	'firstname': 'Nisse',
	'lastname': 'Nilsson',
	'role': [
		'user',
		'subscriber'
	]
}
const user = await userLib.create('myUsername', 'myPassword', userData, uuid);
console.log('New user UUID: ' + user.uuid);
```

To fetch a user from database based on username and password, do like this:

```javascript
const user = await userLib.fromUserAndPass('myUsername', 'myPassword');
if ( ! user) {
	// No match found, or other more serious error
} else {
	console.log('Fetched user ID: ' + user.id);
}
```

List multiple users

```javascript
const users = new UserLib.Users({'db': db, 'log': log});

const result = await users.get();
console.log(result.users); // An array of objects
```

Get distinct values for field from all users

```javascript
const users = new UserLib.Users({'db': db, 'log': log});

const result = await users.getFieldData('fieldName');
console.log(result); // An array of strings
```

List multiple users ordered by field

```javascript
const users = new UserLib.Users({'db': db, 'log': log});

users.order = {
	by: 'username', // Sorting by something else than uuid or username the field needs to be included in "returnFields"
	direction: 'desc' // "asc" is default
}

const result = await users.get();
console.log(result.users); // An array of objects
```

### Advanced usage

#### Add data to a user

```javascript
await userLib.addUserDataField(userUuid, fieldName, fieldValue);
```

#### Check a password for validity

```javascript
const isValid = await userLib.checkPassword('passwordToTest', 'theHashToTestAgainst');
```

#### Create a new user

```javascript
const user = await userLib.create('username', 'password', {'firstname': 'John', 'lastname': 'Smith'});console.log(user.uuid); // 91f15599-c1fa-4051-9e0e-906cab9819fe (or rather, a random Uuid)
```

Or set an Uuid manually like this:

```javascript
const user = await userLib.create('username', 'password', {'firstname': 'John', 'lastname': 'Smith'}, 'f9684592-b245-42fa-88c6-9f16b9236ac3');
console.log(user.uuid); // f9684592-b245-42fa-88c6-9f16b9236ac3
```

#### Fetch a user based on a field

Will fetch the first occurance in the database with this field name and field value.

```javascript
const user = await userLib.fromField('firstname', 'John');
console.log(user.uuid); // f9684592-b245-42fa-88c6-9f16b9236ac3
```

#### Fetch a user based on several fields

Will fetch the first occurance in the database that matches all these field names and field values

```javascript
const user = await userLib.fromFields({'firstname': 'John', 'lastname': 'Smith'});
console.log(user.uuid); // f9684592-b245-42fa-88c6-9f16b9236ac3
```

#### Fetch a user based on just username

```javascript
const user = await userLib.fromUsername('username');
console.log(user.uuid); // f9684592-b245-42fa-88c6-9f16b9236ac3 or user will be false if no user is found
```

#### Fetch a user from Uuid

```javascript
const user = await userLib.fromUuid('f9684592-b245-42fa-88c6-9f16b9236ac3');
console.log(user.uuid); // f9684592-b245-42fa-88c6-9f16b9236ac3
```

#### Get field data from a user

```javascript
const data = await userLib.getFieldData('f9684592-b245-42fa-88c6-9f16b9236ac3', 'firstname');
console.log(data); // ['John'] - Observe this will always be an array with values, since a field can hold several values
```

#### Replace user fields for a user

IMPORTANT!!! Will clear all data not given in the fields parameter

```javascript
await userLib.replaceUserFields('f9684592-b245-42fa-88c6-9f16b9236ac3', {'lastname': ['Smith', 'Johnsson']});
// The field "lastname" will now be replaced with the two values "Smith" and "Johnsson"
// And all other fields will be removed

const data = await userLib.getFieldData('f9684592-b245-42fa-88c6-9f16b9236ac3', 'lastname');
console.log(data); // ['Smith', 'Johnsson']
```

#### Remove a field from a user

```javascript
await userLib.rmUserField('f9684592-b245-42fa-88c6-9f16b9236ac3', 'lastname');
const user = await userLib.fromUuid('f9684592-b245-42fa-88c6-9f16b9236ac3');
console.log(user.fields); // {'firstname': ['John']}
```

#### Set password for a user

```javascript
await userLib.setPassword('f9684592-b245-42fa-88c6-9f16b9236ac3', 'newSuperSecretPwd');
```

To disable a login, use boolean false as the new password:

```javascript
await userLib.setPassword('f9684592-b245-42fa-88c6-9f16b9236ac3', false);
```

#### Set username for a user

```javascript
await userLib.setUsername('f9684592-b245-42fa-88c6-9f16b9236ac3', 'theNewUsername');
```

### Errors
All functions in the API will throw an exception upon error.

For instance:

```javascript
const user1 = await userLib.create('nisse', false);
const user2 = await userLib.create('olle', false);

try {
	await user2.setUsername('nisse'); // Will throw since username "nisse" is already taken
} catch (err) {
	console.error(err);
}
```

## Tests

Run tests with ```npm test```, make sure to have an empty database configured for tests to pass correctly!

The default config file will be _application path_/config/db_test.json

Or a custom one can be used by running

```bash
DBCONFFILE=/path/to/config/db_another.json mocha test/test.js
```
