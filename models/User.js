const mongoose = require('mongoose');
// User model is registered in server.js — use lazy getter to avoid MissingSchemaError
let _User;
module.exports = new Proxy({}, {
    get(_, prop) {
        if (!_User) _User = mongoose.model('User');
        return _User[prop];
    },
    apply(_, thisArg, args) {
        if (!_User) _User = mongoose.model('User');
        return Reflect.apply(_User, thisArg, args);
    }
});
