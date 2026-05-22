const { pool } = require('../utils/sql');
const { ok } = require('../utils/http');
const { addScopeWhere, colombiaDateRange } = require('../utils/scope');

const ESTADOS_REPORTE = `v.estado IN ('PAGADA','EMITIDA')`;

function num(v, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function baseWhere(req, alias, dateCol) {
  const scope = addScopeWhere(req, alias);
  const where = [...scope.where];
  const params = [...scope.params];
  const r = colombiaDateRange(req.query.desde, req.query.hasta, dateCol);
  where.push(...r.where);
  params.push(...r.params);
  return { where, params, sql: where.length ? `WHERE ${where.join(' AND ')}` : '' };
}

function categoriaFilter(req, where, params, alias = 'p') {
  const categoriaId = Number(req.query.categoria_id || 0);
  if (categoriaId > 0) {
    where.push(`${alias}.categoria_id = ?`);
    params.push(categoriaId);
  }
}

function devVentaJoin(alias = 'v') {
  return `LEFT JOIN (
    SELECT venta_id, COALESCE(SUM(total_devuelto),0) total_devuelto
      FROM devolucion_venta
     WHERE activo = 1
     GROUP BY venta_id
  ) dev ON dev.venta_id = ${alias}.id`;
}

function devDetalleJoin(alias = 'vd') {
  return `LEFT JOIN (
    SELECT dvd.venta_detalle_id,
           COALESCE(SUM(dvd.cantidad),0) cantidad_devuelta,
           COALESCE(SUM(dvd.total_linea),0) total_devuelto
      FROM devolucion_venta_detalle dvd
      JOIN devolucion_venta dv ON dv.id = dvd.devolucion_id AND dv.activo = 1
     GROUP BY dvd.venta_detalle_id
  ) devd ON devd.venta_detalle_id = ${alias}.id`;
}

function detalleNetoExpr() {
  // venta.subtotal ya viene después de descuentos por producto. venta.descuento es el descuento general.
  // Este cálculo reparte el descuento general proporcionalmente y descuenta devoluciones.
  return `GREATEST(
    (vd.total_linea - COALESCE(devd.total_devuelto,0)) -
    (COALESCE(v.descuento,0) * ((vd.total_linea - COALESCE(devd.total_devuelto,0)) / NULLIF(v.subtotal,0))),
    0
  )`;
}

function descuentoGeneralAsignadoExpr() {
  return `(COALESCE(v.descuento,0) * ((vd.total_linea - COALESCE(devd.total_devuelto,0)) / NULLIF(v.subtotal,0)))`;
}

async function deduccionesTotales(req) {
  const scope = addScopeWhere(req, 'd');
  const where = [...scope.where, 'd.activo = 1'];
  const params = [...scope.params];
  const r = colombiaDateRange(req.query.desde, req.query.hasta, 'd.fecha');
  where.push(...r.where);
  params.push(...r.params);
  const sql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [[row]] = await pool.query(
    `SELECT COALESCE(SUM(d.monto),0) total_deducciones, COUNT(*) cantidad_deducciones
       FROM deduccion d ${sql}`,
    params
  );
  return {
    total_deducciones: num(row?.total_deducciones),
    cantidad_deducciones: num(row?.cantidad_deducciones),
  };
}

async function ventasSeries(req, res) {
  const b = baseWhere(req, 'v', 'v.fecha');
  b.where.push(ESTADOS_REPORTE);
  const sql = b.where.length ? `WHERE ${b.where.join(' AND ')}` : '';

  const [items] = await pool.query(
    `SELECT DATE(DATE_SUB(v.fecha, INTERVAL 5 HOUR)) x,
            COUNT(*) tickets,
            COALESCE(SUM(v.total),0) total_bruto,
            COALESCE(SUM(COALESCE(dev.total_devuelto,0)),0) devoluciones,
            COALESCE(SUM(GREATEST(v.total - COALESCE(dev.total_devuelto,0),0)),0) total_neto,
            COALESCE(SUM(CASE WHEN v.estado='PAGADA' THEN GREATEST(v.total - COALESCE(dev.total_devuelto,0),0) ELSE 0 END),0) pagado_neto,
            COALESCE(SUM(CASE WHEN v.estado='EMITIDA' THEN GREATEST(v.saldo - COALESCE(dev.total_devuelto,0),0) ELSE 0 END),0) pendiente_neto
       FROM venta v
       ${devVentaJoin('v')}
       ${sql}
      GROUP BY DATE(DATE_SUB(v.fecha, INTERVAL 5 HOUR))
      ORDER BY x`,
    b.params
  );

  const [[metaRaw]] = await pool.query(
    `SELECT COALESCE(SUM(v.total),0) total_bruto,
            COUNT(*) tickets,
            COALESCE(AVG(v.total),0) promedio,
            ROUND(100*SUM(CASE WHEN v.estado='PAGADA' THEN 1 ELSE 0 END)/NULLIF(COUNT(*),0),2) pctPagado,
            COALESCE(SUM(COALESCE(dev.total_devuelto,0)),0) devoluciones,
            COALESCE(SUM(GREATEST(v.total - COALESCE(dev.total_devuelto,0),0)),0) total_neto,
            COALESCE(SUM(CASE WHEN v.estado='PAGADA' THEN GREATEST(v.total - COALESCE(dev.total_devuelto,0),0) ELSE 0 END),0) total_pagado,
            COALESCE(SUM(CASE WHEN v.estado='EMITIDA' THEN GREATEST(v.saldo - COALESCE(dev.total_devuelto,0),0) ELSE 0 END),0) total_pendiente,
            SUM(CASE WHEN v.estado='PAGADA' THEN 1 ELSE 0 END) tickets_pagados,
            SUM(CASE WHEN v.estado='EMITIDA' THEN 1 ELSE 0 END) tickets_pendientes
       FROM venta v
       ${devVentaJoin('v')}
       ${sql}`,
    b.params
  );

  const ded = await deduccionesTotales(req);
  const meta = {
    ...(metaRaw || {}),
    total_bruto: num(metaRaw?.total_bruto),
    total_neto: num(metaRaw?.total_neto),
    total_pagado: num(metaRaw?.total_pagado),
    total_pendiente: num(metaRaw?.total_pendiente),
    devoluciones: num(metaRaw?.devoluciones),
    deducciones: ded.total_deducciones,
    cantidad_deducciones: ded.cantidad_deducciones,
    dinero_real: Math.max(0, num(metaRaw?.total_pagado) - ded.total_deducciones),
    utilidad_operativa: Math.max(0, num(metaRaw?.total_pagado) + num(metaRaw?.total_pendiente) - ded.total_deducciones),
  };

  ok(res, { items, meta });
}

async function topProductos(req, res) {
  const b = baseWhere(req, 'v', 'v.fecha');
  b.where.push(ESTADOS_REPORTE);
  b.where.push(`vd.item_tipo = 'PRODUCTO'`);
  categoriaFilter(req, b.where, b.params, 'p');
  const sql = b.where.length ? `WHERE ${b.where.join(' AND ')}` : '';
  const limit = Number(req.query.limit || 20);
  const neto = detalleNetoExpr();
  const dg = descuentoGeneralAsignadoExpr();

  const [items] = await pool.query(
    `SELECT p.id producto_id,
            p.nombre,
            p.codigo,
            c.nombre categoria_nombre,
            COALESCE(SUM(vd.cantidad),0) unidades_brutas,
            COALESCE(SUM(COALESCE(devd.cantidad_devuelta,0)),0) unidades_devueltas,
            COALESCE(SUM(vd.cantidad - COALESCE(devd.cantidad_devuelta,0)),0) unidades,
            COALESCE(SUM(vd.cantidad * vd.precio_unitario),0) subtotal_bruto,
            COALESCE(SUM(vd.descuento),0) descuentos_linea,
            COALESCE(SUM(${dg}),0) descuento_general_asignado,
            COALESCE(SUM(COALESCE(devd.total_devuelto,0)),0) devoluciones,
            COALESCE(SUM(${neto}),0) total,
            COUNT(DISTINCT v.id) tickets
       FROM venta_detalle vd
       JOIN venta v ON v.id = vd.venta_id
       JOIN producto p ON p.id = vd.producto_id
       LEFT JOIN categoria c ON c.id = p.categoria_id
       ${devDetalleJoin('vd')}
       ${sql}
      GROUP BY p.id,p.nombre,p.codigo,c.nombre
      ORDER BY total DESC
      LIMIT ?`,
    [...b.params, limit]
  );
  ok(res, { items, total: items.length });
}

async function ventasPorCategoria(req, res) {
  const b = baseWhere(req, 'v', 'v.fecha');
  b.where.push(ESTADOS_REPORTE);
  b.where.push(`vd.item_tipo = 'PRODUCTO'`);
  const categoriaId = Number(req.query.categoria_id || 0);
  if (categoriaId > 0) { b.where.push('c.id = ?'); b.params.push(categoriaId); }
  const sql = b.where.length ? `WHERE ${b.where.join(' AND ')}` : '';
  const neto = detalleNetoExpr();
  const dg = descuentoGeneralAsignadoExpr();

  const [items] = await pool.query(
    `SELECT c.id categoria_id,
            COALESCE(c.nombre,'Sin categoría') categoria_nombre,
            COALESCE(SUM(vd.cantidad - COALESCE(devd.cantidad_devuelta,0)),0) unidades,
            COALESCE(SUM(vd.cantidad * vd.precio_unitario),0) subtotal_bruto,
            COALESCE(SUM(vd.descuento),0) descuentos_linea,
            COALESCE(SUM(${dg}),0) descuento_general_asignado,
            COALESCE(SUM(COALESCE(devd.total_devuelto,0)),0) devoluciones,
            COALESCE(SUM(${neto}),0) total,
            COUNT(DISTINCT v.id) tickets
       FROM venta_detalle vd
       JOIN venta v ON v.id = vd.venta_id
       JOIN producto p ON p.id = vd.producto_id
       LEFT JOIN categoria c ON c.id = p.categoria_id
       ${devDetalleJoin('vd')}
       ${sql}
      GROUP BY c.id,c.nombre
      ORDER BY total DESC`,
    b.params
  );
  ok(res, { items, total: items.length });
}

async function productosPorCategoria(req, res) {
  const b = baseWhere(req, 'v', 'v.fecha');
  b.where.push(ESTADOS_REPORTE);
  b.where.push(`vd.item_tipo = 'PRODUCTO'`);
  categoriaFilter(req, b.where, b.params, 'p');
  const sql = b.where.length ? `WHERE ${b.where.join(' AND ')}` : '';
  const neto = detalleNetoExpr();
  const dg = descuentoGeneralAsignadoExpr();

  const [items] = await pool.query(
    `SELECT COALESCE(c.nombre,'Sin categoría') categoria_nombre,
            p.id producto_id,
            p.codigo,
            p.nombre producto_nombre,
            COALESCE(SUM(vd.cantidad - COALESCE(devd.cantidad_devuelta,0)),0) unidades,
            COALESCE(SUM(vd.cantidad * vd.precio_unitario),0) subtotal_bruto,
            COALESCE(SUM(vd.descuento),0) descuentos_linea,
            COALESCE(SUM(${dg}),0) descuento_general_asignado,
            COALESCE(SUM(COALESCE(devd.total_devuelto,0)),0) devoluciones,
            COALESCE(SUM(${neto}),0) total,
            COUNT(DISTINCT v.id) tickets
       FROM venta_detalle vd
       JOIN venta v ON v.id = vd.venta_id
       JOIN producto p ON p.id = vd.producto_id
       LEFT JOIN categoria c ON c.id = p.categoria_id
       ${devDetalleJoin('vd')}
       ${sql}
      GROUP BY c.nombre,p.id,p.codigo,p.nombre
      ORDER BY total DESC`,
    b.params
  );
  ok(res, { items, total: items.length });
}

async function movimientosDetalle(req, res) {
  const scopeV = addScopeWhere(req, 'v');
  const whereVentas = [...scopeV.where, ESTADOS_REPORTE];
  const paramsVentas = [...scopeV.params];
  const rVentas = colombiaDateRange(req.query.desde, req.query.hasta, 'v.fecha');
  whereVentas.push(...rVentas.where);
  paramsVentas.push(...rVentas.params);
  const categoriaId = Number(req.query.categoria_id || 0);
  if (categoriaId > 0) { whereVentas.push('p.categoria_id = ?'); paramsVentas.push(categoriaId); }
  const whereVentasSql = `WHERE ${whereVentas.join(' AND ')}`;

  const scopeD = addScopeWhere(req, 'dv');
  const whereDev = [...scopeD.where, 'dv.activo = 1'];
  const paramsDev = [...scopeD.params];
  const rDev = colombiaDateRange(req.query.desde, req.query.hasta, 'dv.fecha');
  whereDev.push(...rDev.where);
  paramsDev.push(...rDev.params);
  if (categoriaId > 0) { whereDev.push('p.categoria_id = ?'); paramsDev.push(categoriaId); }
  const whereDevSql = `WHERE ${whereDev.join(' AND ')}`;

  const limit = Math.min(Number(req.query.limit || 300), 1000);
  const [items] = await pool.query(
    `(SELECT v.id venta_id,
             v.estado,
             DATE_FORMAT(DATE_SUB(v.fecha, INTERVAL 5 HOUR),'%Y-%m-%d %H:%i:%s') fecha_colombia,
             'VENTA' tipo_movimiento,
             s.nombre sede_nombre,
             COALESCE(c.nombre,'Sin categoría') categoria_nombre,
             vd.item_tipo,
             COALESCE(p.nombre, sv.nombre, vd.nombre_item) item_nombre,
             COALESCE(p.codigo, sv.codigo, vd.codigo_item) codigo,
             vd.cantidad cantidad,
             vd.precio_unitario,
             vd.descuento descuento_producto,
             COALESCE(v.descuento * (vd.total_linea / NULLIF(v.subtotal,0)),0) descuento_general_asignado,
             0 devolucion,
             GREATEST(vd.total_linea - COALESCE(v.descuento * (vd.total_linea / NULLIF(v.subtotal,0)),0),0) total_neto
        FROM venta v
        JOIN venta_detalle vd ON vd.venta_id = v.id
        LEFT JOIN producto p ON p.id = vd.producto_id
        LEFT JOIN servicio sv ON sv.id = vd.servicio_id
        LEFT JOIN categoria c ON c.id = COALESCE(p.categoria_id, sv.categoria_id)
        LEFT JOIN sede s ON s.id = v.sede_id
        ${whereVentasSql})
      UNION ALL
      (SELECT v.id venta_id,
             v.estado,
             DATE_FORMAT(DATE_SUB(dv.fecha, INTERVAL 5 HOUR),'%Y-%m-%d %H:%i:%s') fecha_colombia,
             'DEVOLUCION' tipo_movimiento,
             s.nombre sede_nombre,
             COALESCE(c.nombre,'Sin categoría') categoria_nombre,
             dvd.item_tipo,
             COALESCE(p.nombre, sv.nombre, dvd.nombre_item) item_nombre,
             COALESCE(p.codigo, sv.codigo, vd.codigo_item) codigo,
             -dvd.cantidad cantidad,
             dvd.precio_unitario,
             0 descuento_producto,
             0 descuento_general_asignado,
             dvd.total_linea devolucion,
             -dvd.total_linea total_neto
        FROM devolucion_venta dv
        JOIN devolucion_venta_detalle dvd ON dvd.devolucion_id = dv.id
        JOIN venta_detalle vd ON vd.id = dvd.venta_detalle_id
        JOIN venta v ON v.id = dv.venta_id
        LEFT JOIN producto p ON p.id = dvd.producto_id
        LEFT JOIN servicio sv ON sv.id = dvd.servicio_id
        LEFT JOIN categoria c ON c.id = COALESCE(p.categoria_id, sv.categoria_id)
        LEFT JOIN sede s ON s.id = dv.sede_id
        ${whereDevSql})
      ORDER BY fecha_colombia DESC, venta_id DESC
      LIMIT ?`,
    [...paramsVentas, ...paramsDev, limit]
  );
  ok(res, { items, total: items.length });
}

async function stock(req, res) {
  const scope = addScopeWhere(req, 'p');
  const where = [...scope.where];
  const params = [...scope.params];
  if (Number(req.query.solo_bajo_minimo || 0) === 1) {
    where.push(`(SELECT COALESCE(SUM(m.cantidad),0) FROM inv_movimiento m WHERE m.producto_id=p.id AND m.sede_id=p.sede_id AND m.activo=1) <= p.stock_minimo`);
  }
  const sql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [items] = await pool.query(
    `SELECT p.id producto_id,p.nombre,p.stock_minimo,p.costo costo_promedio,
            (SELECT COALESCE(SUM(m.cantidad),0) FROM inv_movimiento m WHERE m.producto_id=p.id AND m.sede_id=p.sede_id AND m.activo=1) stock_actual
       FROM producto p ${sql}
      ORDER BY p.nombre LIMIT 500`,
    params
  );
  ok(res, { items, total: items.length });
}

async function pagosPorMetodo(req, res) {
  const b = baseWhere(req, 'v', 'v.fecha');
  b.where.push(ESTADOS_REPORTE);
  const sql = b.where.length ? `WHERE ${b.where.join(' AND ')}` : '';
  const [items] = await pool.query(
    `SELECT CASE WHEN vp.metodo='TRANSFERENCIA' THEN CONCAT('TRANSFERENCIA - ', COALESCE(vp.entidad_transferencia,'SIN DEFINIR')) ELSE vp.metodo END metodo,
            COALESCE(SUM(vp.monto),0) total
       FROM venta_pago vp
       JOIN venta v ON v.id = vp.venta_id
       ${sql} AND vp.anulado = 0
      GROUP BY CASE WHEN vp.metodo='TRANSFERENCIA' THEN CONCAT('TRANSFERENCIA - ', COALESCE(vp.entidad_transferencia,'SIN DEFINIR')) ELSE vp.metodo END
      ORDER BY total DESC`,
    b.params
  );
  ok(res, { items, total: items.length });
}

async function cxc(req, res) {
  const b = baseWhere(req, 'v', 'v.fecha');
  b.where.push(`v.saldo > 0 AND ${ESTADOS_REPORTE}`);
  const sql = b.where.length ? `WHERE ${b.where.join(' AND ')}` : '';
  const [items] = await pool.query(
    `SELECT v.id venta_id,c.nombre cliente,
            DATE_FORMAT(DATE_SUB(v.fecha, INTERVAL 5 HOUR),'%Y-%m-%d %H:%i:%s') fecha_colombia,
            v.fecha,v.total,v.pagado,v.saldo,s.nombre sede_nombre
       FROM venta v
       LEFT JOIN cliente c ON c.id = v.cliente_id
       LEFT JOIN sede s ON s.id = v.sede_id
       ${sql}
      ORDER BY v.fecha DESC`,
    b.params
  );
  ok(res, { items, total: items.length });
}

async function ventasPorUsuario(req, res) {
  const b = baseWhere(req, 'v', 'v.fecha');
  b.where.push(ESTADOS_REPORTE);
  const sql = b.where.length ? `WHERE ${b.where.join(' AND ')}` : '';
  const [items] = await pool.query(
    `SELECT u.id usuario_id,u.nombre usuario_nombre,s.nombre sede_nombre,
            COUNT(*) tickets,
            COALESCE(SUM(v.total),0) bruto,
            COALESCE(SUM(COALESCE(dev.total_devuelto,0)),0) devoluciones,
            COALESCE(SUM(GREATEST(v.total - COALESCE(dev.total_devuelto,0),0)),0) total
       FROM venta v
       JOIN usuario u ON u.id = v.usuario_id
       LEFT JOIN sede s ON s.id = v.sede_id
       ${devVentaJoin('v')}
       ${sql}
      GROUP BY u.id,u.nombre,s.nombre
      ORDER BY total DESC`,
    b.params
  );
  ok(res, { items, total: items.length });
}

async function resumenAdmin(req, res) {
  const b = baseWhere(req, 'v', 'v.fecha');
  b.where.push(ESTADOS_REPORTE);
  const sql = b.where.length ? `WHERE ${b.where.join(' AND ')}` : '';

  const [porSede] = await pool.query(
    `SELECT e.nombre empresa_nombre,
            s.id sede_id,
            s.nombre sede_nombre,
            COUNT(v.id) tickets,
            COALESCE(SUM(v.total),0) total_bruto,
            COALESCE(SUM(COALESCE(dev.total_devuelto,0)),0) devoluciones,
            COALESCE(SUM(GREATEST(v.total - COALESCE(dev.total_devuelto,0),0)),0) total_neto,
            COALESCE(SUM(v.descuento),0) descuentos,
            COALESCE(SUM(CASE WHEN v.estado='PAGADA' THEN GREATEST(v.total - COALESCE(dev.total_devuelto,0),0) ELSE 0 END),0) pagado,
            COALESCE(SUM(CASE WHEN v.estado='EMITIDA' THEN GREATEST(v.saldo - COALESCE(dev.total_devuelto,0),0) ELSE 0 END),0) saldo,
            COALESCE((SELECT SUM(d.monto) FROM deduccion d WHERE d.sede_id=s.id AND d.activo=1 ${colombiaDateRange(req.query.desde, req.query.hasta, 'd.fecha').where.map(w => 'AND ' + w).join(' ')}),0) deducciones
       FROM sede s
       JOIN empresa e ON e.id = s.empresa_id
       LEFT JOIN venta v ON v.sede_id = s.id
       ${devVentaJoin('v')}
       ${sql.replace('WHERE', 'AND')}
      GROUP BY e.nombre,s.id,s.nombre
      ORDER BY e.nombre,s.nombre`,
    [...colombiaDateRange(req.query.desde, req.query.hasta, 'd.fecha').params, ...b.params]
  );
  ok(res, {
    items: porSede,
    total_general: porSede.reduce((a, b) => a + num(b.total_neto), 0),
    devoluciones_general: porSede.reduce((a, b) => a + num(b.devoluciones), 0),
    deducciones_general: porSede.reduce((a, b) => a + num(b.deducciones), 0),
    dinero_real_general: porSede.reduce((a, b) => a + Math.max(0, num(b.pagado) - num(b.deducciones)), 0),
  });
}

module.exports = {
  ventasSeries,
  topProductos,
  ventasPorCategoria,
  productosPorCategoria,
  movimientosDetalle,
  stock,
  pagosPorMetodo,
  cxc,
  ventasPorUsuario,
  resumenAdmin,
};
