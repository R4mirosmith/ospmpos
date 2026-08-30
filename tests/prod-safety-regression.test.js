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

// productos.controller usa config para rutas de uploads; en esta prueba no necesitamos
// cargar dotenv ni configuración real.
const configPath = require.resolve(path.join(backendRoot, 'config.js'));
require.cache[configPath] = {
  id: configPath,
  filename: configPath,
  loaded: true,
  exports: { uploads: { dir: '/tmp/ospm-test-uploads' }, public: { defaultSedeId: 1 } },
};
const productos = require('../controllers/productos.controller');
const realtimePath = require.resolve(path.join(backendRoot, 'realtime.js'));
require.cache[realtimePath] = {
  id: realtimePath,
  filename: realtimePath,
  loaded: true,
  exports: { emitPedidoWebNuevo: async () => {} },
};
const publicController = require('../controllers/public.controller');

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


async function testGestorWebConfirmarNoDescuentaInventario() {
  let getConnectionCalled = false;
  let updated = false;
  fakePool.getConnection = async () => {
    getConnectionCalled = true;
    throw new Error('Confirmar no debe abrir una transacción de venta');
  };
  fakePool.query = async (sql, params) => {
    if (/SELECT p\.id_pedido_web, p\.empresa_id/i.test(sql)) {
      return [[{
        id_pedido_web: 12,
        empresa_id: 1,
        sede_id: 2,
        venta_id: null,
        estado: 'PENDIENTE',
      }]];
    }
    if (/UPDATE pedidos_web p/i.test(sql)) {
      updated = true;
      assert.strictEqual(params[0], 'CONFIRMADO');
      return [{ affectedRows: 1 }];
    }
    throw new Error(`SQL inesperado confirmar GESTOR_WEB: ${sql}`);
  };

  const req = reqBase({ observacion_interna: 'Cliente validado' });
  req.user.role = 'GESTOR_WEB';
  req.params.id = '12';
  const res = resMock();

  await pedidosWeb.confirmar(req, res);

  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.result.estado, 'CONFIRMADO');
  assert.strictEqual(res.body.result.venta_id, null);
  assert.strictEqual(updated, true);
  assert.strictEqual(getConnectionCalled, false);
}

async function testGestorWebFacturarCreaVentaWebYDescuentaStockUnaVez() {
  activeSedePool();
  let committed = false;
  let rolledBack = false;
  let inventoryMovements = 0;
  let facturado = false;
  let ventaCanalWeb = false;

  fakePool.getConnection = async () => ({
    beginTransaction: async () => {},
    commit: async () => { committed = true; },
    rollback: async () => { rolledBack = true; },
    release: () => {},
    query: async (sql, params) => {
      if (/FROM pedidos_web\s+WHERE id_pedido_web/i.test(sql)) {
        return [[{
          id_pedido_web: 12,
          empresa_id: 1,
          sede_id: 2,
          venta_id: null,
          estado: 'CONFIRMADO',
          cliente_direccion: 'Calle 1',
        }]];
      }
      if (/FROM pedidos_web_detalle/i.test(sql)) {
        return [[{
          id_pedido_web_detalle: 1,
          producto_id: 10,
          nombre_producto: 'Producto web',
          precio: 25000,
          cantidad: 2,
          subtotal: 50000,
        }]];
      }
      if (/FROM cliente/i.test(sql)) return [[{ id: 9 }]];
      if (/INSERT INTO venta\(/i.test(sql)) {
        ventaCanalWeb = /'WEB'/i.test(sql);
        return [{ insertId: 120 }];
      }
      if (/SELECT id,nombre,codigo FROM producto/i.test(sql)) {
        return [[{ id: 10, nombre: 'Producto web', codigo: 'PW10' }]];
      }
      if (/SELECT COALESCE\(SUM\(cantidad\),0\) stock/i.test(sql)) return [[{ stock: 7 }]];
      if (/INSERT INTO venta_detalle/i.test(sql)) return [{ insertId: 1 }];
      if (/INSERT INTO inv_movimiento/i.test(sql)) {
        inventoryMovements += 1;
        assert.strictEqual(Number(params[6]), -2);
        return [{ insertId: 1 }];
      }
      if (/UPDATE venta SET subtotal=/i.test(sql)) return [{ affectedRows: 1 }];
      if (/UPDATE pedidos_web/i.test(sql) && /estado='FACTURADO'/i.test(sql)) {
        facturado = true;
        return [{ affectedRows: 1 }];
      }
      throw new Error(`SQL inesperado facturar GESTOR_WEB: ${sql}`);
    },
  });

  const req = reqBase({ observacion_interna: 'Facturado desde gestión web' });
  req.user.role = 'GESTOR_WEB';
  req.params.id = '12';
  const res = resMock();

  await pedidosWeb.facturar(req, res);

  assert.strictEqual(res.statusCode, 201);
  assert.strictEqual(res.body.result.venta_id, 120);
  assert.strictEqual(res.body.result.canal, 'WEB');
  assert.strictEqual(res.body.result.estado_pedido, 'FACTURADO');
  assert.strictEqual(inventoryMovements, 1);
  assert.strictEqual(facturado, true);
  assert.strictEqual(ventaCanalWeb, true);
  assert.strictEqual(committed, true);
  assert.strictEqual(rolledBack, false);
}

async function testGestorWebSoloListaSusVentasWeb() {
  const consultas = [];
  fakePool.query = async (sql, params) => {
    consultas.push({ sql, params });
    if (/SELECT COUNT\(\*\) total/i.test(sql)) return [[{ total: 1 }]];
    if (/SELECT v\.id venta_id/i.test(sql)) {
      return [[{
        venta_id: 120,
        id_pedido_web: 12,
        total: 50000,
        canal: 'WEB',
        pedido_estado: 'FACTURADO',
      }]];
    }
    throw new Error(`SQL inesperado ventas web: ${sql}`);
  };

  const req = reqBase({});
  req.user.role = 'GESTOR_WEB';
  req.user.id = 7;
  req.query = { page: 1, pageSize: 20 };
  const res = resMock();
  await pedidosWeb.ventasRealizadas(req, res);

  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.result.total, 1);
  assert.strictEqual(res.body.result.items[0].canal, 'WEB');
  assert(consultas.every(({ sql }) => /v\.canal='WEB'/i.test(sql)));
  assert(consultas.every(({ sql }) => /v\.usuario_id=\?/i.test(sql)));
  assert(consultas.every(({ params }) => params.map(Number).includes(7)));
}


async function testGestorWebNoPuedeCrearProductoSinImagenPorEndpointJson() {
  const req = reqBase({
    categoria_id: 3,
    codigo: 'WEB-001',
    nombre: 'Producto web',
    descripcion: 'Prueba',
    stock_inicial: 25,
  });
  req.user.role = 'GESTOR_WEB';
  const res = resMock();
  await productos.crear(req, res);
  assert.strictEqual(res.statusCode, 400);
  assert(/al menos una imagen/i.test(res.body.result.message));
}

async function testCrearProductoConVariasImagenesObligatorias() {
  fakePool.query = async (sql) => {
    if (/FROM sede s\s+JOIN empresa/i.test(sql)) {
      return [[{ id: 2, empresa_id: 1, activo: 1, empresa_activa: 1 }]];
    }
    throw new Error(`pool.query inesperado producto con imágenes: ${sql}`);
  };

  let productInsertParams = null;
  let imageInsertCount = 0;
  let inventoryInserted = false;
  fakePool.getConnection = async () => ({
    beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {},
    query: async (sql, params) => {
      if (/SELECT id FROM categoria/i.test(sql)) return [[{ id: 3 }]];
      if (/SELECT id FROM producto WHERE sede_id=\?/i.test(sql)) return [[]];
      if (/INSERT INTO producto\(/i.test(sql)) {
        productInsertParams = params;
        return [{ insertId: 502 }];
      }
      if (/INSERT INTO producto_imagen/i.test(sql)) {
        imageInsertCount++;
        return [{ insertId: 600 + imageInsertCount }];
      }
      if (/INSERT INTO inv_movimiento/i.test(sql)) {
        inventoryInserted = true;
        return [{ insertId: 1 }];
      }
      throw new Error(`SQL inesperado producto con imágenes: ${sql}`);
    },
  });

  const req = reqBase({
    categoria_id: '3', codigo: 'WEB-IMG', nombre: 'Producto con imágenes', descripcion: 'Prueba',
    costo: '8000', precio: '12000', precio_m: '10000', stock_inicial: '20', stock_minimo: '1',
    colores_disponibles: JSON.stringify(['Negro', 'Azul']), codigo_autogenerado: '1',
  });
  req.user.role = 'GESTOR_WEB';
  req.files = [
    { originalname: 'frente.jpg', mimetype: 'image/jpeg', buffer: Buffer.from('img1') },
    { originalname: 'lado.png', mimetype: 'image/png', buffer: Buffer.from('img2') },
    { originalname: 'detalle.webp', mimetype: 'image/webp', buffer: Buffer.from('img3') },
  ];
  const res = resMock();
  await productos.crearConImagenes(req, res);

  assert.strictEqual(res.statusCode, 201);
  assert.strictEqual(res.body.result.uploaded.length, 3);
  assert.strictEqual(imageInsertCount, 3);
  assert.strictEqual(inventoryInserted, false);
  assert.deepStrictEqual(JSON.parse(productInsertParams[7]), ['Negro', 'Azul']);
  assert.strictEqual(Number(productInsertParams[8]), 0);
  assert.strictEqual(Number(productInsertParams[9]), 0);
  assert.strictEqual(Number(productInsertParams[10]), 0);

  const fs = require('fs');
  fs.rmSync('/tmp/ospm-test-uploads/products/502', { recursive: true, force: true });
}

async function testCrearProductoConImagenesExigeMinimoUna() {
  const req = reqBase({ categoria_id: 3, codigo: 'SIN-IMG', nombre: 'Sin imagen' });
  req.user.role = 'GESTOR_WEB';
  req.files = [];
  const res = resMock();
  await productos.crearConImagenes(req, res);
  assert.strictEqual(res.statusCode, 400);
  assert(/al menos una imagen/i.test(res.body.result.message));
}



async function testCrearProductoAutogeneraSkuSiVacio() {
  fakePool.query = async (sql) => {
    if (/FROM sede s\s+JOIN empresa/i.test(sql)) {
      return [[{ id: 2, empresa_id: 1, activo: 1, empresa_activa: 1 }]];
    }
    throw new Error(`pool.query inesperado SKU automático: ${sql}`);
  };

  let inserted = null;
  fakePool.getConnection = async () => ({
    beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {},
    query: async (sql, params) => {
      if (/SELECT id FROM categoria/i.test(sql)) return [[{ id: 3 }]];
      if (/SELECT id FROM producto WHERE sede_id=\?/i.test(sql)) return [[]];
      if (/INSERT INTO producto\(/i.test(sql)) { inserted = params; return [{ insertId: 700 }]; }
      if (/INSERT INTO producto_imagen/i.test(sql)) return [{ insertId: 701 }];
      throw new Error(`SQL inesperado SKU automático: ${sql}`);
    },
  });

  const req = reqBase({ categoria_id: '3', codigo: '', nombre: 'iPhone 15 Pro Max', descripcion: 'Prueba', codigo_autogenerado: '1' });
  req.user.role = 'GESTOR_WEB';
  req.files = [{ originalname: 'frente.jpg', mimetype: 'image/jpeg', buffer: Buffer.from('img') }];
  const res = resMock();
  await productos.crearConImagenes(req, res);

  assert.strictEqual(res.statusCode, 201);
  assert(/^IPHONE-15-PRO-MAX-\d{15}/.test(String(inserted[3])));
  assert.strictEqual(res.body.result.codigo, inserted[3]);
  require('fs').rmSync('/tmp/ospm-test-uploads/products/700', { recursive: true, force: true });
}

async function testApiPublicaProductoEntregaInformacionCompleta() {
  fakePool.query = async (sql, params) => {
    if (/FROM producto p/i.test(sql) && /WHERE p\.id=\?/i.test(sql)) {
      assert.strictEqual(Number(params[0]), 77);
      return [[{
        id: 77, codigo: 'PHONE-260830', codigo_barras: '77000077', nombre: 'Teléfono',
        descripcion: 'Equipo de prueba', garantia_info: '12 meses',
        colores_disponibles: JSON.stringify(['Negro', 'Azul']), precio: 900000, precio_m: 850000,
        categoria_id: 3, categoria_nombre: 'Celulares', video_url: '/productos/77/video/public/demo.mp4',
        video_duracion_segundos: 12.5, video_mime: 'video/mp4', stock: 4,
      }]];
    }
    if (/FROM producto_imagen/i.test(sql) && /producto_id IN/i.test(sql)) {
      return [[
        { id: 1, producto_id: 77, url: '/productos/77/imagenes/public/a.jpg', alt: 'Frente', es_principal: 1, orden: 0 },
        { id: 2, producto_id: 77, url: '/productos/77/imagenes/public/b.jpg', alt: 'Lado', es_principal: 0, orden: 1 },
      ]];
    }
    throw new Error(`SQL inesperado API pública producto: ${sql}`);
  };

  const req = reqBase();
  req.params = { id: '77' };
  req.query = { sede_id: '2' };
  const res = resMock();
  await publicController.productDetail(req, res);

  assert.strictEqual(res.statusCode, 200);
  const p = res.body.result;
  assert.deepStrictEqual(p.colores_disponibles, ['Negro', 'Azul']);
  assert.strictEqual(p.imagenes.length, 2);
  assert.strictEqual(p.imagen, '/productos/77/imagenes/public/a.jpg');
  assert.strictEqual(p.video.mime, 'video/mp4');
  assert.strictEqual(p.garantia_info, '12 meses');
  assert.strictEqual(Object.prototype.hasOwnProperty.call(p, 'costo'), false);
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
  testGestorWebConfirmarNoDescuentaInventario,
  testGestorWebFacturarCreaVentaWebYDescuentaStockUnaVez,
  testGestorWebSoloListaSusVentasWeb,
  testGestorWebNoPuedeCrearProductoSinImagenPorEndpointJson,
  testCrearProductoConVariasImagenesObligatorias,
  testCrearProductoConImagenesExigeMinimoUna,
  testCrearProductoAutogeneraSkuSiVacio,
  testApiPublicaProductoEntregaInformacionCompleta,
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
