const { pool } = require('../db/pool');

function isAdmin(user) {
  return String(user?.role || '').toUpperCase() === 'ADMIN';
}

function clean(value) {
  return value === undefined || value === null || value === '' || value === 'null' || value === 'undefined' ? null : value;
}

function toInt(value, fallback = null) {
  const v = clean(value);
  if (v === null || v === 'all') return fallback;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function headerSedeId(req) {
  return toInt(req.headers?.['x-sede-id'], null);
}

function headerEmpresaId(req) {
  return toInt(req.headers?.['x-empresa-id'], null);
}

async function getSede(id) {
  const [rows] = await pool.query(
    `SELECT s.*, e.nombre AS empresa_nombre, e.activo AS empresa_activa
       FROM sede s
       JOIN empresa e ON e.id = s.empresa_id
      WHERE s.id = ? AND s.activo = 1 AND e.activo = 1
      LIMIT 1`,
    [id]
  );
  return rows[0] || null;
}

function selectedSedeId(req) {
  if (isAdmin(req.user)) {
    const q = clean(req.query?.sede_id ?? req.body?.sede_id ?? req.headers?.['x-sede-id']);
    if (q === 'all') return 'all';
    const n = toInt(q, null);
    if (n) return n;
  }
  return toInt(req.user?.sede_id, null);
}

function selectedEmpresaId(req) {
  if (isAdmin(req.user)) {
    const q = clean(req.query?.empresa_id ?? req.body?.empresa_id ?? req.headers?.['x-empresa-id']);
    if (q === 'all') return 'all';
    const n = toInt(q, null);
    if (n) return n;
  }
  return toInt(req.user?.empresa_id, null);
}

async function writeScope(req) {
  let sedeId = null;

  if (isAdmin(req.user)) {
    // Para el admin, el negocio seleccionado al iniciar sesión también viaja en el token.
    // El header/body solo refuerza ese valor para formularios como Categorías, Servicios, Productos, etc.
    sedeId =
      toInt(req.body?.sede_id, null) ||
      headerSedeId(req) ||
      toInt(req.user?.sede_id, null);
  } else {
    sedeId = toInt(req.user?.sede_id, null);
  }

  if (!sedeId) {
    throw Object.assign(new Error('Debes seleccionar un negocio/sede al iniciar sesión para poder registrar información.'), {
      httpStatus: 400,
      code: 'SEDE_REQUIRED',
    });
  }

  const sede = await getSede(sedeId);
  if (!sede) {
    throw Object.assign(new Error('La sede seleccionada no existe, está inactiva o su grupo está inactivo. Cierra sesión y vuelve a entrar seleccionando una sede activa.'), {
      httpStatus: 400,
      code: 'INVALID_SEDE',
      sede_id: sedeId,
    });
  }

  return { sede_id: sede.id, empresa_id: sede.empresa_id, sede };
}

function addScopeWhere(req, alias = '') {
  const prefix = alias ? `${alias}.` : '';
  const where = [];
  const params = [];
  const sedeId = selectedSedeId(req);
  const empresaId = selectedEmpresaId(req);

  if (sedeId && sedeId !== 'all') {
    where.push(`${prefix}sede_id = ?`);
    params.push(sedeId);
  } else if (empresaId && empresaId !== 'all') {
    where.push(`${prefix}empresa_id = ?`);
    params.push(empresaId);
  } else if (!isAdmin(req.user)) {
    where.push(`${prefix}sede_id = ?`);
    params.push(req.user.sede_id);
  }

  return { where, params };
}

function colombiaDateRange(desde, hasta, columnSql = 'fecha') {
  const where = [];
  const params = [];
  const d = clean(desde);
  const h = clean(hasta);
  if (d) {
    where.push(`${columnSql} >= ?`);
    params.push(`${String(d).slice(0, 10)} 05:00:00`);
  }
  if (h) {
    const date = new Date(`${String(h).slice(0, 10)}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + 1);
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    where.push(`${columnSql} < ?`);
    params.push(`${y}-${m}-${day} 05:00:00`);
  }
  return { where, params };
}

module.exports = {
  isAdmin,
  clean,
  toInt,
  getSede,
  selectedSedeId,
  selectedEmpresaId,
  writeScope,
  addScopeWhere,
  colombiaDateRange,
  headerSedeId,
  headerEmpresaId,
};
