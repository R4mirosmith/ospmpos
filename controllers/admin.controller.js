const { pool } = require('../db/pool');
const { ok, created, badRequest } = require('../utils/http');
const { clean, toInt } = require('../utils/scope');

async function listarEmpresas(req, res) {
  const buscar = clean(req.query.buscar);
  const params = [];
  const where = [];
  if (buscar) { where.push('(nombre LIKE ? OR nit LIKE ?)'); params.push(`%${buscar}%`, `%${buscar}%`); }
  const [items] = await pool.query(
    `SELECT * FROM empresa ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY nombre`,
    params
  );
  ok(res, { items, total: items.length });
}
async function crearEmpresa(req, res) {
  const { nombre, nit = null, telefono = null, direccion = null, activo = 1 } = req.body || {};
  if (!nombre) return badRequest(res, 'nombre requerido');
  const [r] = await pool.query(
    `INSERT INTO empresa(nombre,nit,telefono,direccion,activo,fecha_creacion) VALUES(?,?,?,?,?,UTC_TIMESTAMP())`,
    [nombre, nit, telefono, direccion, activo ? 1 : 0]
  );
  created(res, { id: r.insertId, message: 'Empresa creada' });
}
async function actualizarEmpresa(req, res) {
  const id = Number(req.params.id);
  const { nombre, nit, telefono, direccion, activo } = req.body || {};
  await pool.query(
    `UPDATE empresa SET nombre=COALESCE(?,nombre), nit=?, telefono=?, direccion=?, activo=COALESCE(?,activo) WHERE id=?`,
    [clean(nombre), clean(nit), clean(telefono), clean(direccion), activo === undefined ? null : (activo ? 1 : 0), id]
  );
  ok(res, { id, message: 'Empresa actualizada' });
}
async function listarSedes(req, res) {
  const empresaId = toInt(req.query.empresa_id, null);
  const buscar = clean(req.query.buscar);
  const params = [];
  const where = [];
  if (empresaId) { where.push('s.empresa_id=?'); params.push(empresaId); }
  if (buscar) { where.push('(s.nombre LIKE ? OR s.codigo LIKE ? OR e.nombre LIKE ?)'); params.push(`%${buscar}%`, `%${buscar}%`, `%${buscar}%`); }
  const [items] = await pool.query(
    `SELECT s.*, e.nombre AS empresa_nombre
       FROM sede s JOIN empresa e ON e.id=s.empresa_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY e.nombre, s.nombre`, params);
  ok(res, { items, total: items.length });
}
async function crearSede(req, res) {
  const { empresa_id, nombre, razon_social = null, nit = null, codigo = null, direccion = null, telefono = null, correo = null, logo_url = null, prefijo_factura = null, es_principal = 0, activo = 1 } = req.body || {};
  if (!empresa_id || !nombre) return badRequest(res, 'empresa_id y nombre requeridos');
  const [r] = await pool.query(
    `INSERT INTO sede(empresa_id,nombre,razon_social,nit,codigo,direccion,telefono,correo,logo_url,prefijo_factura,es_principal,activo,fecha_creacion) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP())`,
    [empresa_id, nombre, razon_social, nit, codigo, direccion, telefono, correo, logo_url, prefijo_factura, es_principal ? 1 : 0, activo ? 1 : 0]
  );
  created(res, { id: r.insertId, message: 'Sede creada' });
}
async function actualizarSede(req, res) {
  const id = Number(req.params.id);
  const { empresa_id, nombre, razon_social, nit, codigo, direccion, telefono, correo, logo_url, prefijo_factura, es_principal, activo } = req.body || {};
  await pool.query(
    `UPDATE sede SET empresa_id=COALESCE(?,empresa_id), nombre=COALESCE(?,nombre), razon_social=?, nit=?, codigo=?, direccion=?, telefono=?, correo=?, logo_url=?, prefijo_factura=?, es_principal=COALESCE(?,es_principal), activo=COALESCE(?,activo) WHERE id=?`,
    [toInt(empresa_id, null), clean(nombre), clean(razon_social), clean(nit), clean(codigo), clean(direccion), clean(telefono), clean(correo), clean(logo_url), clean(prefijo_factura), es_principal === undefined ? null : (es_principal ? 1 : 0), activo === undefined ? null : (activo ? 1 : 0), id]
  );
  ok(res, { id, message: 'Sede actualizada' });
}

module.exports = { listarEmpresas, crearEmpresa, actualizarEmpresa, listarSedes, crearSede, actualizarSede };
