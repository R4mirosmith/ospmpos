const { pool, pageLimit } = require('../utils/sql');
const { ok, created, badRequest, notFound } = require('../utils/http');
const { writeScope, addScopeWhere, colombiaDateRange, clean } = require('../utils/scope');

function num(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function hasValue(value) {
  return value !== undefined && value !== null && value !== '';
}

async function productoActivoEnSede(conn, productoId, sedeId, lock = false) {
  const [rows] = await conn.query(
    `SELECT id, nombre, costo
       FROM producto
      WHERE id = ? AND sede_id = ? AND activo = 1
      LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
    [productoId, sedeId]
  );
  return rows[0] || null;
}

async function stockActual(conn, productoId, sedeId) {
  const [[row]] = await conn.query(
    `SELECT COALESCE(SUM(cantidad),0) AS stock
       FROM inv_movimiento
      WHERE producto_id = ? AND sede_id = ? AND activo = 1`,
    [productoId, sedeId]
  );
  return num(row?.stock);
}

async function ajuste(req, res) {
  const body = req.body || {};
  const productoId = Number(body.producto_id);
  const cantidad = num(body.cantidad, NaN);
  const costo = num(body.costo_unitario ?? body.costo_unit, 0);
  const comentario = clean(body.comentario ?? body.motivo);

  if (!productoId || !Number.isFinite(cantidad) || cantidad === 0) {
    return badRequest(res, 'producto_id y una cantidad distinta de cero son requeridos');
  }
  if (!Number.isFinite(costo) || costo < 0) {
    return badRequest(res, 'El costo unitario no puede ser negativo');
  }

  const s = await writeScope(req);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // El mismo bloqueo que usa ventas evita que una venta y un ajuste calculen
    // el stock simultáneamente sobre una base distinta.
    const producto = await productoActivoEnSede(conn, productoId, s.sede_id, true);
    if (!producto) {
      throw Object.assign(new Error('Producto no encontrado o no pertenece a la sede activa'), {
        httpStatus: 404,
        code: 'PRODUCTO_NOT_FOUND',
      });
    }

    // La pantalla define el signo por la cantidad: positivo entra, negativo sale.
    // Nunca usamos Math.abs() para una entrada porque eso convertía -2 en +2.
    const tipo = cantidad < 0 ? 'OUT_AJUSTE' : 'IN_AJUSTE';

    const [r] = await conn.query(
      `INSERT INTO inv_movimiento(
          empresa_id,sede_id,producto_id,usuario_id,tipo,cantidad,
          costo_unitario,comentario,fecha,activo
       ) VALUES(?,?,?,?,?,?,?,?,UTC_TIMESTAMP(),1)`,
      [s.empresa_id, s.sede_id, productoId, req.user.id, tipo, cantidad, costo, comentario]
    );

    const nuevoStock = await stockActual(conn, productoId, s.sede_id);
    await conn.commit();

    created(res, {
      id: r.insertId,
      producto_id: productoId,
      tipo,
      cantidad,
      stock_nuevo: nuevoStock,
    });
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

async function stockInicial(req, res) {
  const body = req.body || {};
  const productoId = Number(body.producto_id);
  const cantidad = num(body.cantidad, NaN);
  const costo = num(body.costo_unitario ?? body.costo_unit, 0);
  const comentario = clean(body.comentario ?? body.motivo) || 'Stock inicial';

  if (!productoId || !Number.isFinite(cantidad) || cantidad <= 0) {
    return badRequest(res, 'producto_id y una cantidad inicial mayor a cero son requeridos');
  }
  if (!Number.isFinite(costo) || costo < 0) {
    return badRequest(res, 'El costo unitario no puede ser negativo');
  }

  const s = await writeScope(req);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const producto = await productoActivoEnSede(conn, productoId, s.sede_id, true);
    if (!producto) {
      throw Object.assign(new Error('Producto no encontrado o no pertenece a la sede activa'), {
        httpStatus: 404,
        code: 'PRODUCTO_NOT_FOUND',
      });
    }

    // Stock inicial es realmente inicial: si existe cualquier movimiento histórico,
    // el usuario debe usar "Ajuste de inventario" para no duplicar existencias.
    const [[mov]] = await conn.query(
      `SELECT COUNT(*) AS total
         FROM inv_movimiento
        WHERE producto_id = ? AND sede_id = ?`,
      [productoId, s.sede_id]
    );
    if (Number(mov?.total || 0) > 0) {
      throw Object.assign(new Error('Este producto ya tiene movimientos. Usa Ajuste de inventario en lugar de Stock inicial.'), {
        httpStatus: 400,
        code: 'STOCK_INICIAL_YA_REGISTRADO',
      });
    }

    const [r] = await conn.query(
      `INSERT INTO inv_movimiento(
          empresa_id,sede_id,producto_id,usuario_id,tipo,cantidad,
          costo_unitario,comentario,fecha,activo
       ) VALUES(?,?,?,?,? ,?,?,?,UTC_TIMESTAMP(),1)`,
      [s.empresa_id, s.sede_id, productoId, req.user.id, 'IN_AJUSTE', cantidad, costo, comentario]
    );

    const nuevoStock = await stockActual(conn, productoId, s.sede_id);
    await conn.commit();

    created(res, {
      id: r.insertId,
      producto_id: productoId,
      tipo: 'IN_AJUSTE',
      cantidad,
      stock_nuevo: nuevoStock,
    });
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

async function stockList(req, res) {
  const { limit, offset } = pageLimit(req.query.page, req.query.pageSize);
  const scope = addScopeWhere(req, 'p');
  const where = [...scope.where];
  const params = [...scope.params];

  const buscar = clean(req.query.buscar);
  if (buscar) {
    where.push('(p.nombre LIKE ? OR p.codigo LIKE ? OR p.codigo_barras LIKE ?)');
    params.push(`%${buscar}%`, `%${buscar}%`, `%${buscar}%`);
  }

  const stockExpr = `(SELECT COALESCE(SUM(m.cantidad),0)
                        FROM inv_movimiento m
                       WHERE m.producto_id=p.id
                         AND m.sede_id=p.sede_id
                         AND m.activo=1)`;

  if (Number(req.query.solo_bajo_minimo || 0) === 1) {
    where.push(`${stockExpr} <= p.stock_minimo`);
  }

  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [[cnt]] = await pool.query(`SELECT COUNT(*) AS total FROM producto p ${w}`, params);
  const [items] = await pool.query(
    `SELECT p.id AS producto_id,
            p.codigo,
            p.codigo_barras,
            p.nombre,
            p.stock_minimo,
            p.costo AS costo_promedio,
            c.nombre AS categoria,
            ${stockExpr} AS stock_actual,
            ${stockExpr} * p.costo AS valor,
            CASE WHEN ${stockExpr} <= p.stock_minimo THEN 1 ELSE 0 END AS bajo_minimo
       FROM producto p
       LEFT JOIN categoria c ON c.id = p.categoria_id
       ${w}
      ORDER BY p.nombre
      LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  ok(res, {
    items,
    total: Number(cnt?.total || 0),
    page: Math.max(1, Number(req.query.page) || 1),
    pageSize: limit,
  });
}

async function kardex(req, res) {
  const { limit, offset } = pageLimit(req.query.page, req.query.pageSize);
  const scope = addScopeWhere(req, 'm');
  // Kardex conserva también movimientos anulados para no perder trazabilidad histórica.
  // El campo m.activo permite distinguirlos; el stock actual solo suma activos.
  const where = [...scope.where];
  const params = [...scope.params];

  if (hasValue(req.query.producto_id)) {
    const productoId = Number(req.query.producto_id);
    if (!Number.isFinite(productoId) || productoId <= 0) {
      return badRequest(res, 'producto_id inválido');
    }
    where.push('m.producto_id = ?');
    params.push(productoId);
  }

  const r = colombiaDateRange(req.query.desde, req.query.hasta, 'm.fecha');
  where.push(...r.where);
  params.push(...r.params);

  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [[cnt]] = await pool.query(`SELECT COUNT(*) AS total FROM inv_movimiento m ${w}`, params);
  const [items] = await pool.query(
    `SELECT m.*, p.nombre AS producto_nombre, p.codigo, u.nombre AS usuario_nombre
       FROM inv_movimiento m
       JOIN producto p ON p.id = m.producto_id
       LEFT JOIN usuario u ON u.id = m.usuario_id
       ${w}
      ORDER BY m.fecha DESC, m.id DESC
      LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  ok(res, {
    items,
    total: Number(cnt?.total || 0),
    page: Math.max(1, Number(req.query.page) || 1),
    pageSize: limit,
  });
}

module.exports = { ajuste, stockInicial, stockList, kardex };
