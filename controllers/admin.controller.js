const path = require('path');
const { pool } = require('../db/pool');
const { ok, created, badRequest, notFound } = require('../utils/http');
const { clean, toInt } = require('../utils/scope');

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj || {}, key);
}

async function listarEmpresas(req, res) {
  const buscar = clean(req.query.buscar);
  const params = [];
  const where = [];
  if (buscar) {
    where.push('(nombre LIKE ? OR nit LIKE ?)');
    params.push(`%${buscar}%`, `%${buscar}%`);
  }
  const [items] = await pool.query(
    `SELECT * FROM empresa ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY nombre`,
    params
  );
  ok(res, { items, total: items.length });
}

async function crearEmpresa(req, res) {
  const { nombre, nit = null, telefono = null, direccion = null, activo = 1 } = req.body || {};
  if (!clean(nombre)) return badRequest(res, 'nombre requerido');
  const [r] = await pool.query(
    `INSERT INTO empresa(nombre,nit,telefono,direccion,activo,fecha_creacion)
     VALUES(?,?,?,?,?,UTC_TIMESTAMP())`,
    [clean(nombre), clean(nit), clean(telefono), clean(direccion), activo ? 1 : 0]
  );
  created(res, { id: r.insertId, message: 'Empresa creada' });
}

async function actualizarEmpresa(req, res) {
  const id = Number(req.params.id);
  const body = req.body || {};
  const sets = [];
  const params = [];

  if (hasOwn(body, 'nombre')) {
    const nombre = clean(body.nombre);
    if (!nombre) return badRequest(res, 'nombre requerido');
    sets.push('nombre=?'); params.push(nombre);
  }
  for (const field of ['nit', 'telefono', 'direccion']) {
    if (hasOwn(body, field)) {
      sets.push(`${field}=?`);
      params.push(clean(body[field]));
    }
  }
  if (hasOwn(body, 'activo')) {
    sets.push('activo=?'); params.push(body.activo ? 1 : 0);
  }

  if (!sets.length) return ok(res, { id, message: 'Sin cambios' });
  const [r] = await pool.query(`UPDATE empresa SET ${sets.join(', ')} WHERE id=?`, [...params, id]);
  if (!r.affectedRows) return notFound(res, 'Empresa no encontrada');
  ok(res, { id, message: 'Empresa actualizada' });
}

async function listarSedes(req, res) {
  const empresaId = toInt(req.query.empresa_id, null);
  const buscar = clean(req.query.buscar);
  const params = [];
  const where = [];
  if (empresaId) { where.push('s.empresa_id=?'); params.push(empresaId); }
  if (buscar) {
    where.push('(s.nombre LIKE ? OR s.codigo LIKE ? OR e.nombre LIKE ?)');
    params.push(`%${buscar}%`, `%${buscar}%`, `%${buscar}%`);
  }
  const [items] = await pool.query(
    `SELECT s.*, e.nombre AS empresa_nombre
       FROM sede s JOIN empresa e ON e.id=s.empresa_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY e.nombre, s.nombre`,
    params
  );
  ok(res, { items, total: items.length });
}

async function crearSede(req, res) {
  const {
    empresa_id,
    nombre,
    razon_social = null,
    nit = null,
    codigo = null,
    direccion = null,
    telefono = null,
    correo = null,
    logo_url = null,
    prefijo_factura = null,
    es_principal = 0,
    activo = 1,
  } = req.body || {};

  if (!empresa_id || !clean(nombre)) return badRequest(res, 'empresa_id y nombre requeridos');
  const [[empresa]] = await pool.query(`SELECT id FROM empresa WHERE id=? LIMIT 1`, [Number(empresa_id)]);
  if (!empresa) return badRequest(res, 'La empresa seleccionada no existe');

  const [r] = await pool.query(
    `INSERT INTO sede(
       empresa_id,nombre,razon_social,nit,codigo,direccion,telefono,correo,
       logo_url,prefijo_factura,es_principal,activo,fecha_creacion
     ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP())`,
    [
      Number(empresa_id), clean(nombre), clean(razon_social), clean(nit), clean(codigo),
      clean(direccion), clean(telefono), clean(correo), clean(logo_url), clean(prefijo_factura),
      es_principal ? 1 : 0, activo ? 1 : 0,
    ]
  );
  created(res, { id: r.insertId, message: 'Sede creada' });
}

async function actualizarSede(req, res) {
  const id = Number(req.params.id);
  const body = req.body || {};
  const sets = [];
  const params = [];

  if (hasOwn(body, 'empresa_id')) {
    const empresaId = toInt(body.empresa_id, null);
    if (!empresaId) return badRequest(res, 'empresa_id inválido');
    const [[empresa]] = await pool.query(`SELECT id FROM empresa WHERE id=? LIMIT 1`, [empresaId]);
    if (!empresa) return badRequest(res, 'La empresa seleccionada no existe');
    sets.push('empresa_id=?'); params.push(empresaId);
  }

  if (hasOwn(body, 'nombre')) {
    const nombre = clean(body.nombre);
    if (!nombre) return badRequest(res, 'nombre requerido');
    sets.push('nombre=?'); params.push(nombre);
  }

  for (const field of ['razon_social', 'nit', 'codigo', 'direccion', 'telefono', 'correo', 'logo_url', 'prefijo_factura']) {
    if (hasOwn(body, field)) {
      sets.push(`${field}=?`);
      params.push(clean(body[field]));
    }
  }

  for (const field of ['es_principal', 'activo']) {
    if (hasOwn(body, field)) {
      sets.push(`${field}=?`);
      params.push(body[field] ? 1 : 0);
    }
  }

  if (!sets.length) return ok(res, { id, message: 'Sin cambios' });
  const [r] = await pool.query(`UPDATE sede SET ${sets.join(', ')} WHERE id=?`, [...params, id]);
  if (!r.affectedRows) return notFound(res, 'Sede no encontrada');
  ok(res, { id, message: 'Sede actualizada' });
}

async function subirLogoSede(req, res) {
  const id = Number(req.params.id);
  if (!id) return badRequest(res, 'Sede inválida');
  if (!req.file) return badRequest(res, 'Selecciona una imagen para el logo');

  const [[sede]] = await pool.query(`SELECT id FROM sede WHERE id=? LIMIT 1`, [id]);
  if (!sede) return notFound(res, 'Sede no encontrada');

  const logoUrl = `/files/sedes/${id}/logo/${path.basename(req.file.filename)}`;
  await pool.query(`UPDATE sede SET logo_url=? WHERE id=?`, [logoUrl, id]);
  ok(res, { id, logo_url: logoUrl, message: 'Logo actualizado' });
}

module.exports = {
  listarEmpresas,
  crearEmpresa,
  actualizarEmpresa,
  listarSedes,
  crearSede,
  actualizarSede,
  subirLogoSede,
};
