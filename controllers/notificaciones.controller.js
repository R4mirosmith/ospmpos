const { pool } = require('../utils/sql');
const { ok, created, badRequest, notFound } = require('../utils/http');

async function listarConfig(req, res) {
  const sedeId = req.query.sede_id ? Number(req.query.sede_id) : null;
  const [items] = await pool.query(
    `SELECT nc.*, u.nombre usuario_nombre, u.email, s.nombre sede_nombre, e.nombre empresa_nombre
       FROM notificacion_config nc
       JOIN usuario u ON u.id=nc.usuario_id
       JOIN sede s ON s.id=nc.sede_id
       JOIN empresa e ON e.id=s.empresa_id
      WHERE (? IS NULL OR nc.sede_id=?)
      ORDER BY e.nombre,s.nombre,u.nombre`,
    [sedeId, sedeId]
  );
  ok(res, { items, total: items.length });
}

async function guardarConfig(req, res) {
  const { sede_id, usuario_id, tipo = 'PEDIDO_WEB', activo = 1 } = req.body || {};
  const sedeId = Number(sede_id);
  const usuarioId = Number(usuario_id);
  if (!sedeId || !usuarioId) return badRequest(res, 'sede_id y usuario_id requeridos');

  const [[sede]] = await pool.query(
    `SELECT s.empresa_id
       FROM sede s
       JOIN empresa e ON e.id=s.empresa_id
      WHERE s.id=? AND s.activo=1 AND e.activo=1
      LIMIT 1`,
    [sedeId]
  );
  if (!sede) return badRequest(res, 'La sede no existe o está inactiva');

  const [[usuario]] = await pool.query(
    `SELECT u.id
       FROM usuario u
       JOIN usuario_sede us ON us.usuario_id=u.id AND us.sede_id=? AND us.activo=1
      WHERE u.id=? AND u.activo=1
      LIMIT 1`,
    [sedeId, usuarioId]
  );
  if (!usuario) return badRequest(res, 'El usuario no está activo o no pertenece a esa sede');

  const [r] = await pool.query(
    `INSERT INTO notificacion_config(empresa_id,sede_id,usuario_id,tipo,activo,fecha_creacion)
     VALUES(?,?,?,?,?,UTC_TIMESTAMP())
     ON DUPLICATE KEY UPDATE activo=VALUES(activo)`,
    [sede.empresa_id, sedeId, usuarioId, String(tipo || 'PEDIDO_WEB').toUpperCase(), activo ? 1 : 0]
  );
  created(res, { id: r.insertId || null, message: 'Configuración guardada' });
}

async function estadoConfig(req, res) {
  const id = Number(req.params.id);
  const [r] = await pool.query(
    `UPDATE notificacion_config SET activo=? WHERE id=?`,
    [req.body?.activo ? 1 : 0, id]
  );
  if (!r.affectedRows) return notFound(res, 'Configuración no encontrada');
  ok(res, { id });
}

module.exports = { listarConfig, guardarConfig, estadoConfig };
