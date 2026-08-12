const { pool, pageLimit } = require('../utils/sql');
const { ok, created, badRequest, notFound } = require('../utils/http');
const { addScopeWhere, writeScope, clean } = require('../utils/scope');

function num(v, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

async function consumidorFinal(conn, scope) {
  const [[existente]] = await conn.query(
    `SELECT id
       FROM cliente
      WHERE empresa_id=? AND sede_id=? AND activo=1
        AND (documento='00000000' OR LOWER(nombre)='consumidor final')
      ORDER BY CASE WHEN documento='00000000' THEN 0 ELSE 1 END, id
      LIMIT 1`,
    [scope.empresa_id, scope.sede_id]
  );
  if (existente) return Number(existente.id);

  const [r] = await conn.query(
    `INSERT INTO cliente(empresa_id,sede_id,nombre,documento,activo,fecha)
     VALUES(?,?,'Consumidor final','00000000',1,UTC_TIMESTAMP())`,
    [scope.empresa_id, scope.sede_id]
  );
  return Number(r.insertId);
}

async function listar(req, res) {
  const { limit, offset } = pageLimit(req.query.page, req.query.pageSize);
  const scope = addScopeWhere(req, 'p');
  const where = [...scope.where];
  const params = [...scope.params];

  if (clean(req.query.estado)) {
    where.push('p.estado=?');
    params.push(String(req.query.estado).toUpperCase());
  }
  if (clean(req.query.buscar)) {
    where.push('(p.cliente_nombre LIKE ? OR p.cliente_telefono LIKE ? OR p.cliente_barrio LIKE ?)');
    params.push(`%${req.query.buscar}%`, `%${req.query.buscar}%`, `%${req.query.buscar}%`);
  }

  const sql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [[cnt]] = await pool.query(`SELECT COUNT(*) total FROM pedidos_web p ${sql}`, params);
  const [items] = await pool.query(
    `SELECT p.*, s.nombre sede_nombre, e.nombre empresa_nombre,
            (SELECT COUNT(*) FROM pedidos_web_detalle d WHERE d.pedido_web_id=p.id_pedido_web) cantidad_items
       FROM pedidos_web p
       LEFT JOIN sede s ON s.id=p.sede_id
       LEFT JOIN empresa e ON e.id=p.empresa_id
       ${sql}
      ORDER BY p.id_pedido_web DESC
      LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  ok(res, { items, total: Number(cnt.total || 0) });
}

async function get(req, res) {
  const id = Number(req.params.id);
  const scope = addScopeWhere(req, 'p');
  const [[pedido]] = await pool.query(
    `SELECT p.*, s.nombre sede_nombre, e.nombre empresa_nombre
       FROM pedidos_web p
       LEFT JOIN sede s ON s.id=p.sede_id
       LEFT JOIN empresa e ON e.id=p.empresa_id
      WHERE p.id_pedido_web=? ${scope.where.length ? 'AND ' + scope.where.join(' AND ') : ''}`,
    [id, ...scope.params]
  );
  if (!pedido) return notFound(res, 'Pedido no encontrado en tu sede');
  const [items] = await pool.query(`SELECT * FROM pedidos_web_detalle WHERE pedido_web_id=?`, [id]);
  ok(res, { pedido, items });
}

async function cambiarEstado(req, res) {
  const id = Number(req.params.id);
  const estado = String(req.body?.estado || '').toUpperCase();
  const permitidos = new Set(['PENDIENTE', 'CONFIRMADO', 'CANCELADO', 'CONVERTIDO']);
  if (!permitidos.has(estado)) return badRequest(res, 'Estado de pedido inválido');

  const scope = addScopeWhere(req, 'p');
  const [[actual]] = await pool.query(
    `SELECT p.id_pedido_web, p.empresa_id, p.sede_id, p.estado, p.venta_id
       FROM pedidos_web p
      WHERE p.id_pedido_web=? ${scope.where.length ? 'AND ' + scope.where.join(' AND ') : ''}
      LIMIT 1`,
    [id, ...scope.params]
  );
  if (!actual) return notFound(res, 'Pedido no encontrado en tu sede');

  // Una conversión debe crear la venta y descontar inventario dentro de la misma
  // transacción. Impedimos marcar CONVERTIDO manualmente y reabrir pedidos ya facturados.
  const ventaIdSolicitada = req.body?.venta_id ? Number(req.body.venta_id) : null;
  if (estado === 'CONVERTIDO' && !actual.venta_id && !ventaIdSolicitada) {
    return badRequest(res, 'Usa la opción Facturar para convertir el pedido en venta');
  }
  if (actual.venta_id && ventaIdSolicitada && Number(actual.venta_id) !== ventaIdSolicitada) {
    return badRequest(res, 'El pedido ya está asociado a otra venta');
  }
  if (actual.venta_id && estado !== 'CONVERTIDO') {
    return badRequest(res, 'El pedido ya está facturado. Gestiona la venta asociada en lugar de cambiar el pedido.');
  }

  // Compatibilidad de despliegue: una PWA anterior puede haber creado la venta con
  // el flujo de dos llamadas y luego enviar venta_id al marcar CONVERTIDO. Validamos
  // que esa venta pertenezca realmente a la misma sede antes de asociarla.
  if (estado === 'CONVERTIDO' && !actual.venta_id && ventaIdSolicitada) {
    const [[venta]] = await pool.query(
      `SELECT id FROM venta WHERE id=? AND empresa_id=? AND sede_id=? AND activo=1 LIMIT 1`,
      [ventaIdSolicitada, actual.empresa_id, actual.sede_id]
    );
    if (!venta) return badRequest(res, 'La venta indicada no pertenece a este pedido/sede o está anulada');
  }

  const ventaId = actual.venta_id || ventaIdSolicitada;
  const [r] = await pool.query(
    `UPDATE pedidos_web p
        SET p.estado=?,
            p.observacion_interna=?,
            p.usuario_actualiza_id=?,
            p.venta_id=COALESCE(?,p.venta_id),
            p.fecha_confirmacion=CASE WHEN ?='CONFIRMADO' THEN UTC_TIMESTAMP() ELSE p.fecha_confirmacion END,
            p.fecha_cancelacion=CASE WHEN ?='CANCELADO' THEN UTC_TIMESTAMP() ELSE p.fecha_cancelacion END,
            p.fecha_conversion=CASE WHEN ?='CONVERTIDO' THEN UTC_TIMESTAMP() ELSE p.fecha_conversion END
      WHERE p.id_pedido_web=? ${scope.where.length ? 'AND ' + scope.where.join(' AND ') : ''}`,
    [estado, req.body?.observacion_interna || null, req.user.id, ventaId, estado, estado, estado, id, ...scope.params]
  );
  if (!r.affectedRows) return notFound(res, 'Pedido no encontrado en tu sede');
  ok(res, { id_pedido_web: id, estado, venta_id: ventaId });
}

async function confirmar(req, res) {
  req.body.estado = 'CONFIRMADO';
  return cambiarEstado(req, res);
}

async function cancelar(req, res) {
  req.body.estado = 'CANCELADO';
  return cambiarEstado(req, res);
}

async function facturar(req, res) {
  const id = Number(req.params.id);
  if (!id) return badRequest(res, 'Pedido inválido');

  const s = await writeScope(req);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[pedido]] = await conn.query(
      `SELECT *
         FROM pedidos_web
        WHERE id_pedido_web=? AND empresa_id=? AND sede_id=?
        LIMIT 1 FOR UPDATE`,
      [id, s.empresa_id, s.sede_id]
    );
    if (!pedido) {
      throw Object.assign(new Error('Pedido no encontrado en tu sede'), { httpStatus: 404, code: 'PEDIDO_NOT_FOUND' });
    }

    // Idempotencia: si el navegador reintenta por red, devolvemos la venta ya creada
    // sin volver a descontar inventario.
    if (pedido.venta_id) {
      const [[ventaExistente]] = await conn.query(
        `SELECT id, subtotal, total, saldo, cliente_id FROM venta WHERE id=? AND sede_id=? LIMIT 1`,
        [pedido.venta_id, s.sede_id]
      );
      if (!ventaExistente) {
        throw Object.assign(new Error('El pedido referencia una venta inexistente; requiere revisión administrativa'), {
          httpStatus: 409,
          code: 'VENTA_PEDIDO_INCONSISTENTE',
        });
      }
      await conn.commit();
      return ok(res, {
        venta_id: Number(ventaExistente.id),
        cliente_id: Number(ventaExistente.cliente_id),
        subtotal: num(ventaExistente.subtotal),
        total: num(ventaExistente.total),
        saldo: num(ventaExistente.saldo),
        already_converted: true,
      });
    }

    if (String(pedido.estado).toUpperCase() !== 'CONFIRMADO') {
      throw Object.assign(new Error('Primero confirma el pedido antes de facturarlo'), {
        httpStatus: 400,
        code: 'PEDIDO_NO_CONFIRMADO',
      });
    }

    const [items] = await conn.query(
      `SELECT * FROM pedidos_web_detalle WHERE pedido_web_id=? ORDER BY id_pedido_web_detalle FOR UPDATE`,
      [id]
    );
    if (!items.length) {
      throw Object.assign(new Error('El pedido no tiene productos para facturar'), {
        httpStatus: 400,
        code: 'PEDIDO_SIN_DETALLE',
      });
    }

    const clienteId = await consumidorFinal(conn, s);
    const [ventaInsert] = await conn.query(
      `INSERT INTO venta(
          empresa_id,sede_id,cliente_id,usuario_id,subtotal,descuento,impuesto,total,
          canal,fecha,direccion_envio,estado,activo,pagado,saldo
       ) VALUES(?,?,?,?,0,0,0,0,'WEB',UTC_TIMESTAMP(),?,'EMITIDA',1,0,0)`,
      [s.empresa_id, s.sede_id, clienteId, req.user.id, pedido.cliente_direccion || null]
    );
    const ventaId = Number(ventaInsert.insertId);
    let subtotal = 0;

    for (const item of items) {
      const productoId = Number(item.producto_id);
      const cantidad = num(item.cantidad, NaN);
      const precio = num(item.precio, NaN);
      if (!productoId || !Number.isFinite(cantidad) || cantidad <= 0 || !Number.isFinite(precio) || precio < 0) {
        throw Object.assign(new Error('El pedido contiene un detalle inválido'), {
          httpStatus: 400,
          code: 'DETALLE_PEDIDO_INVALIDO',
        });
      }

      const [[producto]] = await conn.query(
        `SELECT id,nombre,codigo FROM producto WHERE id=? AND sede_id=? AND activo=1 FOR UPDATE`,
        [productoId, s.sede_id]
      );
      if (!producto) {
        throw Object.assign(new Error(`El producto ${item.nombre_producto || productoId} ya no está disponible en esta sede`), {
          httpStatus: 400,
          code: 'PRODUCTO_INVALIDO',
        });
      }

      const [[stockRow]] = await conn.query(
        `SELECT COALESCE(SUM(cantidad),0) stock
           FROM inv_movimiento
          WHERE producto_id=? AND sede_id=? AND activo=1`,
        [productoId, s.sede_id]
      );
      if (num(stockRow?.stock) < cantidad) {
        throw Object.assign(new Error(`Stock insuficiente para ${producto.nombre}`), {
          httpStatus: 400,
          code: 'STOCK_INSUFICIENTE',
        });
      }

      const totalLinea = +(cantidad * precio).toFixed(2);
      subtotal += totalLinea;
      await conn.query(
        `INSERT INTO venta_detalle(
            venta_id,item_tipo,producto_id,servicio_id,nombre_item,codigo_item,
            cantidad,precio_unitario,descuento,total_linea
         ) VALUES(?,'PRODUCTO',?,NULL,?,?,?,?,0,?)`,
        [ventaId, productoId, producto.nombre, producto.codigo, cantidad, precio, totalLinea]
      );
      await conn.query(
        `INSERT INTO inv_movimiento(
            empresa_id,sede_id,producto_id,usuario_id,tipo,venta_id,cantidad,
            costo_unitario,comentario,fecha,activo
         ) VALUES(?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP(),1)`,
        [s.empresa_id, s.sede_id, productoId, req.user.id, 'OUT_VENTA', ventaId, -cantidad, 0, `Venta ${ventaId} / Pedido web ${id}`]
      );
    }

    subtotal = +subtotal.toFixed(2);
    await conn.query(
      `UPDATE venta SET subtotal=?, total=?, saldo=? WHERE id=?`,
      [subtotal, subtotal, subtotal, ventaId]
    );

    const observacion = [
      `Pedido web facturado. Venta #${ventaId}.`,
      clean(req.body?.observacion_interna),
    ].filter(Boolean).join(' ');

    await conn.query(
      `UPDATE pedidos_web
          SET estado='CONVERTIDO', venta_id=?, observacion_interna=?, usuario_actualiza_id=?, fecha_conversion=UTC_TIMESTAMP()
        WHERE id_pedido_web=? AND empresa_id=? AND sede_id=?`,
      [ventaId, observacion || null, req.user.id, id, s.empresa_id, s.sede_id]
    );

    await conn.commit();
    created(res, {
      venta_id: ventaId,
      cliente_id: clienteId,
      subtotal,
      total: subtotal,
      saldo: subtotal,
      pedido_web_id: id,
    });
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

module.exports = { listar, get, cambiarEstado, confirmar, cancelar, facturar };
