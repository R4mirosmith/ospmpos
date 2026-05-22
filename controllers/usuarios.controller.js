const { pool } = require('../db/pool');
const { ok, created, badRequest } = require('../utils/http');
const { makeHash } = require('../utils/password');
const { clean, toInt } = require('../utils/scope');

async function listar(req, res) {
  const buscar = clean(req.query.buscar);
  const activo = clean(req.query.activo);
  const where = [];
  const params = [];

  if (buscar) {
    where.push('(u.nombre LIKE ? OR u.email LIKE ?)');
    params.push(`%${buscar}%`, `%${buscar}%`);
  }

  if (activo !== null) {
    where.push('u.activo = ?');
    params.push(Number(activo));
  }

  const [rows] = await pool.query(
    `SELECT
        u.id,
        u.usuario_tipo_id,
        ut.tipo AS usuario_tipo,
        u.nombre,
        u.email,
        u.activo,
        u.fecha,
        s.id AS sede_id,
        s.nombre AS sede_nombre,
        s.nit AS sede_nit,
        s.razon_social AS sede_razon_social,
        e.id AS empresa_id,
        e.nombre AS empresa_nombre
       FROM usuario u
       JOIN usuario_tipo ut ON ut.id = u.usuario_tipo_id
       LEFT JOIN usuario_sede us ON us.usuario_id = u.id AND us.activo = 1
       LEFT JOIN sede s ON s.id = us.sede_id
       LEFT JOIN empresa e ON e.id = s.empresa_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY u.nombre ASC, s.nombre ASC`,
    params
  );

  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.id)) {
      map.set(r.id, {
        id: r.id,
        usuario_tipo_id: r.usuario_tipo_id,
        usuario_tipo: r.usuario_tipo,
        nombre: r.nombre,
        email: r.email,
        activo: r.activo,
        fecha: r.fecha,
        sedes: [],
        sede_ids: []
      });
    }

    const u = map.get(r.id);
    if (r.sede_id) {
      u.sedes.push({
        sede_id: r.sede_id,
        sede_nombre: r.sede_nombre,
        sede_nit: r.sede_nit,
        sede_razon_social: r.sede_razon_social,
        empresa_id: r.empresa_id,
        empresa_nombre: r.empresa_nombre
      });
      u.sede_ids.push(r.sede_id);
    }
  }

  const items = [...map.values()];
  ok(res, { items, total: items.length });
}

async function get(req, res) {
  const id = Number(req.params.id);
  const [rows] = await pool.query(`SELECT id, usuario_tipo_id, nombre, email, activo FROM usuario WHERE id=?`, [id]);
  const user = rows[0];
  if (!user) return badRequest(res, 'Usuario no encontrado');
  const [sedes] = await pool.query(`SELECT sede_id FROM usuario_sede WHERE usuario_id=? AND activo=1`, [id]);
  ok(res, { ...user, sede_ids: sedes.map(s => s.sede_id) });
}
async function crear(req, res) {
  const { usuario_tipo_id, nombre, email, password, activo = 1, sede_ids = [] } = req.body || {};
  if (!usuario_tipo_id || !nombre || !email || !password) return badRequest(res, 'usuario_tipo_id, nombre, email y password requeridos');
  if (!Array.isArray(sede_ids) || !sede_ids.map(Number).filter(Boolean).length) return badRequest(res, 'Selecciona al menos una sede para el usuario');
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [r] = await conn.query(
      `INSERT INTO usuario(usuario_tipo_id,nombre,hash_password,email,activo,fecha) VALUES(?,?,?,?,?,UTC_TIMESTAMP())`,
      [usuario_tipo_id, nombre, makeHash(password), email, activo ? 1 : 0]
    );
    await syncSedes(conn, r.insertId, sede_ids);
    await conn.commit();
    created(res, { id: r.insertId, message: 'Usuario creado' });
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
}
async function actualizar(req, res) {
  const id = Number(req.params.id);
  const { usuario_tipo_id, nombre, email, activo, sede_ids } = req.body || {};
  if (Array.isArray(sede_ids) && !sede_ids.map(Number).filter(Boolean).length) {
    return badRequest(res, 'Selecciona al menos una sede para el usuario');
  }
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      `UPDATE usuario SET usuario_tipo_id=COALESCE(?,usuario_tipo_id), nombre=COALESCE(?,nombre), email=COALESCE(?,email), activo=COALESCE(?,activo), fecha=UTC_TIMESTAMP() WHERE id=?`,
      [toInt(usuario_tipo_id, null), clean(nombre), clean(email), activo === undefined ? null : (activo ? 1 : 0), id]
    );
    if (Array.isArray(sede_ids)) await syncSedes(conn, id, sede_ids);
    await conn.commit();
    ok(res, { id, message: 'Usuario actualizado' });
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
}
async function setPassword(req, res) {
  const id = Number(req.params.id);
  const pass = req.body?.new_password;
  if (!pass) return badRequest(res, 'new_password requerido');
  await pool.query(`UPDATE usuario SET hash_password=?, fecha=UTC_TIMESTAMP() WHERE id=?`, [makeHash(pass), id]);
  ok(res, { id, message: 'Contraseña actualizada' });
}
async function estado(req, res) {
  await pool.query(`UPDATE usuario SET activo=? WHERE id=?`, [req.body?.activo ? 1 : 0, Number(req.params.id)]);
  ok(res, { id: Number(req.params.id), activo: req.body?.activo ? 1 : 0 });
}
async function syncSedes(conn, userId, sedeIds) {
  await conn.query(`UPDATE usuario_sede SET activo=0 WHERE usuario_id=?`, [userId]);
  const ids = [...new Set((sedeIds || []).map(Number).filter(Boolean))];
  for (const sedeId of ids) {
    await conn.query(
      `INSERT INTO usuario_sede(usuario_id,sede_id,activo,fecha_creacion)
       VALUES(?,?,1,UTC_TIMESTAMP())
       ON DUPLICATE KEY UPDATE activo=1`,
      [userId, sedeId]
    );
  }
}
module.exports = { listar, get, crear, actualizar, setPassword, estado };
