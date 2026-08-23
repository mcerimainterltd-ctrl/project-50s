const mongoose = require('mongoose');
// User model is registered in server.js — retrieve it from Mongoose's registry
module.exports = mongoose.model('User');
