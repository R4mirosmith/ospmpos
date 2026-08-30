const { pool } = require('../utils/sql');
const { ok, created, badRequest } = require('../utils/http');
const { emitPedidoWebNuevo } = require('../realtime');
const config = require('../config');
const { attachProductImages } = require('../utils/productFields');

function publicSedeId(req) {
  return Number(req.query.sede_id || config.public.defaultSedeId);
}

async function categories(req, res) {
  const sedeId = publicSedeId(req);

  const [items] = await pool.query(
    `SELECT
       c.id,
       c.nombre,
       COUNT(p.id) AS total_productos
     FROM categoria c
     LEFT JOIN producto p
       ON p.categoria_id = c.id
      AND p.sede_id = c.sede_id
      AND p.activo = 1
     WHERE c.sede_id = ?
       AND c.activo = 1
     GROUP BY c.id, c.nombre
     ORDER BY c.nombre ASC`,
    [sedeId]
  );

  ok(res, items);
}

async function products(req, res) {
  const sedeId = publicSedeId(req);
  const categoriaId = Number(req.query.categoria_id || 0);
  const q = String(req.query.q || '').trim();
  const onlyAvailable = String(req.query.only_available || '') === '1';

  const where = ['p.sede_id=?', 'p.activo=1'];
  const params = [sedeId];

  if (categoriaId > 0) {
    where.push('p.categoria_id=?');
    params.push(categoriaId);
  }

  if (q) {
    const like = `%${q}%`;
    where.push('(p.nombre LIKE ? OR p.codigo LIKE ? OR p.descripcion LIKE ? OR p.colores_disponibles LIKE ? OR c.nombre LIKE ?)');
    params.push(like, like, like, like, like);
  }

  if (onlyAvailable) {
    where.push(`(
      SELECT COALESCE(SUM(m.cantidad),0)
      FROM inv_movimiento m
      WHERE m.producto_id=p.id
        AND m.sede_id=p.sede_id
        AND m.activo=1
    ) > 0`);
  }

  const [items] = await pool.query(
    `SELECT
       p.id,
       p.codigo,
       p.codigo_barras,
       p.nombre,
       p.descripcion,
       p.garantia_info,
       p.colores_disponibles,
       p.precio,
       p.precio_m,
       p.video_url,
       p.video_duracion_segundos,
       p.video_mime,
       p.categoria_id,
       c.nombre AS categoria_nombre,
       (SELECT COALESCE(SUM(m.cantidad),0)
          FROM inv_movimiento m
         WHERE m.producto_id=p.id
           AND m.sede_id=p.sede_id
           AND m.activo=1) AS stock
     FROM producto p
     LEFT JOIN categoria c ON c.id=p.categoria_id
     WHERE ${where.join(' AND ')}
     ORDER BY p.nombre`,
    params
  );

  const enriched = await attachProductImages(pool, items);
  ok(res, enriched);
}

// Detalle público completo del producto para OSPM Shopping.
// Expone información comercial, multimedia, stock y colores; nunca costos internos.
async function productDetail(req, res) {
  const sedeId = publicSedeId(req);
  const [rows] = await pool.query(
    `SELECT p.id, p.codigo, p.codigo_barras, p.nombre, p.descripcion, p.garantia_info, p.colores_disponibles,
            p.precio, p.precio_m, p.categoria_id, c.nombre AS categoria_nombre,
            p.video_url, p.video_duracion_segundos, p.video_mime,
            (SELECT COALESCE(SUM(m.cantidad),0)
               FROM inv_movimiento m
              WHERE m.producto_id=p.id AND m.sede_id=p.sede_id AND m.activo=1) AS stock
       FROM producto p
       LEFT JOIN categoria c ON c.id=p.categoria_id
      WHERE p.id=? AND p.sede_id=? AND p.activo=1
      LIMIT 1`,
    [Number(req.params.id), sedeId]
  );
  const enriched = await attachProductImages(pool, rows);
  ok(res, enriched[0] || null);
}

// IMPORTANTE: se conserva el flujo estable de creación + Socket.IO sin cambios funcionales.
async function createDeliveryOrder(req, res) {
  const body = req.body || {};
  const sedeId = Number(body.sede_id || req.query.sede_id || config.public.defaultSedeId);
  const [[sede]] = await pool.query(`SELECT id, empresa_id FROM sede WHERE id=? AND activo=1`, [sedeId]);
  if (!sede) return badRequest(res, 'Sede pública no configurada');

  const required = ['cliente_nombre', 'cliente_telefono', 'cliente_direccion', 'cliente_barrio'];
  for (const key of required) {
    if (!String(body[key] || '').trim()) return badRequest(res, `${key} requerido`);
  }

  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) return badRequest(res, 'El pedido debe tener productos');
  if (items.length > 50) return badRequest(res, 'El pedido supera el máximo de 50 productos diferentes');

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [r] = await conn.query(
      `INSERT INTO pedidos_web(empresa_id,sede_id,cliente_nombre,cliente_telefono,cliente_direccion,cliente_barrio,observacion,subtotal,total,metodo_pago,origen,estado,pagado,fecha_creacion)
       VALUES(?,?,?,?,?,?,?,?,0,'CONTRA_ENTREGA','WEB','PENDIENTE',0,UTC_TIMESTAMP())`,
      [
        sede.empresa_id,
        sede.id,
        String(body.cliente_nombre).trim(),
        String(body.cliente_telefono).trim(),
        String(body.cliente_direccion).trim(),
        String(body.cliente_barrio).trim(),
        String(body.observacion || '').trim() || null,
        0,
      ]
    );

    const pedidoId = r.insertId;
    let total = 0;
    const cleanItems = [];

    for (const item of items) {
      const productoId = Number(item.producto_id);
      const cantidad = Number(item.cantidad ?? 1);
      if (!Number.isInteger(productoId) || productoId <= 0) {
        throw Object.assign(new Error('Producto inválido en el pedido'), { httpStatus: 400, code: 'PRODUCTO_INVALIDO' });
      }
      if (!Number.isFinite(cantidad) || cantidad <= 0 || cantidad > 9999) {
        throw Object.assign(new Error(`Cantidad inválida para el producto ${productoId}`), { httpStatus: 400, code: 'CANTIDAD_INVALIDA' });
      }

      const [[producto]] = await conn.query(
        `SELECT p.id, p.nombre, p.precio,
                (SELECT COALESCE(SUM(m.cantidad),0)
                   FROM inv_movimiento m
                  WHERE m.producto_id=p.id AND m.sede_id=p.sede_id AND m.activo=1) AS stock
           FROM producto p
          WHERE p.id=? AND p.sede_id=? AND p.activo=1
          LIMIT 1`,
        [productoId, sede.id]
      );
      if (!producto) {
        throw Object.assign(new Error(`Producto ${productoId} no disponible`), { httpStatus: 400, code: 'PRODUCTO_NO_DISPONIBLE' });
      }
      if (cantidad > Number(producto.stock || 0)) {
        throw Object.assign(
          new Error(`No hay stock suficiente de ${producto.nombre}. Disponible: ${Number(producto.stock || 0)}.`),
          { httpStatus: 409, code: 'STOCK_INSUFICIENTE' }
        );
      }

      const precio = Number(producto.precio || 0);
      const subtotal = precio * cantidad;
      total += subtotal;
      await conn.query(
        `INSERT INTO pedidos_web_detalle(pedido_web_id,producto_id,nombre_producto,precio,cantidad,subtotal,fecha_creacion)
         VALUES(?,?,?,?,?,?,UTC_TIMESTAMP())`,
        [pedidoId, producto.id, producto.nombre, precio, cantidad, subtotal]
      );
      cleanItems.push({ producto_id: producto.id, nombre: producto.nombre, cantidad, subtotal });
    }

    await conn.query(`UPDATE pedidos_web SET subtotal=?, total=? WHERE id_pedido_web=?`, [total, total, pedidoId]);
    await conn.commit();

    const payload = {
      id_pedido_web: pedidoId,
      sede_id: sede.id,
      cliente_nombre: String(body.cliente_nombre).trim(),
      cliente_telefono: String(body.cliente_telefono).trim(),
      cliente_barrio: String(body.cliente_barrio).trim(),
      cliente_direccion: String(body.cliente_direccion).trim(),
      total,
      cantidad_items: cleanItems.length,
      items: cleanItems,
      fecha: new Date().toISOString(),
    };
    await emitPedidoWebNuevo(payload, { sede_id: sede.id });
    created(res, { id_pedido_web: pedidoId, estado: 'PENDIENTE', total });
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

module.exports={categories,products,productDetail,createDeliveryOrder};
