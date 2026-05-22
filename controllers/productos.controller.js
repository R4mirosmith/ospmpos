const path = require('path');
const { pool, pageLimit } = require('../utils/sql');
const { ok, created, badRequest } = require('../utils/http');
const { writeScope, addScopeWhere, clean, toInt } = require('../utils/scope');
const config = require('../config');

function stockExpr(alias = 'p') {
  return `(SELECT COALESCE(SUM(m.cantidad),0) FROM inv_movimiento m WHERE m.producto_id=${alias}.id AND m.sede_id=${alias}.sede_id AND m.activo=1)`;
}
async function listar(req, res) {
  const { limit, offset } = pageLimit(req.query.page, req.query.pageSize);
  const scope = addScopeWhere(req, 'p');
  const where = [...scope.where]; const params = [...scope.params];
  const buscar = clean(req.query.buscar);
  if (buscar) { where.push('(p.nombre LIKE ? OR p.codigo LIKE ? OR p.codigo_barras LIKE ?)'); params.push(`%${buscar}%`,`%${buscar}%`,`%${buscar}%`); }
  if (toInt(req.query.categoria_id, null)) { where.push('p.categoria_id=?'); params.push(Number(req.query.categoria_id)); }
  if (clean(req.query.activo) !== null) { where.push('p.activo=?'); params.push(Number(req.query.activo)); }
  const stock = stockExpr('p');
  if (Number(req.query.solo_bajo_minimo || 0) === 1) where.push(`${stock} <= p.stock_minimo`);
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [[cnt]] = await pool.query(`SELECT COUNT(*) total FROM producto p ${w}`, params);
  const [items] = await pool.query(
    `SELECT p.*, p.costo AS costo_promedio, c.nombre AS categoria_nombre, s.nombre AS sede_nombre, s.nit AS sede_nit, s.razon_social AS sede_razon_social, ${stock} AS stock_actual,
            CASE WHEN ${stock} <= p.stock_minimo THEN 1 ELSE 0 END AS bajo_minimo,
            (SELECT pi.url FROM producto_imagen pi WHERE pi.producto_id=p.id ORDER BY pi.es_principal DESC, pi.orden ASC, pi.id ASC LIMIT 1) AS imagen_principal
       FROM producto p
       LEFT JOIN categoria c ON c.id=p.categoria_id
       LEFT JOIN sede s ON s.id=p.sede_id
       ${w}
       ORDER BY p.id DESC LIMIT ? OFFSET ?`, [...params, limit, offset]);
  ok(res, { items, total: Number(cnt.total || 0) });
}
async function get(req, res) {
  const scope = addScopeWhere(req, 'p');
  const [rows] = await pool.query(
    `SELECT p.*, p.costo AS costo_promedio, s.nombre AS sede_nombre, s.nit AS sede_nit, s.razon_social AS sede_razon_social,
            ${stockExpr('p')} AS stock_actual,
            (SELECT pi.url
               FROM producto_imagen pi
              WHERE pi.producto_id = p.id
              ORDER BY pi.es_principal DESC, pi.orden ASC, pi.id ASC
              LIMIT 1) AS imagen_principal
       FROM producto p
       LEFT JOIN sede s ON s.id = p.sede_id
      WHERE p.id=? ${scope.where.length ? 'AND ' + scope.where.join(' AND ') : ''}`,
    [Number(req.params.id), ...scope.params]
  );
  ok(res, rows[0] || null);
}
async function crear(req, res) {
  const { categoria_id, codigo, nombre, descripcion = '', garantia_info = null, costo = null, costo_promedio = null, precio = 0, precio_m = null, stock_minimo = 0, costoInicial = null, codigo_barras = null } = req.body || {};
  if (!categoria_id || !codigo || !nombre) return badRequest(res, 'categoria_id, codigo y nombre requeridos');
  const s = await writeScope(req);
  const cost = Number(costo ?? costo_promedio ?? costoInicial ?? 0);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [r] = await conn.query(
      `INSERT INTO producto(empresa_id,sede_id,categoria_id,codigo,nombre,descripcion,garantia_info,costo,precio,precio_m,stock_minimo,activo,codigo_barras,fecha)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP())`,
      [s.empresa_id, s.sede_id, categoria_id, codigo, nombre, descripcion, garantia_info, cost, Number(precio || 0), precio_m || null, Number(stock_minimo || 0), 1, codigo_barras || codigo]
    );
    const initial = Number(req.body?.stock_inicial ?? req.body?.stock_actual ?? req.body?.costo_inicial ?? 0);
    if (initial > 0) {
      await conn.query(`INSERT INTO inv_movimiento(empresa_id,sede_id,producto_id,usuario_id,tipo,cantidad,costo_unitario,comentario,fecha,activo) VALUES(?,?,?,?,?,?,?,?,UTC_TIMESTAMP(),1)`, [s.empresa_id, s.sede_id, r.insertId, req.user.id, 'IN_AJUSTE', initial, cost, 'Stock inicial']);
    }
    await conn.commit();
    created(res, { id: r.insertId, message: 'Producto creado' });
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
}
async function actualizar(req, res) {
  const id = Number(req.params.id);

  // El frontend trabaja con el nombre costo_promedio por claridad visual,
  // pero en la base el campo real del producto es costo.
  // Así evitamos que al editar se ignore el costo y vuelva a aparecer el valor anterior.
  if (req.body?.costo_promedio !== undefined && req.body?.costo === undefined) {
    req.body.costo = req.body.costo_promedio;
  }

  const fields = ['categoria_id','codigo','nombre','descripcion','garantia_info','costo','precio','precio_m','stock_minimo','codigo_barras','activo'];
  const upd = fields.filter(f => req.body?.[f] !== undefined);
  if (!upd.length) return ok(res, { id });
  const scope = addScopeWhere(req, 'producto');
  await pool.query(`UPDATE producto SET ${upd.map(f=>`${f}=?`).join(', ')}, fecha=UTC_TIMESTAMP() WHERE id=? ${scope.where.length ? 'AND ' + scope.where.join(' AND ') : ''}`, [...upd.map(f=> f==='activo' ? (req.body[f]?1:0) : req.body[f]), id, ...scope.params]);
  ok(res, { id, message: 'Producto actualizado' });
}
async function estado(req, res) { req.body.activo = req.body?.activo ? 1 : 0; return actualizar(req, res); }
async function imgAgregar(req, res) {
  const productoId = Number(req.params.id);
  const { url, alt = null, es_principal = 0, orden = 0 } = req.body || {};
  if (!url) return badRequest(res, 'url requerida');
  if (es_principal) await pool.query(`UPDATE producto_imagen SET es_principal=0 WHERE producto_id=?`, [productoId]);
  const [r] = await pool.query(`INSERT INTO producto_imagen(producto_id,url,alt,es_principal,orden,fecha) VALUES(?,?,?,?,?,UTC_TIMESTAMP())`, [productoId, url, alt, es_principal ? 1 : 0, orden]);
  created(res, { id: r.insertId, url });
}
async function imgListar(req, res) { const [items] = await pool.query(`SELECT * FROM producto_imagen WHERE producto_id=? ORDER BY es_principal DESC, orden ASC, id ASC`, [Number(req.params.id)]); ok(res, { items, total: items.length }); }
async function imgSetPrincipal(req, res) { const { id, imgId } = req.params; await pool.query(`UPDATE producto_imagen SET es_principal=0 WHERE producto_id=?`,[id]); await pool.query(`UPDATE producto_imagen SET es_principal=1 WHERE id=? AND producto_id=?`,[imgId,id]); ok(res,{id:Number(imgId)}); }
async function imgReordenar(req, res) { await pool.query(`UPDATE producto_imagen SET orden=? WHERE id=?`,[Number(req.body?.nuevo_orden ?? req.body?.orden ?? 0),Number(req.params.imgId)]); ok(res,{id:Number(req.params.imgId)}); }
async function imgEliminar(req, res) { await pool.query(`DELETE FROM producto_imagen WHERE id=?`,[Number(req.params.imgId)]); ok(res,{id:Number(req.params.imgId)}); }
async function imgUpload(req, res) {
  const id = Number(req.params.id);
  const files = req.files || [];
  if (!files.length) return badRequest(res, 'No se subieron archivos');
  const uploaded = [];
  for (let i=0; i<files.length; i++) {
    const f = files[i];
    const publicPath = `/productos/${id}/imagenes/public/${path.basename(f.filename)}`;
    await pool.query(`INSERT INTO producto_imagen(producto_id,url,alt,es_principal,orden,fecha) VALUES(?,?,?,?,?,UTC_TIMESTAMP())`, [id, publicPath, f.originalname, i===0?1:0, i]);
    uploaded.push({ url: publicPath });
  }
  created(res, { uploaded });
}
async function webCatalogo(req, res) { return publicCatalogo(req, res); }
async function webProducto(req, res) { return publicProducto(req, res); }
async function publicCatalogo(req, res) {
  const sedeId = Number(req.query.sede_id || config.public.defaultSedeId || 1);
  const [items] = await pool.query(
    `SELECT p.id, p.codigo, p.nombre, p.descripcion, p.precio, p.precio_m, ${stockExpr('p')} stock,
            (SELECT pi.url FROM producto_imagen pi WHERE pi.producto_id=p.id ORDER BY pi.es_principal DESC, pi.orden ASC, pi.id ASC LIMIT 1) imagen
       FROM producto p WHERE p.sede_id=? AND p.activo=1 ORDER BY p.nombre`, [sedeId]);
  ok(res, { total: items.length, items });
}
async function publicProducto(req, res) {
  const [rows] = await pool.query(`SELECT p.*, ${stockExpr('p')} stock FROM producto p WHERE p.id=? AND p.activo=1`, [Number(req.params.id)]);
  ok(res, rows[0] || null);
}
module.exports = { listar, get, crear, actualizar, estado, cambiarEstado: estado, imgAgregar, imgListar, imgSetPrincipal, imgReordenar, imgEliminar, imgUpload, webCatalogo, webProducto, publicCatalogo, publicProducto };
