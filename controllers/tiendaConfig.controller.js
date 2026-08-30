const fs = require('fs');
const path = require('path');
const { pool } = require('../db/pool');
const { ok, badRequest } = require('../utils/http');
const { writeScope } = require('../utils/scope');
const config = require('../config');

const DEFAULTS = Object.freeze({
  color_primario: '#050505',
  color_secundario: '#FFFFFF',
  color_acento: '#10B981',
  color_fondo: '#F8FAFC',
  color_texto: '#0F172A',
  fuente: 'INTER',
});

const FONTES = new Set(['INTER', 'MANROPE', 'POPPINS', 'MONTSERRAT', 'ROBOTO', 'NUNITO', 'SYSTEM']);
const FONT_CSS = Object.freeze({
  INTER: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  MANROPE: 'Manrope, Inter, ui-sans-serif, system-ui, sans-serif',
  POPPINS: 'Poppins, Inter, ui-sans-serif, system-ui, sans-serif',
  MONTSERRAT: 'Montserrat, Inter, ui-sans-serif, system-ui, sans-serif',
  ROBOTO: 'Roboto, Arial, sans-serif',
  NUNITO: 'Nunito, Inter, ui-sans-serif, system-ui, sans-serif',
  SYSTEM: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
});

function normalizeHex(value, field) {
  const color = String(value || '').trim().toUpperCase();
  if (!/^#[0-9A-F]{6}$/.test(color)) {
    throw Object.assign(new Error(`${field} debe ser un color hexadecimal válido, por ejemplo #10B981`), {
      httpStatus: 400,
      code: 'COLOR_INVALIDO',
    });
  }
  return color;
}

function normalizeFont(value) {
  const font = String(value || DEFAULTS.fuente).trim().toUpperCase();
  if (!FONTES.has(font)) {
    throw Object.assign(new Error('Tipografía no permitida'), { httpStatus: 400, code: 'FUENTE_INVALIDA' });
  }
  return font;
}

function publicShape(row, sede) {
  const fuente = normalizeFont(row?.fuente || DEFAULTS.fuente);
  return {
    sede_id: Number(sede.id),
    nombre_tienda: sede.nombre,
    logo_url: row?.logo_url || sede.logo_url || null,
    logo_personalizado: Boolean(row?.logo_url),
    color_primario: row?.color_primario || DEFAULTS.color_primario,
    color_secundario: row?.color_secundario || DEFAULTS.color_secundario,
    color_acento: row?.color_acento || DEFAULTS.color_acento,
    color_fondo: row?.color_fondo || DEFAULTS.color_fondo,
    color_texto: row?.color_texto || DEFAULTS.color_texto,
    fuente,
    font_family_css: FONT_CSS[fuente],
    fecha_actualizacion: row?.fecha_actualizacion || null,
  };
}

async function findConfig(sedeId) {
  const [[row]] = await pool.query(
    `SELECT tc.*
       FROM tienda_configuracion tc
      WHERE tc.sede_id=?
      LIMIT 1`,
    [sedeId]
  );
  return row || null;
}

async function getConfig(req, res) {
  const scope = await writeScope(req);
  const row = await findConfig(scope.sede_id);
  ok(res, publicShape(row, scope.sede));
}

async function updateConfig(req, res) {
  const scope = await writeScope(req);
  const body = req.body || {};
  const current = await findConfig(scope.sede_id);
  const data = {
    color_primario: normalizeHex(body.color_primario ?? current?.color_primario ?? DEFAULTS.color_primario, 'Color primario'),
    color_secundario: normalizeHex(body.color_secundario ?? current?.color_secundario ?? DEFAULTS.color_secundario, 'Color secundario'),
    color_acento: normalizeHex(body.color_acento ?? current?.color_acento ?? DEFAULTS.color_acento, 'Color de acento'),
    color_fondo: normalizeHex(body.color_fondo ?? current?.color_fondo ?? DEFAULTS.color_fondo, 'Color de fondo'),
    color_texto: normalizeHex(body.color_texto ?? current?.color_texto ?? DEFAULTS.color_texto, 'Color de texto'),
    fuente: normalizeFont(body.fuente ?? current?.fuente ?? DEFAULTS.fuente),
  };

  await pool.query(
    `INSERT INTO tienda_configuracion(
       empresa_id,sede_id,color_primario,color_secundario,color_acento,color_fondo,color_texto,fuente,fecha_actualizacion
     ) VALUES(?,?,?,?,?,?,?,?,UTC_TIMESTAMP())
     ON DUPLICATE KEY UPDATE
       empresa_id=VALUES(empresa_id),
       color_primario=VALUES(color_primario),
       color_secundario=VALUES(color_secundario),
       color_acento=VALUES(color_acento),
       color_fondo=VALUES(color_fondo),
       color_texto=VALUES(color_texto),
       fuente=VALUES(fuente),
       fecha_actualizacion=UTC_TIMESTAMP()`,
    [
      scope.empresa_id,
      scope.sede_id,
      data.color_primario,
      data.color_secundario,
      data.color_acento,
      data.color_fondo,
      data.color_texto,
      data.fuente,
    ]
  );

  const row = await findConfig(scope.sede_id);
  ok(res, { ...publicShape(row, scope.sede), message: 'Configuración web actualizada' });
}

async function uploadLogo(req, res) {
  const scope = await writeScope(req);
  if (!req.file) return badRequest(res, 'Selecciona una imagen para el logo web');

  const current = await findConfig(scope.sede_id);
  const logoUrl = `/files/sedes/${scope.sede_id}/tienda/logo/${path.basename(req.file.filename)}`;

  await pool.query(
    `INSERT INTO tienda_configuracion(empresa_id,sede_id,logo_url,fecha_actualizacion)
     VALUES(?,?,?,UTC_TIMESTAMP())
     ON DUPLICATE KEY UPDATE empresa_id=VALUES(empresa_id),logo_url=VALUES(logo_url),fecha_actualizacion=UTC_TIMESTAMP()`,
    [scope.empresa_id, scope.sede_id, logoUrl]
  );

  const oldPrefix = `/files/sedes/${scope.sede_id}/tienda/logo/`;
  if (String(current?.logo_url || '').startsWith(oldPrefix) && current.logo_url !== logoUrl) {
    const oldPath = path.resolve(config.uploads.dir, 'sedes', String(scope.sede_id), 'tienda', 'logo', path.basename(current.logo_url));
    try { fs.unlinkSync(oldPath); } catch {}
  }

  const row = await findConfig(scope.sede_id);
  ok(res, { ...publicShape(row, scope.sede), message: 'Logo de la tienda actualizado' });
}

async function resetLogo(req, res) {
  const scope = await writeScope(req);
  const current = await findConfig(scope.sede_id);
  if (current?.logo_url) {
    const prefix = `/files/sedes/${scope.sede_id}/tienda/logo/`;
    if (String(current.logo_url).startsWith(prefix)) {
      const oldPath = path.resolve(config.uploads.dir, 'sedes', String(scope.sede_id), 'tienda', 'logo', path.basename(current.logo_url));
      try { fs.unlinkSync(oldPath); } catch {}
    }
    await pool.query(`UPDATE tienda_configuracion SET logo_url=NULL,fecha_actualizacion=UTC_TIMESTAMP() WHERE sede_id=?`, [scope.sede_id]);
  }
  const row = await findConfig(scope.sede_id);
  ok(res, { ...publicShape(row, scope.sede), message: 'La tienda volverá a usar el logo de la sede' });
}

module.exports = { getConfig, updateConfig, uploadLogo, resetLogo, publicShape, DEFAULTS, FONT_CSS };
