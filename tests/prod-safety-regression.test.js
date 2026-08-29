'use strict';

const assert = require('assert');
const path = require('path');

const backendRoot = path.resolve(__dirname, '..');
const dbPoolPath = require.resolve(path.join(backendRoot, 'db', 'pool.js'));

const fakePool = {
  query: async () => { throw new Error('pool.query no configurado para esta prueba'); },
  getConnection: async () => { throw new Error('pool.getConnection no configurado para esta prueba'); },
};
require.cache[dbPoolPath] = {
  id: dbPoolPath,
  filename: dbPoolPath,
  loaded: true,
  exports: { pool: fakePool },
};

const inventario = require('../controllers/inventario.controller');
const ventas = require('../controllers/ventas.controller');
const pedidosWeb = require('../controllers/pedidosWeb.controller');
const compras = require('../controllers/compras.controller');

function resMock() {
  return {
    statusCode: 0,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return body; },
  };
}

function reqBase(body = {}) {
  return {
    body,
    query: {},
    params: {},
    headers: {},
    user: { id: 7, role: 'VENDEDOR', sede_id: 2, empresa_id: 1 },
  };
}

function activeSedePool() {
  fakePool.query = async (sql, params) => {
    if (/FROM sede s\s+JOIN empresa/i.test(sql)) {
      assert.strictEqual(Number(params[0]), 2);
      return [[{ id: 2, empresa_id: 1, activo: 1, empresa_activa: 1 }]];
    }
    throw new Error(`pool.query inesperado: ${sql}`);
  };
}

async function testAjusteNegativoResta() {
  activeSedePool();
  let inserted = null;
  let committed = false;
  const conn = {
    beginTransaction: async () => {},
    commit: async () => { committed = true; },
    rollback: async () => {},
    release: () => {},
    query: async (sql, params) => {
      if (/FROM producto/i.test(sql)) return [[{ id: 10, nombre: 'Producto', costo: 5 }]];
      if (/INSERT INTO inv_movimiento/i.test(sql)) {
        inserted = params;
        return [{ insertId: 101 }];
      }
      if (/COALESCE\(SUM\(cantidad\),0\) AS stock/i.test(sql)) return [[{ stock: 8 }]];
      throw new Error(`SQL inesperado ajuste negativo: ${sql}`);
    },
  };
  fakePool.getConnection = async () => conn;

  const req = reqBase({ producto_id: 10, cantidad: -2, motivo: 'Conteo físico' });
  const res = resMock();
  await inventario.ajuste(req, res);

  assert.strictEqual(committed, true);
  assert.strictEqual(inserted[4], 'OUT_AJUSTE');
  assert.strictEqual(inserted[5], -2);
  assert.strictEqual(res.statusCode, 201);
  assert.strictEqual(res.body.result.stock_nuevo, 8);
  assert.strictEqual(res.body.result.cantidad, -2);
}

async function testAjustePositivoSuma() {
  activeSedePool();
  let inserted = null;
  const conn = {
    beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {},
    query: async (sql, params) => {
      if (/FROM producto/i.test(sql)) return [[{ id: 10, nombre: 'Producto', costo: 5 }]];
      if (/INSERT INTO inv_movimiento/i.test(sql)) { inserted = params; return [{ insertId: 102 }]; }
      if (/COALESCE\(SUM\(cantidad\),0\) AS stock/i.test(sql)) return [[{ stock: 13 }]];
      throw new Error(`SQL inesperado ajuste positivo: ${sql}`);
    },
  };
  fakePool.getConnection = async () => conn;
  const res = resMock();
  await inventario.ajuste(reqBase({ producto_id: 10, cantidad: 3 }), res);
  assert.strictEqual(inserted[4], 'IN_AJUSTE');
  assert.strictEqual(inserted[5], 3);
  assert.strictEqual(res.body.result.stock_nuevo, 13);
}

async function testStockInicialNoDuplica() {
  activeSedePool();
  let rolledBack = false;
  const conn = {
    beginTransaction: async () => {}, commit: async () => {}, rollback: async () => { rolledBack = true; }, release: () => {},
    query: async (sql) => {
      if (/FROM producto/i.test(sql)) return [[{ id: 10, nombre: 'Producto', costo: 5 }]];
      if (/SELECT COUNT\(\*\) AS total\s+FROM inv_movimiento/i.test(sql)) return [[{ total: 1 }]];
      throw new Error(`SQL inesperado stock inicial: ${sql}`);
    },
  };
  fakePool.getConnection = async () => conn;
  let error;
  try { await inventario.stockInicial(reqBase({ producto_id: 10, cantidad: 5 }), resMock()); } catch (e) { error = e; }
  assert(error);
  assert.strictEqual(error.code, 'STOCK_INICIAL_YA_REGISTRADO');
  assert.strictEqual(rolledBack, true);
}

async function testPagoNoSuperaSaldo() {
  let insertedPayment = false;
  let rolledBack = false;
  fakePool.getConnection = async () => ({
    beginTransaction: async () => {}, commit: async () => {}, rollback: async () => { rolledBack = true; }, release: () => {},
    query: async (sql) => {
      if (/SELECT v\.\* FROM venta/i.test(sql)) return [[{ id: 44, total: 100, pagado: 80, estado: 'EMITIDA' }]];
      if (/INSERT INTO venta_pago/i.test(sql)) { insertedPayment = true; return [{ insertId: 1 }]; }
      throw new Error(`SQL inesperado pago: ${sql}`);
    },
  });
  const req = reqBase({ metodo: 'EFECTIVO', monto: 25 });
  req.params.id = '44';
  let error;
  try { await ventas.pagar(req, resMock()); } catch (e) { error = e; }
  assert(error);
  assert.strictEqual(error.code, 'PAGO_EXCEDE_SALDO');
  assert.strictEqual(insertedPayment, false);
  assert.strictEqual(rolledBack, true);
}

async function testAnularVentaRevierteVentaYDevolucion() {
  const sqls = [];
  fakePool.getConnection = async () => ({
    beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {},
    query: async (sql) => {
      sqls.push(sql);
      if (/UPDATE venta v SET/i.test(sql)) return [{ affectedRows: 1 }];
      return [{ affectedRows: 1 }];
    },
  });
  const req = reqBase({ motivo: 'Prueba' });
  req.params.id = '77';
  await ventas.anular(req, resMock());
  assert(sqls.some(s => /UPDATE inv_movimiento SET activo=0 WHERE venta_id=\?/i.test(s)));
  assert(sqls.some(s => /UPDATE devolucion_venta SET activo=0 WHERE venta_id=\?/i.test(s)));
  assert(sqls.some(s => /UPDATE venta_pago SET anulado=1/i.test(s)));
}

async function testPedidoFacturadoEsIdempotente() {
  activeSedePool();
  const sqls = [];
  let committed = false;
  fakePool.getConnection = async () => ({
    beginTransaction: async () => {}, commit: async () => { committed = true; }, rollback: async () => {}, release: () => {},
    query: async (sql) => {
      sqls.push(sql);
      if (/FROM pedidos_web\s+WHERE id_pedido_web/i.test(sql)) return [[{ id_pedido_web: 5, venta_id: 55, estado: 'CONVERTIDO' }]];
      if (/FROM venta WHERE id=/i.test(sql)) return [[{ id: 55, subtotal: 50, total: 50, saldo: 50, cliente_id: 9 }]];
      throw new Error(`SQL inesperado idempotencia pedido: ${sql}`);
    },
  });
  const req = reqBase({});
  req.params.id = '5';
  const res = resMock();
  await pedidosWeb.facturar(req, res);
  assert.strictEqual(committed, true);
  assert.strictEqual(res.body.result.venta_id, 55);
  assert.strictEqual(res.body.result.already_converted, true);
  assert.strictEqual(sqls.some(s => /INSERT INTO inv_movimiento/i.test(s)), false);
}

async function testPedidoSinStockHaceRollback() {
  activeSedePool();
  let rolledBack = false;
  let committed = false;
  fakePool.getConnection = async () => ({
    beginTransaction: async () => {}, commit: async () => { committed = true; }, rollback: async () => { rolledBack = true; }, release: () => {},
    query: async (sql) => {
      if (/FROM pedidos_web\s+WHERE id_pedido_web/i.test(sql)) return [[{ id_pedido_web: 6, venta_id: null, estado: 'CONFIRMADO', cliente_direccion: 'X' }]];
      if (/FROM pedidos_web_detalle/i.test(sql)) return [[{ id_pedido_web_detalle: 1, producto_id: 10, nombre_producto: 'P1', precio: 20, cantidad: 3 }]];
      if (/FROM cliente/i.test(sql)) return [[{ id: 9 }]];
      if (/INSERT INTO venta\(/i.test(sql)) return [{ insertId: 88 }];
      if (/FROM producto WHERE/i.test(sql)) return [[{ id: 10, nombre: 'P1', codigo: 'P1' }]];
      if (/FROM inv_movimiento/i.test(sql)) return [[{ stock: 2 }]];
      throw new Error(`SQL inesperado falta stock: ${sql}`);
    },
  });
  const req = reqBase({}); req.params.id = '6';
  let error;
  try { await pedidosWeb.facturar(req, resMock()); } catch (e) { error = e; }
  assert(error);
  assert.strictEqual(error.code, 'STOCK_INSUFICIENTE');
  assert.strictEqual(rolledBack, true);
  assert.strictEqual(committed, false);
}


async function testAjusteNegativoNoPermiteStockMenorACero() {
  activeSedePool();
  let inserted = false;
  let rolledBack = false;
  const conn = {
    beginTransaction: async () => {}, commit: async () => {}, rollback: async () => { rolledBack = true; }, release: () => {},
    query: async (sql) => {
      if (/FROM producto/i.test(sql)) return [[{ id: 10, nombre: 'Producto', costo: 5 }]];
      if (/COALESCE\(SUM\(cantidad\),0\) AS stock/i.test(sql)) return [[{ stock: 1 }]];
      if (/INSERT INTO inv_movimiento/i.test(sql)) { inserted = true; return [{ insertId: 103 }]; }
      throw new Error(`SQL inesperado ajuste sin stock: ${sql}`);
    },
  };
  fakePool.getConnection = async () => conn;
  let error;
  try { await inventario.ajuste(reqBase({ producto_id: 10, cantidad: -2 }), resMock()); } catch (e) { error = e; }
  assert(error);
  assert.strictEqual(error.code, 'STOCK_INSUFICIENTE');
  assert.strictEqual(inserted, false);
  assert.strictEqual(rolledBack, true);
}

async function testAnularCompraNoDejaStockNegativo() {
  let rolledBack = false;
  let compraUpdated = false;
  fakePool.getConnection = async () => ({
    beginTransaction: async () => {}, commit: async () => {}, rollback: async () => { rolledBack = true; }, release: () => {},
    query: async (sql) => {
      if (/FROM compra c/i.test(sql) && /FOR UPDATE/i.test(sql)) return [[{ id: 9, sede_id: 2 }]];
      if (/FROM inv_movimiento/i.test(sql) && /GROUP BY producto_id/i.test(sql)) return [[{ producto_id: 10, cantidad: 5 }]];
      if (/SELECT id FROM producto/i.test(sql)) return [[{ id: 10 }]];
      if (/COALESCE\(SUM\(cantidad\),0\) AS stock/i.test(sql)) return [[{ stock: 3 }]];
      if (/UPDATE compra SET activo=0/i.test(sql)) { compraUpdated = true; return [{ affectedRows: 1 }]; }
      throw new Error(`SQL inesperado anular compra: ${sql}`);
    },
  });
  const req = reqBase({});
  req.params.id = '9';
  let error;
  try { await compras.anular(req, resMock()); } catch (e) { error = e; }
  assert(error);
  assert.strictEqual(error.code, 'COMPRA_ANULACION_STOCK_INSUFICIENTE');
  assert.strictEqual(compraUpdated, false);
  assert.strictEqual(rolledBack, true);
}

async function testVentaRechazaPrecioManipulado() {
  activeSedePool();
  let inventoryInserted = false;
  let rolledBack = false;
  const conn = {
    beginTransaction: async () => {}, commit: async () => {}, rollback: async () => { rolledBack = true; }, release: () => {},
    query: async (sql) => {
      if (/FROM cliente/i.test(sql)) return [[{ id: 1 }]];
      if (/INSERT INTO venta\(/i.test(sql)) return [{ insertId: 90 }];
      if (/SELECT id,nombre,codigo,precio,precio_m FROM producto/i.test(sql)) {
        return [[{ id: 10, nombre: 'Producto', codigo: 'P10', precio: 20000, precio_m: 18000 }]];
      }
      if (/INSERT INTO inv_movimiento/i.test(sql)) { inventoryInserted = true; return [{ insertId: 1 }]; }
      throw new Error(`SQL inesperado precio manipulado: ${sql}`);
    },
  };
  fakePool.getConnection = async () => conn;
  const req = reqBase({ detalles: [{ producto_id: 10, cantidad: 1, precio_unitario: 100 }] });
  let error;
  try { await ventas.crear(req, resMock()); } catch (e) { error = e; }
  assert(error);
  assert.strictEqual(error.code, 'PRECIO_DESACTUALIZADO');
  assert.strictEqual(inventoryInserted, false);
  assert.strictEqual(rolledBack, true);
}

const tests = [
  testAjusteNegativoResta,
  testAjustePositivoSuma,
  testStockInicialNoDuplica,
  testPagoNoSuperaSaldo,
  testAnularVentaRevierteVentaYDevolucion,
  testPedidoFacturadoEsIdempotente,
  testPedidoSinStockHaceRollback,
  testAjusteNegativoNoPermiteStockMenorACero,
  testAnularCompraNoDejaStockNegativo,
  testVentaRechazaPrecioManipulado,
];

(async () => {
  for (const test of tests) {
    await test();
    console.log(`OK ${test.name}`);
  }
  console.log(`\n${tests.length}/${tests.length} pruebas críticas superadas`);
})().catch((err) => {
  console.error('FALLO', err);
  process.exitCode = 1;
});
