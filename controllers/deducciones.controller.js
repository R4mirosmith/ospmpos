const { pool, pageLimit } = require('../utils/sql');
const { ok, created, badRequest, notFound } = require('../utils/http');
const { writeScope, addScopeWhere, colombiaDateRange, clean, isAdmin } = require('../utils/scope');

function num(v, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

async function conceptos(req, res) {
  const scope = addScopeWhere(req, 'dc');
  const where = [...scope.where];
  const params = [...scope.params];
  const activo = clean(req.query.activo);
  if (activo !== null) { where.push('dc.activo = ?'); params.push(Number(activo)); }
  if (clean(req.query.q)) { where.push('(dc.nombre LIKE ? OR dc.tipo LIKE ?)'); params.push(`%${req.query.q}%`, `%${req.query.q}%`); }
  const [items] = await pool.query(
    `SELECT dc.*, s.nombre sede_nombre, s.nit sede_nit
       FROM deduccion_concepto dc
       LEFT JOIN sede s ON s.id = dc.sede_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY dc.nombre ASC`,
    params
  );
  ok(res, { items, total: items.length });
}

async function crearConcepto(req, res) {
  const s = await writeScope(req);
  const nombre = clean(req.body?.nombre);
  const tipo = clean(req.body?.tipo) || 'OTRO';
  if (!nombre) return badRequest(res, 'Nombre del concepto requerido');
  const [r] = await pool.query(
    `INSERT INTO deduccion_concepto(empresa_id,sede_id,nombre,tipo,activo,fecha)
     VALUES(?,?,?,?,?,UTC_TIMESTAMP())`,
    [s.empresa_id, s.sede_id, nombre, tipo, req.body?.activo === 0 ? 0 : 1]
  );
  created(res, { id: r.insertId, message: 'Concepto creado' });
}

async function actualizarConcepto(req, res) {
  const id = Number(req.params.id);
  const scope = addScopeWhere(req, 'dc');
  const [r] = await pool.query(
    `UPDATE deduccion_concepto dc
        SET dc.nombre = COALESCE(?, dc.nombre),
            dc.tipo = COALESCE(?, dc.tipo),
            dc.activo = COALESCE(?, dc.activo)
      WHERE dc.id = ? ${scope.where.length ? 'AND ' + scope.where.join(' AND ') : ''}`,
    [clean(req.body?.nombre), clean(req.body?.tipo), req.body?.activo === undefined ? null : (req.body.activo ? 1 : 0), id, ...scope.params]
  );
  if (!r.affectedRows) return notFound(res, 'Concepto no encontrado en esta sede');
  ok(res, { id, message: 'Concepto actualizado' });
}

async function listar(req, res) {
  const { limit, offset } = pageLimit(req.query.page, req.query.pageSize || 20);
  const scope = addScopeWhere(req, 'd');
  const where = [...scope.where, 'd.activo = 1'];
  const params = [...scope.params];
  const r = colombiaDateRange(req.query.desde, req.query.hasta, 'd.fecha');
  where.push(...r.where); params.push(...r.params);
  if (clean(req.query.q)) {
    where.push('(d.descripcion LIKE ? OR dc.nombre LIKE ? OR u.nombre LIKE ? OR sd.nombre LIKE ?)');
    params.push(`%${req.query.q}%`, `%${req.query.q}%`, `%${req.query.q}%`, `%${req.query.q}%`);
  }
  if (Number(req.query.concepto_id || 0)) { where.push('d.concepto_id = ?'); params.push(Number(req.query.concepto_id)); }
  if (Number(req.query.empleado_usuario_id || 0)) { where.push('d.empleado_usuario_id = ?'); params.push(Number(req.query.empleado_usuario_id)); }
  const sql = `WHERE ${where.join(' AND ')}`;
  const [[cnt]] = await pool.query(
    `SELECT COUNT(*) total, COALESCE(SUM(d.monto),0) total_deducciones
       FROM deduccion d
       LEFT JOIN deduccion_concepto dc ON dc.id = d.concepto_id
       LEFT JOIN usuario u ON u.id = d.empleado_usuario_id
       LEFT JOIN sede sd ON sd.id = d.sede_destino_id
       ${sql}`,
    params
  );
  const [items] = await pool.query(
    `SELECT d.*,
            DATE_FORMAT(DATE_SUB(d.fecha, INTERVAL 5 HOUR),'%Y-%m-%d %H:%i:%s') fecha_colombia,
            dc.nombre concepto_nombre,
            dc.tipo concepto_tipo,
            u.nombre empleado_nombre,
            u.email empleado_email,
            s.nombre sede_nombre,
            s.nit sede_nit,
            sd.nombre sede_destino_nombre,
            sd.nit sede_destino_nit,
            uc.nombre creado_por_nombre
       FROM deduccion d
       LEFT JOIN deduccion_concepto dc ON dc.id = d.concepto_id
       LEFT JOIN usuario u ON u.id = d.empleado_usuario_id
       LEFT JOIN sede s ON s.id = d.sede_id
       LEFT JOIN sede sd ON sd.id = d.sede_destino_id
       LEFT JOIN usuario uc ON uc.id = d.created_by
       ${sql}
      ORDER BY d.fecha DESC, d.id DESC
      LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  ok(res, { items, total: Number(cnt.total || 0), total_deducciones: num(cnt.total_deducciones) });
}

async function crear(req, res) {
  const s = await writeScope(req);
  const conceptoId = Number(req.body?.concepto_id || 0);
  const monto = num(req.body?.monto);
  if (!conceptoId) return badRequest(res, 'Selecciona un concepto');
  if (monto <= 0) return badRequest(res, 'El monto debe ser mayor a cero');

  const [[concepto]] = await pool.query(
    `SELECT id FROM deduccion_concepto WHERE id = ? AND sede_id = ? AND activo = 1`,
    [conceptoId, s.sede_id]
  );
  if (!concepto) return badRequest(res, 'Concepto no válido para la sede activa');

  const empleadoId = Number(req.body?.empleado_usuario_id || 0) || null;
  const sedeDestinoId = Number(req.body?.sede_destino_id || 0) || null;
  if (sedeDestinoId) {
    const [[destino]] = await pool.query(`SELECT id FROM sede WHERE id=? AND activo=1`, [sedeDestinoId]);
    if (!destino) return badRequest(res, 'La sede destino no existe o está inactiva');
  }
  if (empleadoId) {
    const [[empleado]] = await pool.query(`SELECT id FROM usuario WHERE id=? AND activo=1`, [empleadoId]);
    if (!empleado) return badRequest(res, 'Empleado/usuario no válido');
  }

  const fecha = clean(req.body?.fecha) ? `${String(req.body.fecha).slice(0, 10)} 05:00:00` : null;
  const [r] = await pool.query(
    `INSERT INTO deduccion(empresa_id,sede_id,concepto_id,empleado_usuario_id,sede_destino_id,descripcion,monto,fecha,created_by,activo)
     VALUES(?,?,?,?,?,?,?,COALESCE(?, UTC_TIMESTAMP()),?,1)`,
    [s.empresa_id, s.sede_id, conceptoId, empleadoId, sedeDestinoId, clean(req.body?.descripcion), monto, fecha, req.user.id]
  );
  created(res, { id: r.insertId, message: 'Deducción registrada' });
}

async function anular(req, res) {
  const id = Number(req.params.id);
  const scope = addScopeWhere(req, 'd');
  const [r] = await pool.query(
    `UPDATE deduccion d SET d.activo = 0 WHERE d.id = ? ${scope.where.length ? 'AND ' + scope.where.join(' AND ') : ''}`,
    [id, ...scope.params]
  );
  if (!r.affectedRows) return notFound(res, 'Deducción no encontrada en esta sede');
  ok(res, { id, message: 'Deducción anulada' });
}

async function resumen(req, res) {
  const scope = addScopeWhere(req, 'd');
  const where = [...scope.where, 'd.activo = 1'];
  const params = [...scope.params];
  const r = colombiaDateRange(req.query.desde, req.query.hasta, 'd.fecha');
  where.push(...r.where); params.push(...r.params);
  const sql = `WHERE ${where.join(' AND ')}`;
  const [porConcepto] = await pool.query(
    `SELECT dc.id concepto_id, dc.nombre concepto_nombre, dc.tipo concepto_tipo,
            COUNT(*) cantidad, COALESCE(SUM(d.monto),0) total
       FROM deduccion d
       JOIN deduccion_concepto dc ON dc.id = d.concepto_id
       ${sql}
      GROUP BY dc.id, dc.nombre, dc.tipo
      ORDER BY total DESC`,
    params
  );
  const [porSede] = await pool.query(
    `SELECT s.id sede_id, s.nombre sede_nombre, s.nit sede_nit, COUNT(*) cantidad, COALESCE(SUM(d.monto),0) total
       FROM deduccion d
       JOIN sede s ON s.id = d.sede_id
       ${sql}
      GROUP BY s.id, s.nombre, s.nit
      ORDER BY total DESC`,
    params
  );
  ok(res, {
    total_deducciones: porConcepto.reduce((a, b) => a + num(b.total), 0),
    por_concepto: porConcepto,
    por_sede: porSede,
  });
}

module.exports = { conceptos, crearConcepto, actualizarConcepto, listar, crear, anular, resumen };
