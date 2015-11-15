# larvituser

User module for node.js

## Usage

First fire up the library connections like this:

```javascript
var userLib = require('larvituser');
```

Create a new user in the database, do like this:

```javascript
var userData = {
    'firstname': 'Nisse',
    'lastname': 'Nilsson',
    'role': [
        'user',
        'subscriber'
    ]
}

userLib.create('myUsername', 'myPassword', userData, function(err, user) {
    console.log('New user UUID: ' + user.uuid);
});
```

To fetch a user from database based on username and password, do like this:

```javascript
userLib.fromUserAndPass('myUsername', 'myPassword', function(err, user) {
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

## Tests

Run tests with mocha, make sure to have an empty database configured for tests to pass correctly!

The default config file will be _application path_/config/db_test.json

Or a custom one can be used by running

```bash
mocha test/test.js /path/to/config/db_another.json
```
