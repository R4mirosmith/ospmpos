const crypto = require('crypto');

function sha256Hex(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex').toUpperCase();
}

function makeHash(password) {
  const salt = crypto.randomBytes(16).toString('hex').toUpperCase();
  return `$s256$${salt}$${sha256Hex(salt + password)}`;
}

function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length >= 4 && parts[1] === 's256') {
    const salt = parts[2];
    const expected = parts[3];
    return sha256Hex(salt + password) === expected;
  }
  // Compatibilidad simple para semillas antiguas muy básicas.
  return stored === password;
}

module.exports = { makeHash, verifyPassword };
