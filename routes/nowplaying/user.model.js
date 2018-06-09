const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  id: {
    type: String,
    required: true,
    unique: true,
  },
  spotify: {
    scope: [String], //list of permissions basically
    access_token: String,
    refresh_token: String,
    valid_until: Date,
  }
});

module.exports = mongoose.model('User', userSchema);
