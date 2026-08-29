const { pool } = require('../db/pool');
const { ok, badRequest, unauthorized } = require('../utils/http');
const { signAccess, signRefresh, verifyRefresh } = require('../utils/jwt');
const { verifyPassword, makeHash, needsRehash } = require('../utils/password');

async function userSedes(userId, role = '') {
  const isAdmin = String(role || '').toUpperCase() === 'ADMIN';

  // El admin global puede trabajar con cualquier negocio/sede activa, aunque no esté
  // amarrado en usuario_sede. Los vendedores solo ven sus sedes asignadas.
  if (isAdmin) {
    const [rows] = await pool.query(
      `SELECT s.id AS sede_id, s.nombre AS sede_nombre, s.codigo AS sede_codigo, s.nit AS sede_nit, s.razon_social AS sede_razon_social,
              e.id AS empresa_id, e.nombre AS empresa_nombre
         FROM sede s
         JOIN empresa e ON e.id = s.empresa_id AND e.activo = 1
        WHERE s.activo = 1
        ORDER BY s.nombre`
    );
    return rows;
  }

  const [rows] = await pool.query(
    `SELECT s.id AS sede_id, s.nombre AS sede_nombre, s.codigo AS sede_codigo, s.nit AS sede_nit, s.razon_social AS sede_razon_social,
            e.id AS empresa_id, e.nombre AS empresa_nombre
       FROM usuario_sede us
       JOIN sede s ON s.id = us.sede_id AND s.activo = 1
       JOIN empresa e ON e.id = s.empresa_id AND e.activo = 1
      WHERE us.usuario_id = ? AND us.activo = 1
      ORDER BY s.nombre`,
    [userId]
  );
  return rows;
}

function buildPayload(user, role, sede) {
  return {
    id: user.id,
    email: user.email,
    nombre: user.nombre,
    usuario_tipo_id: user.usuario_tipo_id,
    role,
    empresa_id: sede?.empresa_id || null,
    empresa_nombre: sede?.empresa_nombre || null,
    sede_id: sede?.sede_id || null,
    sede_nombre: sede?.sede_nombre || null,
    sede_codigo: sede?.sede_codigo || null,
    sede_nit: sede?.sede_nit || null,
    sede_razon_social: sede?.sede_razon_social || null,
  };
}


async function loginUsersCtrl(_req, res) {
  const [rows] = await pool.query(
    `SELECT u.id,
            u.nombre,
            u.email,
            ut.tipo AS role,
            CASE
              WHEN UPPER(ut.tipo) = 'ADMIN' THEN 'Todas las sedes activas'
              ELSE GROUP_CONCAT(DISTINCT s.nombre ORDER BY s.nombre SEPARATOR ', ')
            END AS sedes_nombre,
            CASE
              WHEN UPPER(ut.tipo) = 'ADMIN' THEN (SELECT COUNT(*) FROM sede sx WHERE sx.activo = 1)
              ELSE COUNT(DISTINCT us.sede_id)
            END AS sedes_count
       FROM usuario u
       JOIN usuario_tipo ut ON ut.id = u.usuario_tipo_id
       LEFT JOIN usuario_sede us ON us.usuario_id = u.id AND us.activo = 1
       LEFT JOIN sede s ON s.id = us.sede_id AND s.activo = 1
      WHERE u.activo = 1
      GROUP BY u.id, u.nombre, u.email, ut.tipo
      ORDER BY FIELD(UPPER(ut.tipo), 'ADMIN') DESC, u.nombre ASC`
  );

  return ok(res, rows.map((item) => ({
    id: item.id,
    nombre: item.nombre,
    email: item.email,
    role: String(item.role || 'USER').toUpperCase(),
    sedes_nombre: item.sedes_nombre || 'Sin sede asignada',
    sedes_count: Number(item.sedes_count || 0),
  })));
}

async function loginCtrl(req, res) {
  const { email, password } = req.body || {};
  if (!email || !password) return badRequest(res, 'email y password son requeridos');

  const [rows] = await pool.query(
    `SELECT u.*, ut.tipo AS role
       FROM usuario u
       JOIN usuario_tipo ut ON ut.id = u.usuario_tipo_id
      WHERE LOWER(u.email) = LOWER(TRIM(?))
      LIMIT 1`,
    [email]
  );
  const user = rows[0];
  if (!user || !verifyPassword(password, user.hash_password)) {
    return unauthorized(res, 'Usuario/contraseña inválidos');
  }
  if (Number(user.activo) !== 1) return unauthorized(res, 'Usuario inactivo');

  // Migra de forma transparente hashes antiguos al esquema scrypt al iniciar sesión.
  if (needsRehash(user.hash_password)) {
    await pool.query(`UPDATE usuario SET hash_password=?, fecha=UTC_TIMESTAMP() WHERE id=?`, [makeHash(password), user.id]);
  }

  const role = String(user.role || 'USER').toUpperCase();
  const sedes = await userSedes(user.id, role);
  if (!sedes.length) return unauthorized(res, 'El usuario no tiene sedes asignadas');

  const base = buildPayload(user, role, null);
  const tempToken = signAccess({ ...base, temp_login: true });
  const refreshToken = signRefresh({ id: user.id, role });

  // Importante: siempre obligamos a seleccionar negocio/sede en el login.
  // Aunque el usuario tenga una sola sede, se muestra la sede antes de entrar
  // para que quede claro dónde va a operar.
  return ok(res, {
    ...base,
    token: tempToken,
    refreshToken,
    requiere_sede: true,
    sedes,
    sede_id: null,
    sede_nombre: null,
    sede_codigo: null,
    sede_nit: null,
    sede_razon_social: null,
    empresa_id: null,
    empresa_nombre: null,
  });
}

async function selectSedeCtrl(req, res) {
  const userId = req.user?.id;
  const sedeId = Number(req.body?.sede_id);
  if (!userId || !Number.isFinite(sedeId)) return badRequest(res, 'sede_id requerido');

  const [[user], sedes] = await Promise.all([
    pool.query(`SELECT u.*, ut.tipo AS role FROM usuario u JOIN usuario_tipo ut ON ut.id=u.usuario_tipo_id WHERE u.id=? LIMIT 1`, [userId]).then(r => r[0]),
    userSedes(userId, String(req.user?.role || '').toUpperCase()),
  ]);
  const sede = sedes.find(s => Number(s.sede_id) === sedeId);
  if (!user || !sede) return unauthorized(res, 'Sede no autorizada para este usuario');

  const role = String(user.role || 'USER').toUpperCase();
  const payload = buildPayload(user, role, sede);
  return ok(res, { ...payload, sedes, token: signAccess(payload), refreshToken: signRefresh({ id: user.id, role }) });
}

async function refreshCtrl(req, res) {
  const { refreshToken, sede_id } = req.body || {};
  if (!refreshToken) return badRequest(res, 'refreshToken requerido');
  try {
    const payload = verifyRefresh(refreshToken);
    const [rows] = await pool.query(
      `SELECT u.*, ut.tipo AS role FROM usuario u JOIN usuario_tipo ut ON ut.id=u.usuario_tipo_id WHERE u.id=? LIMIT 1`,
      [payload.id]
    );
    const user = rows[0];
    if (!user) return unauthorized(res, 'Usuario no encontrado');
    if (Number(user.activo) !== 1) return unauthorized(res, 'Usuario inactivo');
    const role = String(user.role || payload.role || 'USER').toUpperCase();
    const sedes = await userSedes(user.id, role);
    if (!sedes.length) return unauthorized(res, 'El usuario no tiene sedes activas asignadas');
    const sede = sedes.find(s => Number(s.sede_id) === Number(sede_id || payload.sede_id)) || sedes[0];
    const accessPayload = buildPayload(user, role, sede);
    return ok(res, { token: signAccess(accessPayload), ...accessPayload, sedes });
  } catch {
    return unauthorized(res, 'refreshToken inválido o expirado');
  }
}

module.exports = { loginUsersCtrl, loginCtrl, selectSedeCtrl, refreshCtrl };
