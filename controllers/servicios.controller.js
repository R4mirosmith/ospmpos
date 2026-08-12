const { pool, pageLimit } = require('../utils/sql');
const { ok, created, badRequest, notFound } = require('../utils/http');
const { writeScope, addScopeWhere, clean, toInt } = require('../utils/scope');

async function listar(req, res) {
  const { limit, offset } = pageLimit(req.query.page, req.query.pageSize);
  const scope = addScopeWhere(req, 'sv');
  const where = [...scope.where];
  const params = [...scope.params];
  const buscar = clean(req.query.buscar);

  if (buscar) {
    where.push('(sv.nombre LIKE ? OR sv.codigo LIKE ?)');
    params.push(`%${buscar}%`, `%${buscar}%`);
  }
  if (toInt(req.query.categoria_id, null)) {
    where.push('sv.categoria_id = ?');
    params.push(Number(req.query.categoria_id));
  }
  if (clean(req.query.activo) !== null) {
    where.push('sv.activo = ?');
    params.push(Number(req.query.activo));
  }

  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [[cnt]] = await pool.query(`SELECT COUNT(*) total FROM servicio sv ${w}`, params);
  const [items] = await pool.query(
    `SELECT sv.*, c.nombre AS categoria_nombre, s.nombre AS sede_nombre, s.nit AS sede_nit
       FROM servicio sv
       LEFT JOIN categoria c ON c.id = sv.categoria_id
       LEFT JOIN sede s ON s.id = sv.sede_id
       ${w}
       ORDER BY sv.id DESC
       LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  ok(res, { items, total: Number(cnt.total || 0) });
}

async function get(req, res) {
  const scope = addScopeWhere(req, 'sv');
  const [rows] = await pool.query(
    `SELECT sv.*, c.nombre AS categoria_nombre
       FROM servicio sv
       LEFT JOIN categoria c ON c.id = sv.categoria_id
      WHERE sv.id = ? ${scope.where.length ? 'AND ' + scope.where.join(' AND ') : ''}`,
    [Number(req.params.id), ...scope.params]
  );
  ok(res, rows[0] || null);
}

async function crear(req, res) {
  const { categoria_id = null, codigo, nombre, descripcion = '', precio = 0, activo = 1 } = req.body || {};
  if (!codigo || !nombre) return badRequest(res, 'codigo y nombre requeridos');
  const valorPrecio = Number(precio || 0);
  if (!Number.isFinite(valorPrecio) || valorPrecio < 0) return badRequest(res, 'El precio debe ser un valor no negativo');

  const s = await writeScope(req);
  if (categoria_id) {
    const [[categoria]] = await pool.query(
      `SELECT id FROM categoria WHERE id=? AND sede_id=? AND activo=1 LIMIT 1`,
      [Number(categoria_id), s.sede_id]
    );
    if (!categoria) return badRequest(res, 'La categoría no pertenece a la sede activa o está inactiva');
  }

  const [r] = await pool.query(
    `INSERT INTO servicio(empresa_id,sede_id,categoria_id,codigo,nombre,descripcion,precio,activo,fecha)
     VALUES(?,?,?,?,?,?,?,?,UTC_TIMESTAMP())`,
    [s.empresa_id, s.sede_id, categoria_id || null, codigo, nombre, descripcion, valorPrecio, activo ? 1 : 0]
  );
  created(res, { id: r.insertId, message: 'Servicio creado' });
}

async function actualizar(req, res) {
  const id = Number(req.params.id);
  const scope = addScopeWhere(req, 'sv');
  const [[servicio]] = await pool.query(
    `SELECT sv.id, sv.sede_id FROM servicio sv WHERE sv.id=? ${scope.where.length ? 'AND ' + scope.where.join(' AND ') : ''} LIMIT 1`,
    [id, ...scope.params]
  );
  if (!servicio) return notFound(res, 'Servicio no encontrado en la sede activa');

  if (req.body?.precio !== undefined && req.body?.precio !== null && req.body?.precio !== '') {
    const valorPrecio = Number(req.body.precio);
    if (!Number.isFinite(valorPrecio) || valorPrecio < 0) return badRequest(res, 'El precio debe ser un valor no negativo');
  }
  if (req.body?.categoria_id !== undefined && req.body?.categoria_id !== null && req.body?.categoria_id !== '') {
    const [[categoria]] = await pool.query(
      `SELECT id FROM categoria WHERE id=? AND sede_id=? AND activo=1 LIMIT 1`,
      [Number(req.body.categoria_id), servicio.sede_id]
    );
    if (!categoria) return badRequest(res, 'La categoría no pertenece a la sede del servicio o está inactiva');
  }

  const fields = ['categoria_id', 'codigo', 'nombre', 'descripcion', 'precio', 'activo'];
  const upd = fields.filter(f => req.body?.[f] !== undefined);
  if (!upd.length) return ok(res, { id });
  await pool.query(
    `UPDATE servicio SET ${upd.map(f => `${f}=?`).join(', ')}, fecha=UTC_TIMESTAMP() WHERE id=? AND sede_id=?`,
    [...upd.map(f => f === 'activo' ? (req.body[f] ? 1 : 0) : (req.body[f] === '' ? null : req.body[f])), id, servicio.sede_id]
  );
  ok(res, { id, message: 'Servicio actualizado' });
}

async function estado(req, res) {
  req.body.activo = req.body?.activo ? 1 : 0;
  return actualizar(req, res);
}

module.exports = { listar, get, crear, actualizar, estado };
