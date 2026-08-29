const assert = require('assert');
const { makeHash, verifyPassword, needsRehash } = require('../utils/password');

const password = 'Prueba-OSPMSegura-123';
const hash = makeHash(password);
assert.ok(hash.startsWith('$scrypt$'));
assert.strictEqual(verifyPassword(password, hash), true);
assert.strictEqual(verifyPassword('incorrecta', hash), false);
assert.strictEqual(needsRehash(hash), false);

// Hash legado usado por el seed original: contraseña "admin123".
const legacy = '$s256$0123456789ABCDEF0123456789ABCDEF$B00BDB3F47BE7BDE1183F94793126A7D9F29F46A24BB72352B55378CE773F428';
assert.strictEqual(verifyPassword('admin123', legacy), true);
assert.strictEqual(needsRehash(legacy), true);
console.log('OK hashing de contraseñas y compatibilidad legacy');
