const assert = require('assert');
const path = require('path');

const backendRoot = path.resolve(__dirname, '..');
const jwtPath = require.resolve(path.join(backendRoot, 'utils', 'jwt.js'));
let payload = null;
require.cache[jwtPath] = {
  id: jwtPath,
  filename: jwtPath,
  loaded: true,
  exports: { verifyAccess: () => payload },
};

const { requireAuth, requireAuthAllowTemp } = require('../middleware/authJwt');

function resMock() {
  return {
    statusCode: 0,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return body; },
  };
}

function run(middleware, tokenPayload) {
  payload = tokenPayload;
  const req = { headers: { authorization: 'Bearer fake' } };
  const res = resMock();
  let nextCalled = false;
  middleware(req, res, () => { nextCalled = true; });
  return { req, res, nextCalled };
}

let r = run(requireAuth, { id: 1, role: 'ADMIN', temp_login: true });
assert.strictEqual(r.nextCalled, false);
assert.strictEqual(r.res.statusCode, 401);

r = run(requireAuthAllowTemp, { id: 1, role: 'ADMIN', temp_login: true });
assert.strictEqual(r.nextCalled, true);
assert.strictEqual(r.req.user.id, 1);

r = run(requireAuth, { id: 2, role: 'VENDEDOR', sede_id: 3 });
assert.strictEqual(r.nextCalled, true);
assert.strictEqual(r.req.user.sede_id, 3);

console.log('OK token temporal restringido a selección de sede');
