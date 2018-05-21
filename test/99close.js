'use strict';

after(function (done) {
	done();
	setTimeout(function () {
		process.exit();
	}, 500);
});
