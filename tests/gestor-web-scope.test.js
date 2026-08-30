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

const { gestorWebScope } = require('../middleware/gestorWebScope');

function resMock() {
  return {
    statusCode: 0,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return body; },
  };
}

function run(method, requestPath, role) {
  payload = { id: 9, role, sede_id: 1 };
  const req = {
    method,
    path: requestPath,
    headers: { authorization: 'Bearer fake' },
  };
  const res = resMock();
  let nextCalled = false;
  gestorWebScope(req, res, () => { nextCalled = true; });
  return { res, nextCalled };
}

assert.strictEqual(run('GET', '/api/productos', 'GESTOR_WEB').nextCalled, true);
assert.strictEqual(run('PATCH', '/api/productos/1', 'GESTOR_WEB').nextCalled, true);
assert.strictEqual(run('GET', '/api/pedidos-web', 'GESTOR_WEB').nextCalled, true);
assert.strictEqual(run('PATCH', '/api/pedidos-web/1/confirmar', 'GESTOR_WEB').nextCalled, true);
assert.strictEqual(run('PATCH', '/api/pedidos-web/1/cancelar', 'GESTOR_WEB').nextCalled, true);
assert.strictEqual(run('PATCH', '/api/pedidos-web/1/estado', 'GESTOR_WEB').nextCalled, true);
assert.strictEqual(run('POST', '/api/pedidos-web/1/facturar', 'GESTOR_WEB').nextCalled, true);
assert.strictEqual(run('GET', '/api/pedidos-web/ventas-realizadas', 'GESTOR_WEB').nextCalled, true);
assert.strictEqual(run('GET', '/api/categorias', 'GESTOR_WEB').nextCalled, true);

let r = run('POST', '/api/categorias', 'GESTOR_WEB');
assert.strictEqual(r.nextCalled, false);
assert.strictEqual(r.res.statusCode, 403);

r = run('GET', '/api/ventas', 'GESTOR_WEB');
assert.strictEqual(r.nextCalled, false);
assert.strictEqual(r.res.statusCode, 403);

r = run('GET', '/api/reportes/admin-resumen', 'GESTOR_WEB');
assert.strictEqual(r.nextCalled, false);
assert.strictEqual(r.res.statusCode, 403);

assert.strictEqual(run('GET', '/api/ventas', 'ADMIN').nextCalled, true);
assert.strictEqual(run('GET', '/api/ventas', 'VENDEDOR').nextCalled, true);

console.log('OK alcance de GESTOR_WEB restringido a módulos web');
