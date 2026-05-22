const jwt = require('jsonwebtoken');
const config = require('../config');

function signAccess(payload) {
  return jwt.sign(payload, config.jwt.secret, { expiresIn: config.jwt.expires });
}

function signRefresh(payload) {
  return jwt.sign(payload, config.jwt.refreshSecret, { expiresIn: config.jwt.refreshExpires });
}

function verifyAccess(token) { return jwt.verify(token, config.jwt.secret); }
function verifyRefresh(token) { return jwt.verify(token, config.jwt.refreshSecret); }

module.exports = { signAccess, signRefresh, verifyAccess, verifyRefresh };
