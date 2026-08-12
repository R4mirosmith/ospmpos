const { pool, pageLimit } = require('../utils/sql');
const { ok, created, badRequest, notFound } = require('../utils/http');
const { writeScope, addScopeWhere, colombiaDateRange, clean } = require('../utils/scope');

function num(v, def = 0) { const n = Number(v); return Number.isFinite(n) ? n : def; }
function itemTipo(d) { return String(d.item_tipo || (d.servicio_id ? 'SERVICIO' : 'PRODUCTO')).toUpperCase(); }
function entidadTransferencia(value) {
  const v = clean(value || '').toUpperCase();
  return ['NEQUI', 'BANCOLOMBIA', 'DAVIPLATA', 'OTRO'].includes(v) ? v : null;
}

async function resolverClienteVenta(conn, scope, clienteIdSolicitado) {
  const requested = Number(clienteIdSolicitado || 0);
  if (requested > 0) {
    const [[cliente]] = await conn.query(
      `SELECT id FROM cliente WHERE id=? AND empresa_id=? AND sede_id=? AND activo=1 LIMIT 1`,
      [requested, scope.empresa_id, scope.sede_id]
    );
    if (cliente) return Number(cliente.id);

    // Compatibilidad con versiones anteriores del frontend que enviaban siempre id=1
    // para "Consumidor final". En sedes distintas a la inicial, resolvemos el cliente
    // equivalente de esa sede en vez de asociar la venta a un cliente ajeno.
    if (requested !== 1) {
      throw Object.assign(new Error('El cliente no pertenece a la sede activa o está inactivo'), {
        httpStatus: 400,
        code: 'CLIENTE_INVALIDO',
      });
    }
  }

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
     VALUES(?,?, 'Consumidor final','00000000',1,UTC_TIMESTAMP())`,
    [scope.empresa_id, scope.sede_id]
  );
  return Number(r.insertId);
}

async function crear(req, res) {
  const { cliente_id = null, canal = 'POS', direccion = null, descuento = 0, descuento_valor = null, impuesto = 0, detalles = [] } = req.body || {};
  if (!Array.isArray(detalles) || !detalles.length) return badRequest(res, 'detalles requerido');

  const s = await writeScope(req);
  const userId = req.user.id;
  const descSolicitado = Math.max(0, num(descuento_valor ?? descuento, 0));
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();
    const clienteId = await resolverClienteVenta(conn, s, cliente_id);
    const [r] = await conn.query(
      `INSERT INTO venta(empresa_id,sede_id,cliente_id,usuario_id,subtotal,descuento,impuesto,total,canal,fecha,direccion_envio,estado,activo,pagado,saldo)
       VALUES(?,?,?,?,0,0,0,0,?,UTC_TIMESTAMP(),?,'EMITIDA',1,0,0)`,
      [s.empresa_id, s.sede_id, clienteId, userId, String(canal).toUpperCase(), direccion]
    );

    const ventaId = r.insertId;
    let subtotal = 0;

    for (const d of detalles) {
      const tipo = itemTipo(d);
      const cantidad = num(d.cantidad);
      const lineDesc = Math.max(0, num(d.descuento));
      if (cantidad <= 0) throw Object.assign(new Error('Detalle inválido'), { httpStatus: 400, code: 'DETALLE_INVALIDO' });

      if (tipo === 'SERVICIO') {
        const servicioId = Number(d.servicio_id || d.id);
        if (!servicioId) throw Object.assign(new Error('Servicio inválido'), { httpStatus: 400, code: 'SERVICIO_INVALIDO' });
        const [[servicio]] = await conn.query(`SELECT id,nombre,codigo,precio FROM servicio WHERE id=? AND sede_id=? AND activo=1`, [servicioId, s.sede_id]);
        if (!servicio) throw Object.assign(new Error(`Servicio ${servicioId} no existe en esta sede`), { httpStatus: 400, code: 'SERVICIO_INVALIDO' });
        const precio = num(d.precio_unitario, num(servicio.precio));
        const subtotalLinea = +(cantidad * precio).toFixed(2);
        const descuentoLinea = Math.min(subtotalLinea, lineDesc);
        const totalLinea = Math.max(0, +(subtotalLinea - descuentoLinea).toFixed(2));
        subtotal += totalLinea;
        await conn.query(
          `INSERT INTO venta_detalle(venta_id,item_tipo,producto_id,servicio_id,nombre_item,codigo_item,cantidad,precio_unitario,descuento,total_linea)
           VALUES(?,'SERVICIO',NULL,?,?,?,?,?,?,?)`,
          [ventaId, servicioId, servicio.nombre, servicio.codigo, cantidad, precio, descuentoLinea, totalLinea]
        );
        continue;
      }

      const productoId = Number(d.producto_id || d.id);
      const precio = num(d.precio_unitario);
      if (!productoId) throw Object.assign(new Error('Producto inválido'), { httpStatus: 400, code: 'PRODUCTO_INVALIDO' });
      const [[productoLock]] = await conn.query(`SELECT id,nombre,codigo FROM producto WHERE id=? AND sede_id=? AND activo=1 FOR UPDATE`, [productoId, s.sede_id]);
      if (!productoLock) throw Object.assign(new Error(`Producto ${productoId} no existe en esta sede`), { httpStatus: 400, code: 'PRODUCTO_INVALIDO' });
      const [[stockRow]] = await conn.query(`SELECT COALESCE(SUM(cantidad),0) stock FROM inv_movimiento WHERE producto_id=? AND sede_id=? AND activo=1`, [productoId, s.sede_id]);
      if (Number(stockRow.stock || 0) < cantidad) throw Object.assign(new Error(`Stock insuficiente para ${productoLock.nombre}`), { httpStatus: 400, code: 'STOCK_INSUFICIENTE' });
      const subtotalLinea = +(cantidad * precio).toFixed(2);
      const descuentoLinea = Math.min(subtotalLinea, lineDesc);
      const totalLinea = Math.max(0, +(subtotalLinea - descuentoLinea).toFixed(2));
      subtotal += totalLinea;
      await conn.query(
        `INSERT INTO venta_detalle(venta_id,item_tipo,producto_id,servicio_id,nombre_item,codigo_item,cantidad,precio_unitario,descuento,total_linea)
         VALUES(?,'PRODUCTO',?,NULL,?,?,?,?,?,?)`,
        [ventaId, productoId, productoLock.nombre, productoLock.codigo, cantidad, precio, descuentoLinea, totalLinea]
      );
      await conn.query(
        `INSERT INTO inv_movimiento(empresa_id,sede_id,producto_id,usuario_id,tipo,venta_id,cantidad,costo_unitario,comentario,fecha,activo)
         VALUES(?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP(),1)`,
        [s.empresa_id, s.sede_id, productoId, userId, 'OUT_VENTA', ventaId, -cantidad, 0, `Venta ${ventaId}`]
      );
    }

    const desc = Math.min(subtotal, descSolicitado);
    const total = Math.max(0, +(subtotal - desc + num(impuesto)).toFixed(2));
    await conn.query(`UPDATE venta SET subtotal=?, descuento=?, impuesto=?, total=?, saldo=? WHERE id=?`, [subtotal, desc, num(impuesto), total, total, ventaId]);
    await conn.commit();
    created(res, { venta_id: ventaId, subtotal, descuento: desc, descuento_solicitado: descSolicitado, impuesto: num(impuesto), total, saldo: total });
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
}

async function pagar(req, res) {
  const ventaId = Number(req.params.id);
  const { metodo, monto, referencia = null, recibido = null, cambio = null, entidad_transferencia = null } = req.body || {};
  if (!ventaId || !metodo) return badRequest(res, 'venta y método requeridos');
  const metodoPago = String(metodo).toUpperCase();
  const entidad = metodoPago === 'TRANSFERENCIA' ? entidadTransferencia(entidad_transferencia) : null;
  if (metodoPago === 'TRANSFERENCIA' && !entidad) return badRequest(res, 'Selecciona si la transferencia fue por Nequi, Bancolombia, Daviplata u Otro');
  const pay = num(monto);
  if (pay <= 0) return badRequest(res, 'monto debe ser mayor a 0');
  const scope = addScopeWhere(req, 'v');
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[v]] = await conn.query(`SELECT v.* FROM venta v WHERE v.id=? AND v.activo=1 ${scope.where.length ? 'AND ' + scope.where.join(' AND ') : ''} FOR UPDATE`, [ventaId, ...scope.params]);
    if (!v) throw Object.assign(new Error('Venta no existe o no pertenece a tu sede'), { httpStatus: 404, code: 'NOT_FOUND' });
    const saldoActual = Math.max(0, num(v.total) - num(v.pagado));
    if (saldoActual <= 0.005) {
      throw Object.assign(new Error('La venta ya está completamente pagada'), { httpStatus: 400, code: 'VENTA_YA_PAGADA' });
    }
    if (pay - saldoActual > 0.005) {
      throw Object.assign(new Error(`El pago excede el saldo pendiente (${saldoActual.toFixed(2)})`), { httpStatus: 400, code: 'PAGO_EXCEDE_SALDO' });
    }

    const referenciaFinal = metodoPago === 'TRANSFERENCIA' ? null : (clean(referencia) || null);
    await conn.query(`INSERT INTO venta_pago(venta_id,metodo,entidad_transferencia,monto,referencia,recibido,cambio,fecha) VALUES(?,?,?,?,?,?,?,UTC_TIMESTAMP())`, [ventaId, metodoPago, entidad, pay, referenciaFinal, recibido === null ? pay : num(recibido), cambio === null ? 0 : num(cambio)]);
    const nuevoPagado = num(v.pagado) + pay;
    const saldo = Math.max(0, num(v.total) - nuevoPagado);
    await conn.query(`UPDATE venta SET pagado=?, saldo=?, estado=? WHERE id=?`, [nuevoPagado, saldo, saldo <= 0 ? 'PAGADA' : v.estado, ventaId]);
    await conn.commit();
    ok(res, { venta_id: ventaId, pagado: nuevoPagado, saldo, estado: saldo <= 0 ? 'PAGADA' : v.estado });
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
}

async function get(req, res) {
  const id = Number(req.params.id);
  const scope = addScopeWhere(req, 'v');
  const [ventas] = await pool.query(
    `SELECT v.*, c.nombre cliente_nombre, u.nombre usuario_nombre, s.nombre sede_nombre, s.nit sede_nit, s.razon_social sede_razon_social, s.direccion sede_direccion, e.nombre empresa_nombre
       FROM venta v
       LEFT JOIN cliente c ON c.id=v.cliente_id
       LEFT JOIN usuario u ON u.id=v.usuario_id
       LEFT JOIN sede s ON s.id=v.sede_id
       LEFT JOIN empresa e ON e.id=v.empresa_id
      WHERE v.id=? ${scope.where.length ? 'AND ' + scope.where.join(' AND ') : ''}`,
    [id, ...scope.params]
  );
  const venta = ventas[0] || null;
  if (!venta) return notFound(res, 'Venta no encontrada en tu sede');

  const [detalles] = await pool.query(
    `SELECT vd.*,
            COALESCE(vd.nombre_item, p.nombre, sv.nombre) AS nombre,
            COALESCE(vd.codigo_item, p.codigo, sv.codigo) AS codigo,
            p.codigo_barras,
            p.garantia_info,
            c.nombre AS categoria_nombre
       FROM venta_detalle vd
       LEFT JOIN producto p ON p.id=vd.producto_id
       LEFT JOIN servicio sv ON sv.id=vd.servicio_id
       LEFT JOIN categoria c ON c.id=COALESCE(p.categoria_id, sv.categoria_id)
      WHERE vd.venta_id=?
      ORDER BY vd.id`,
    [id]
  );
  const [pagos] = await pool.query(`SELECT * FROM venta_pago WHERE venta_id=? AND anulado=0 ORDER BY id`, [id]);
  const [devoluciones] = await pool.query(`SELECT * FROM devolucion_venta WHERE venta_id=? AND activo=1 ORDER BY id DESC`, [id]);
  ok(res, { venta, detalles, pagos, devoluciones });
}

async function listar(req, res) {
  const { limit, offset } = pageLimit(req.query.page, req.query.pageSize);
  const scope = addScopeWhere(req, 'v');
  const where = [...scope.where];
  const params = [...scope.params];
  const r = colombiaDateRange(req.query.desde, req.query.hasta, 'v.fecha');
  where.push(...r.where); params.push(...r.params);
  const estadoFiltro = clean(req.query.estado);
  if (estadoFiltro && estadoFiltro !== 'all') {
    const estadoNormalizado = String(estadoFiltro).toUpperCase() === 'PENDIENTE' ? 'EMITIDA' : String(estadoFiltro).toUpperCase();
    where.push('v.estado=?'); params.push(estadoNormalizado);
  } else {
    // Por defecto el listado operativo solo muestra ventas pagadas y pendientes.
    // Las anuladas quedan fuera para no mezclar la información diaria.
    where.push("v.estado IN ('PAGADA','EMITIDA')");
  }
  if (clean(req.query.q)) { where.push('(c.nombre LIKE ? OR CAST(v.id AS CHAR) LIKE ?)'); params.push(`%${req.query.q}%`, `%${req.query.q}%`); }
  if (clean(req.query.metodo)) { where.push('EXISTS(SELECT 1 FROM venta_pago vp WHERE vp.venta_id=v.id AND vp.metodo=?)'); params.push(req.query.metodo); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [[cnt]] = await pool.query(`SELECT COUNT(*) total FROM venta v LEFT JOIN cliente c ON c.id=v.cliente_id ${w}`, params);
  const [items] = await pool.query(
    `SELECT v.*, c.nombre cliente_nombre, u.nombre usuario_nombre, s.nombre sede_nombre, e.nombre empresa_nombre,
            (SELECT COUNT(*) FROM venta_detalle vd WHERE vd.venta_id=v.id) items,
            (SELECT GROUP_CONCAT(DISTINCT CASE WHEN vp.metodo='TRANSFERENCIA' THEN CONCAT('TRANSFERENCIA - ', COALESCE(vp.entidad_transferencia,'SIN DEFINIR')) ELSE vp.metodo END) FROM venta_pago vp WHERE vp.venta_id=v.id AND vp.anulado=0) metodo,
            (SELECT COALESCE(SUM(dv.total_devuelto),0) FROM devolucion_venta dv WHERE dv.venta_id=v.id AND dv.activo=1) total_devuelto
       FROM venta v
       LEFT JOIN cliente c ON c.id=v.cliente_id
       LEFT JOIN usuario u ON u.id=v.usuario_id
       LEFT JOIN sede s ON s.id=v.sede_id
       LEFT JOIN empresa e ON e.id=v.empresa_id
       ${w}
       ORDER BY v.id DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  ok(res, { items, total: Number(cnt.total || 0) });
}

async function devolucion(req, res) {
  const ventaId = Number(req.params.id);
  const motivo = clean(req.body?.motivo) || 'Devolución de venta';
  const detalles = Array.isArray(req.body?.detalles) ? req.body.detalles : [];
  if (!ventaId || !detalles.length) return badRequest(res, 'Selecciona al menos un ítem para devolver');

  const scope = addScopeWhere(req, 'v');
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[v]] = await conn.query(`SELECT v.* FROM venta v WHERE v.id=? AND v.estado <> 'ANULADA' ${scope.where.length ? 'AND ' + scope.where.join(' AND ') : ''} FOR UPDATE`, [ventaId, ...scope.params]);
    if (!v) throw Object.assign(new Error('Venta no existe o no pertenece a tu sede'), { httpStatus: 404, code: 'NOT_FOUND' });

    const [dr] = await conn.query(
      `INSERT INTO devolucion_venta(empresa_id,sede_id,venta_id,usuario_id,motivo,total_devuelto,fecha,activo)
       VALUES(?,?,?,?,?,0,UTC_TIMESTAMP(),1)`,
      [v.empresa_id, v.sede_id, ventaId, req.user.id, motivo]
    );
    const devolucionId = dr.insertId;
    let totalDevuelto = 0;

    for (const d of detalles) {
      const detalleId = Number(d.venta_detalle_id || d.detalle_id || d.id);
      const cantidad = num(d.cantidad);
      if (!detalleId || cantidad <= 0) throw Object.assign(new Error('Detalle de devolución inválido'), { httpStatus: 400, code: 'DEVOLUCION_INVALIDA' });

      const [[vd]] = await conn.query(`SELECT * FROM venta_detalle WHERE id=? AND venta_id=? FOR UPDATE`, [detalleId, ventaId]);
      if (!vd) throw Object.assign(new Error('Detalle de venta no encontrado'), { httpStatus: 404, code: 'DETALLE_NOT_FOUND' });

      const [[prev]] = await conn.query(`SELECT COALESCE(SUM(cantidad),0) devuelta FROM devolucion_venta_detalle WHERE venta_detalle_id=?`, [detalleId]);
      const disponible = num(vd.cantidad) - num(prev.devuelta);
      if (cantidad > disponible) throw Object.assign(new Error(`La cantidad a devolver supera lo vendido para ${vd.nombre_item || 'el ítem'}`), { httpStatus: 400, code: 'CANTIDAD_DEVOLUCION_INVALIDA' });

      const cantidadVendida = Math.max(1, num(vd.cantidad, 1));
      const unit = +(num(vd.total_linea, num(vd.precio_unitario) * cantidadVendida) / cantidadVendida).toFixed(2);
      const totalLinea = +(cantidad * unit).toFixed(2);
      totalDevuelto += totalLinea;
      await conn.query(
        `INSERT INTO devolucion_venta_detalle(devolucion_id,venta_detalle_id,producto_id,servicio_id,item_tipo,nombre_item,cantidad,precio_unitario,total_linea)
         VALUES(?,?,?,?,?,?,?,?,?)`,
        [devolucionId, detalleId, vd.producto_id, vd.servicio_id, vd.item_tipo, vd.nombre_item, cantidad, unit, totalLinea]
      );

      if (vd.item_tipo === 'PRODUCTO' && vd.producto_id) {
        await conn.query(
          `INSERT INTO inv_movimiento(empresa_id,sede_id,producto_id,usuario_id,tipo,venta_id,cantidad,costo_unitario,comentario,fecha,activo)
           VALUES(?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP(),1)`,
          [v.empresa_id, v.sede_id, vd.producto_id, req.user.id, 'IN_DEV_VENTA', ventaId, cantidad, 0, `Devolución venta ${ventaId}`]
        );
      }
    }

    await conn.query(`UPDATE devolucion_venta SET total_devuelto=? WHERE id=?`, [totalDevuelto, devolucionId]);
    await conn.commit();
    created(res, { id: devolucionId, venta_id: ventaId, total_devuelto: totalDevuelto, message: 'Devolución registrada' });
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
}

async function anular(req, res) {
  const id = Number(req.params.id);
  const motivo = req.body?.motivo || 'Anulación';
  const scope = addScopeWhere(req, 'v');
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [r] = await conn.query(`UPDATE venta v SET v.estado='ANULADA', v.activo=0, v.fecha_anulacion=UTC_TIMESTAMP(), v.anulado_por=?, v.motivo_anulacion=? WHERE v.id=? ${scope.where.length ? 'AND ' + scope.where.join(' AND ') : ''}`, [req.user.id, motivo, id, ...scope.params]);
    if (!r.affectedRows) throw Object.assign(new Error('Venta no encontrada en tu sede'), { httpStatus: 404, code: 'NOT_FOUND' });
    // Al anular una venta se revierten TODOS sus movimientos de inventario.
    // Esto incluye devoluciones previas (IN_DEV_VENTA); si solo se anulaba OUT_VENTA,
    // una devolución anterior quedaba sumando stock de forma incorrecta.
    await conn.query(`UPDATE inv_movimiento SET activo=0 WHERE venta_id=?`, [id]);
    await conn.query(`UPDATE devolucion_venta SET activo=0 WHERE venta_id=?`, [id]);
    await conn.query(`UPDATE venta_pago SET anulado=1, fecha_anulacion=UTC_TIMESTAMP() WHERE venta_id=?`, [id]);
    await conn.commit();
    ok(res, { id, message: 'Venta anulada' });
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
}

module.exports = { crear, pagar, get, listar, devolucion, anular };
