const { pool } = require('../utils/sql');
const { created, ok, badRequest, notFound } = require('../utils/http');
const { writeScope, addScopeWhere, colombiaDateRange, clean } = require('../utils/scope');
const { pageLimit } = require('../utils/sql');

function num(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

async function listar(req, res) {
  const { page = 1, pageSize = 50, desde, hasta, buscar, estado } = req.query || {};
  const { limit, offset } = pageLimit(page, pageSize);

  const scope = addScopeWhere(req, 'c');
  const dates = colombiaDateRange(desde, hasta, 'c.fecha');
  const where = [...scope.where, ...dates.where];
  const params = [...scope.params, ...dates.params];

  const q = clean(buscar);
  if (q) {
    where.push('(CAST(c.id AS CHAR) LIKE ? OR p.nombre LIKE ? OR u.nombre LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }

  if (clean(estado)) {
    if (String(estado).toUpperCase() === 'ANULADA') where.push('c.activo = 0');
    if (String(estado).toUpperCase() === 'ACTIVA') where.push('c.activo = 1');
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const [items] = await pool.query(
    `SELECT
        c.id,
        c.empresa_id,
        c.sede_id,
        c.proveedor_id,
        c.usuario_id,
        c.subtotal,
        c.total,
        c.fecha,
        c.activo,
        p.nombre AS proveedor_nombre,
        u.nombre AS usuario_nombre,
        s.nombre AS sede_nombre,
        s.nit AS sede_nit,
        COALESCE(d.items, 0) AS items,
        COALESCE(d.unidades, 0) AS unidades
       FROM compra c
       LEFT JOIN proveedor p ON p.id = c.proveedor_id
       LEFT JOIN usuario u ON u.id = c.usuario_id
       LEFT JOIN sede s ON s.id = c.sede_id
       LEFT JOIN (
         SELECT compra_id, COUNT(*) AS items, COALESCE(SUM(cantidad),0) AS unidades
           FROM compra_detalle
          GROUP BY compra_id
       ) d ON d.compra_id = c.id
       ${whereSql}
       ORDER BY c.fecha DESC, c.id DESC
       LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  const [[countRow]] = await pool.query(
    `SELECT COUNT(*) AS total FROM compra c LEFT JOIN proveedor p ON p.id = c.proveedor_id LEFT JOIN usuario u ON u.id = c.usuario_id ${whereSql}`,
    params
  );

  const [[sumRow]] = await pool.query(
    `SELECT COALESCE(SUM(c.total),0) AS total_compras FROM compra c LEFT JOIN proveedor p ON p.id = c.proveedor_id LEFT JOIN usuario u ON u.id = c.usuario_id ${whereSql}`,
    params
  );

  ok(res, { items, total: Number(countRow?.total || 0), total_compras: Number(sumRow?.total_compras || 0), page: Number(page), pageSize: limit });
}

async function obtener(req, res) {
  const id = Number(req.params.id);
  const scope = addScopeWhere(req, 'c');
  const where = ['c.id = ?', ...scope.where];
  const params = [id, ...scope.params];

  const [rows] = await pool.query(
    `SELECT
        c.*,
        p.nombre AS proveedor_nombre,
        u.nombre AS usuario_nombre,
        s.nombre AS sede_nombre,
        s.nit AS sede_nit,
        s.razon_social AS sede_razon_social
       FROM compra c
       LEFT JOIN proveedor p ON p.id = c.proveedor_id
       LEFT JOIN usuario u ON u.id = c.usuario_id
       LEFT JOIN sede s ON s.id = c.sede_id
       WHERE ${where.join(' AND ')}
       LIMIT 1`,
    params
  );

  const compra = rows[0];
  if (!compra) return notFound(res, 'Compra no encontrada en tu sede');

  const [detalles] = await pool.query(
    `SELECT cd.*, pr.codigo, pr.nombre AS producto_nombre
       FROM compra_detalle cd
       LEFT JOIN producto pr ON pr.id = cd.producto_id
      WHERE cd.compra_id = ?
      ORDER BY cd.id`,
    [id]
  );

  ok(res, { ...compra, detalles });
}

async function crear(req, res) {
  const { proveedor_id, detalles = [] } = req.body || {};
  if (!proveedor_id || !Array.isArray(detalles) || !detalles.length) {
    return badRequest(res, 'proveedor_id y detalles requeridos');
  }

  const s = await writeScope(req);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    let subtotal = 0;
    const [[proveedor]] = await conn.query(
      `SELECT id FROM proveedor WHERE id = ? AND sede_id = ? AND activo = 1 LIMIT 1`,
      [proveedor_id, s.sede_id]
    );
    if (!proveedor) {
      throw Object.assign(new Error('El proveedor no pertenece a la sede activa o está inactivo'), { httpStatus: 400, code: 'PROVEEDOR_INVALIDO' });
    }

    const [r] = await conn.query(
      `INSERT INTO compra(empresa_id,sede_id,proveedor_id,usuario_id,subtotal,total,fecha,activo)
       VALUES(?,?,?,?,0,0,UTC_TIMESTAMP(),1)`,
      [s.empresa_id, s.sede_id, proveedor_id, req.user.id]
    );

    const compraId = r.insertId;

    for (const d of detalles) {
      const cantidad = num(d.cantidad);
      const costo = num(d.costo_unitario);
      if (!d.producto_id || cantidad <= 0) throw Object.assign(new Error('Producto y cantidad válidos son requeridos'), { httpStatus: 400 });
      if (costo < 0) throw Object.assign(new Error('El costo unitario no puede ser negativo'), { httpStatus: 400, code: 'COSTO_INVALIDO' });

      const [[producto]] = await conn.query(
        `SELECT id FROM producto WHERE id = ? AND sede_id = ? AND activo = 1 LIMIT 1`,
        [d.producto_id, s.sede_id]
      );
      if (!producto) throw Object.assign(new Error(`El producto ${d.producto_id} no pertenece a la sede activa`), { httpStatus: 400 });

      const total = +(cantidad * costo).toFixed(2);
      subtotal += total;

      await conn.query(
        `INSERT INTO compra_detalle(compra_id,producto_id,cantidad,costo_unitario,total_linea)
         VALUES(?,?,?,?,?)`,
        [compraId, d.producto_id, cantidad, costo, total]
      );

      await conn.query(
        `INSERT INTO inv_movimiento(empresa_id,sede_id,producto_id,usuario_id,tipo,compra_id,cantidad,costo_unitario,comentario,fecha,activo)
         VALUES(?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP(),1)`,
        [s.empresa_id, s.sede_id, d.producto_id, req.user.id, 'IN_COMPRA', compraId, cantidad, costo, `Compra ${compraId}`]
      );
    }

    await conn.query(`UPDATE compra SET subtotal=?, total=? WHERE id=?`, [subtotal, subtotal, compraId]);
    await conn.commit();
    created(res, { compra_id: compraId, total: subtotal });
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

async function anular(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return badRequest(res, 'Compra inválida');

  const scope = addScopeWhere(req, 'c');
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    // Primero bloqueamos la compra. No desactivamos nada hasta comprobar que
    // retirar sus entradas no dejará existencias negativas.
    const [[compra]] = await conn.query(
      `SELECT c.id, c.sede_id
         FROM compra c
        WHERE c.id = ? AND c.activo = 1
        ${scope.where.length ? 'AND ' + scope.where.join(' AND ') : ''}
        LIMIT 1 FOR UPDATE`,
      [id, ...scope.params]
    );

    if (!compra) {
      await conn.commit();
      return ok(res, { id, message: 'Compra no encontrada, ya anulada o fuera de tu sede' });
    }

    // Usamos los movimientos reales asociados a la compra, no solo el detalle,
    // porque son esos movimientos los que se van a desactivar.
    const [entradas] = await conn.query(
      `SELECT producto_id, COALESCE(SUM(cantidad),0) AS cantidad
         FROM inv_movimiento
        WHERE compra_id=? AND sede_id=? AND activo=1
        GROUP BY producto_id`,
      [id, compra.sede_id]
    );

    for (const entrada of entradas) {
      const productoId = Number(entrada.producto_id);
      const cantidadEntrada = Number(entrada.cantidad || 0);
      if (cantidadEntrada <= 0) continue;

      // El mismo lock de producto usado por ventas/ajustes evita que cambie el
      // stock mientras comprobamos si esta compra puede anularse.
      await conn.query(
        `SELECT id FROM producto WHERE id=? AND sede_id=? LIMIT 1 FOR UPDATE`,
        [productoId, compra.sede_id]
      );
      const [[stockRow]] = await conn.query(
        `SELECT COALESCE(SUM(cantidad),0) AS stock
           FROM inv_movimiento
          WHERE producto_id=? AND sede_id=? AND activo=1`,
        [productoId, compra.sede_id]
      );
      const stock = Number(stockRow?.stock || 0);
      if (stock - cantidadEntrada < -0.000001) {
        throw Object.assign(
          new Error(`No puedes anular esta compra porque parte de su inventario ya fue vendido o retirado. Producto ${productoId}: stock ${stock}, entrada de la compra ${cantidadEntrada}.`),
          { httpStatus: 409, code: 'COMPRA_ANULACION_STOCK_INSUFICIENTE' }
        );
      }
    }

    await conn.query(`UPDATE compra SET activo=0 WHERE id=? AND activo=1`, [id]);
    await conn.query(`UPDATE inv_movimiento SET activo=0 WHERE compra_id=? AND sede_id=?`, [id, compra.sede_id]);

    await conn.commit();
    ok(res, { id, message: 'Compra anulada' });
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

module.exports = { listar, obtener, crear, anular };
