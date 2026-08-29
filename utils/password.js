const crypto = require('crypto');

const SCRYPT_KEYLEN = 64;

function sha256Hex(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex').toUpperCase();
}

function safeEqualText(a, b) {
  const left = Buffer.from(String(a), 'utf8');
  const right = Buffer.from(String(b), 'utf8');
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function makeHash(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, SCRYPT_KEYLEN).toString('hex');
  return `$scrypt$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string') return false;
  const parts = stored.split('$');

  if (parts.length >= 4 && parts[1] === 'scrypt') {
    const salt = parts[2];
    const expected = parts[3];
    try {
      const actual = crypto.scryptSync(String(password), salt, SCRYPT_KEYLEN).toString('hex');
      return safeEqualText(actual, expected);
    } catch {
      return false;
    }
  }

  // Compatibilidad con usuarios creados por versiones anteriores.
  if (parts.length >= 4 && parts[1] === 's256') {
    const salt = parts[2];
    const expected = parts[3];
    return safeEqualText(sha256Hex(salt + password), expected);
  }

  // Compatibilidad temporal con semillas históricas que pudieran guardar texto plano.
  return safeEqualText(stored, String(password));
}

function needsRehash(stored) {
  return !String(stored || '').startsWith('$scrypt$');
}

module.exports = { makeHash, verifyPassword, needsRehash };
