const path = require('path');
const fs = require('fs');
const { pool, pageLimit } = require('../utils/sql');
const { ok, created, badRequest, notFound } = require('../utils/http');
const { writeScope, addScopeWhere, clean, toInt } = require('../utils/scope');
const config = require('../config');
const { MAX_VIDEO_SECONDS, videoDurationSeconds } = require('../utils/video');

const ROL_GESTOR_WEB = 'GESTOR_WEB';

function esGestorWeb(req) {
  return String(req.user?.role || '').toUpperCase() === ROL_GESTOR_WEB;
}

function ocultarValoresAdministrativos(producto) {
  if (!producto) return producto;
  const safe = { ...producto };
  delete safe.costo;
  delete safe.costo_promedio;
  delete safe.precio;
  delete safe.precio_m;
  return safe;
}

function stockExpr(alias = 'p') {
  return `(SELECT COALESCE(SUM(m.cantidad),0) FROM inv_movimiento m WHERE m.producto_id=${alias}.id AND m.sede_id=${alias}.sede_id AND m.activo=1)`;
}

async function productoEnScope(req, productoId) {
  const scope = addScopeWhere(req, 'p');
  const [rows] = await pool.query(
    `SELECT p.id, p.sede_id, p.empresa_id FROM producto p WHERE p.id=? ${scope.where.length ? 'AND ' + scope.where.join(' AND ') : ''} LIMIT 1`,
    [Number(productoId), ...scope.params]
  );
  return rows[0] || null;
}

async function imagenEnScope(req, imagenId) {
  const scope = addScopeWhere(req, 'p');
  const [rows] = await pool.query(
    `SELECT pi.id, pi.producto_id, pi.url, pi.es_principal
       FROM producto_imagen pi
       JOIN producto p ON p.id = pi.producto_id
      WHERE pi.id=? ${scope.where.length ? 'AND ' + scope.where.join(' AND ') : ''}
      LIMIT 1`,
    [Number(imagenId), ...scope.params]
  );
  return rows[0] || null;
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
  ok(res, { items: esGestorWeb(req) ? items.map(ocultarValoresAdministrativos) : items, total: Number(cnt.total || 0) });
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
  const producto = rows[0] || null;
  ok(res, esGestorWeb(req) ? ocultarValoresAdministrativos(producto) : producto);
}
async function crear(req, res) {
  const { categoria_id, codigo, nombre, descripcion = '', garantia_info = null, costo = null, costo_promedio = null, precio = 0, precio_m = null, stock_minimo = 0, costoInicial = null, codigo_barras = null } = req.body || {};
  if (!categoria_id || !codigo || !nombre) return badRequest(res, 'categoria_id, codigo y nombre requeridos');
  const gestorWeb = esGestorWeb(req);
  // Para GESTOR_WEB la creación debe pasar por el endpoint multipart, que garantiza
  // al menos una imagen. Así no puede saltarse esa regla llamando el endpoint JSON.
  if (gestorWeb) return badRequest(res, 'Debes crear el producto incluyendo al menos una imagen');
  const s = await writeScope(req);
  // El gestor web puede crear el contenido del catálogo, pero nunca decide valores.
  // El backend fuerza todos los importes administrativos a cero aunque el cliente intente enviarlos.
  const cost = gestorWeb ? 0 : Number(costo ?? costo_promedio ?? costoInicial ?? 0);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const precioValor = gestorWeb ? 0 : Number(precio || 0);
    const precioMValor = gestorWeb ? 0 : (precio_m === null || precio_m === undefined || precio_m === '' ? null : Number(precio_m));
    const stockMinimoValor = Number(stock_minimo || 0);
    const valoresValidos = [cost, precioValor, stockMinimoValor, ...(precioMValor === null ? [] : [precioMValor])].every(Number.isFinite);
    if (!valoresValidos || cost < 0 || precioValor < 0 || stockMinimoValor < 0 || (precioMValor !== null && precioMValor < 0)) {
      throw Object.assign(new Error('Costo, precios y stock mínimo deben ser valores válidos no negativos'), { httpStatus: 400, code: 'VALORES_PRODUCTO_INVALIDOS' });
    }
    const [[categoria]] = await conn.query(
      `SELECT id FROM categoria WHERE id=? AND sede_id=? AND activo=1 LIMIT 1`,
      [categoria_id, s.sede_id]
    );
    if (!categoria) {
      throw Object.assign(new Error('La categoría no pertenece a la sede activa o está inactiva'), { httpStatus: 400, code: 'CATEGORIA_INVALIDA' });
    }

    const [r] = await conn.query(
      `INSERT INTO producto(empresa_id,sede_id,categoria_id,codigo,nombre,descripcion,garantia_info,costo,precio,precio_m,stock_minimo,activo,codigo_barras,fecha)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP())`,
      [s.empresa_id, s.sede_id, categoria_id, codigo, nombre, descripcion, garantia_info, cost, precioValor, precioMValor, stockMinimoValor, 1, codigo_barras || codigo]
    );
    // GESTOR_WEB administra el catálogo, no el inventario. Al crear siempre inicia en 0.
    const initial = gestorWeb ? 0 : Number(req.body?.stock_inicial ?? req.body?.stock_actual ?? 0);
    if (!Number.isFinite(initial) || initial < 0) {
      throw Object.assign(new Error('El stock inicial debe ser un valor válido no negativo'), { httpStatus: 400, code: 'STOCK_INICIAL_INVALIDO' });
    }
    if (initial > 0) {
      await conn.query(`INSERT INTO inv_movimiento(empresa_id,sede_id,producto_id,usuario_id,tipo,cantidad,costo_unitario,comentario,fecha,activo) VALUES(?,?,?,?,?,?,?,?,UTC_TIMESTAMP(),1)`, [s.empresa_id, s.sede_id, r.insertId, req.user.id, 'IN_AJUSTE', initial, cost, 'Stock inicial']);
    }
    await conn.commit();
    created(res, { id: r.insertId, message: 'Producto creado' });
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
}
async function crearConImagenes(req, res) {
  const files = Array.isArray(req.files) ? req.files : [];
  if (files.length < 1) return badRequest(res, 'Debes cargar al menos una imagen para crear el producto');
  if (files.length > 3) return badRequest(res, 'Máximo 3 imágenes por producto');

  const {
    categoria_id, codigo, nombre, descripcion = '', garantia_info = null,
    costo = null, costo_promedio = null, precio = 0, precio_m = null,
    stock_minimo = 0, costoInicial = null, codigo_barras = null,
  } = req.body || {};
  if (!categoria_id || !codigo || !nombre) return badRequest(res, 'categoria_id, codigo y nombre requeridos');

  const scope = await writeScope(req);
  const gestorWeb = esGestorWeb(req);
  const cost = gestorWeb ? 0 : Number(costo ?? costo_promedio ?? costoInicial ?? 0);
  const precioValor = gestorWeb ? 0 : Number(precio || 0);
  const precioMValor = gestorWeb ? 0 : (precio_m === null || precio_m === undefined || precio_m === '' ? null : Number(precio_m));
  const stockMinimoValor = Number(stock_minimo || 0);
  const stockInicialValor = gestorWeb ? 0 : Number(req.body?.stock_inicial ?? req.body?.stock_actual ?? 0);

  const valoresValidos = [cost, precioValor, stockMinimoValor, stockInicialValor, ...(precioMValor === null ? [] : [precioMValor])].every(Number.isFinite);
  if (!valoresValidos || cost < 0 || precioValor < 0 || stockMinimoValor < 0 || stockInicialValor < 0 || (precioMValor !== null && precioMValor < 0)) {
    return badRequest(res, 'Costo, precios y stock deben ser valores válidos no negativos');
  }

  const conn = await pool.getConnection();
  const writtenFiles = [];
  let productFolder = null;
  try {
    await conn.beginTransaction();

    const [[categoria]] = await conn.query(
      `SELECT id FROM categoria WHERE id=? AND sede_id=? AND activo=1 LIMIT 1`,
      [Number(categoria_id), scope.sede_id]
    );
    if (!categoria) {
      throw Object.assign(new Error('La categoría no pertenece a la sede activa o está inactiva'), { httpStatus: 400, code: 'CATEGORIA_INVALIDA' });
    }

    const [r] = await conn.query(
      `INSERT INTO producto(empresa_id,sede_id,categoria_id,codigo,nombre,descripcion,garantia_info,costo,precio,precio_m,stock_minimo,activo,codigo_barras,fecha)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP())`,
      [scope.empresa_id, scope.sede_id, Number(categoria_id), codigo, nombre, descripcion, garantia_info || null, cost, precioValor, precioMValor, stockMinimoValor, 1, codigo_barras || codigo]
    );
    const productoId = Number(r.insertId);

    if (stockInicialValor > 0) {
      await conn.query(
        `INSERT INTO inv_movimiento(empresa_id,sede_id,producto_id,usuario_id,tipo,cantidad,costo_unitario,comentario,fecha,activo)
         VALUES(?,?,?,?,?,?,?,?,UTC_TIMESTAMP(),1)`,
        [scope.empresa_id, scope.sede_id, productoId, req.user.id, 'IN_AJUSTE', stockInicialValor, cost, 'Stock inicial']
      );
    }

    productFolder = path.resolve(config.uploads.dir, 'products', String(productoId));
    fs.mkdirSync(productFolder, { recursive: true });
    const uploaded = [];

    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const safeOriginal = path.basename(String(f.originalname || `imagen-${i + 1}`)).replace(/[^a-zA-Z0-9._-]/g, '_');
      const filename = `${Date.now()}-${i}-${safeOriginal}`;
      const filePath = path.join(productFolder, filename);
      fs.writeFileSync(filePath, f.buffer);
      writtenFiles.push(filePath);

      const publicPath = `/productos/${productoId}/imagenes/public/${filename}`;
      const [imgResult] = await conn.query(
        `INSERT INTO producto_imagen(producto_id,url,alt,es_principal,orden,fecha) VALUES(?,?,?,?,?,UTC_TIMESTAMP())`,
        [productoId, publicPath, f.originalname || nombre, i === 0 ? 1 : 0, i]
      );
      uploaded.push({ id: imgResult.insertId, url: publicPath, es_principal: i === 0 ? 1 : 0, orden: i });
    }

    await conn.commit();
    created(res, { id: productoId, message: 'Producto creado', uploaded, items: uploaded });
  } catch (e) {
    await conn.rollback();
    for (const filePath of writtenFiles) borrarArchivoSilencioso(filePath);
    if (productFolder) {
      try { fs.rmdirSync(productFolder); } catch { /* puede no estar vacío o ya no existir */ }
    }
    throw e;
  } finally {
    conn.release();
  }
}

async function actualizar(req, res) {
  const id = Number(req.params.id);
  const body = { ...(req.body || {}) };
  const gestorWeb = esGestorWeb(req);

  if (gestorWeb) {
    // Defensa en profundidad: estos campos jamás participan del UPDATE para GESTOR_WEB.
    // Así un producto con valores existentes conserva exactamente esos valores.
    delete body.costo;
    delete body.costo_promedio;
    delete body.precio;
    delete body.precio_m;
  } else if (body.costo_promedio !== undefined && body.costo === undefined) {
    body.costo = body.costo_promedio;
  }

  const producto = await productoEnScope(req, id);
  if (!producto) return notFound(res, 'Producto no encontrado en la sede activa');

  if (body.categoria_id !== undefined) {
    const categoriaId = Number(body.categoria_id);
    const [[categoria]] = await pool.query(
      `SELECT id FROM categoria WHERE id=? AND sede_id=? AND activo=1 LIMIT 1`,
      [categoriaId, producto.sede_id]
    );
    if (!categoria) return badRequest(res, 'La categoría no pertenece a la sede del producto o está inactiva');
  }

  for (const field of ['costo', 'precio', 'precio_m', 'stock_minimo']) {
    if (body[field] === undefined || body[field] === null || body[field] === '') continue;
    const value = Number(body[field]);
    if (!Number.isFinite(value) || value < 0) return badRequest(res, `${field} debe ser un valor no negativo`);
  }

  const fields = ['categoria_id','codigo','nombre','descripcion','garantia_info','costo','precio','precio_m','stock_minimo','codigo_barras','activo'];
  const upd = fields.filter(f => body[f] !== undefined);
  if (!upd.length) return ok(res, { id });

  await pool.query(
    `UPDATE producto SET ${upd.map(f=>`${f}=?`).join(', ')}, fecha=UTC_TIMESTAMP() WHERE id=? AND sede_id=?`,
    [...upd.map(f=> f==='activo' ? (body[f]?1:0) : body[f]), id, producto.sede_id]
  );
  ok(res, { id, message: 'Producto actualizado' });
}

async function estado(req, res) { req.body.activo = req.body?.activo ? 1 : 0; return actualizar(req, res); }
async function imgAgregar(req, res) {
  const productoId = Number(req.params.id);
  const producto = await productoEnScope(req, productoId);
  if (!producto) return notFound(res, 'Producto no encontrado en la sede activa');

  const { url, alt = null, es_principal = 0, orden = 0 } = req.body || {};
  if (!url) return badRequest(res, 'url requerida');

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    if (es_principal) await conn.query(`UPDATE producto_imagen SET es_principal=0 WHERE producto_id=?`, [productoId]);
    const [r] = await conn.query(
      `INSERT INTO producto_imagen(producto_id,url,alt,es_principal,orden,fecha) VALUES(?,?,?,?,?,UTC_TIMESTAMP())`,
      [productoId, url, alt, es_principal ? 1 : 0, Number(orden || 0)]
    );
    await conn.commit();
    created(res, { id: r.insertId, url });
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

async function imgListar(req, res) {
  const productoId = Number(req.params.id);
  const producto = await productoEnScope(req, productoId);
  if (!producto) return notFound(res, 'Producto no encontrado en la sede activa');
  const [items] = await pool.query(`SELECT * FROM producto_imagen WHERE producto_id=? ORDER BY es_principal DESC, orden ASC, id ASC`, [productoId]);
  ok(res, { items, total: items.length });
}

async function imgSetPrincipal(req, res) {
  const productoId = Number(req.params.id);
  const imgId = Number(req.params.imgId);
  const producto = await productoEnScope(req, productoId);
  if (!producto) return notFound(res, 'Producto no encontrado en la sede activa');
  const [[img]] = await pool.query(`SELECT id FROM producto_imagen WHERE id=? AND producto_id=? LIMIT 1`, [imgId, productoId]);
  if (!img) return notFound(res, 'Imagen no encontrada para este producto');

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(`UPDATE producto_imagen SET es_principal=0 WHERE producto_id=?`, [productoId]);
    await conn.query(`UPDATE producto_imagen SET es_principal=1 WHERE id=? AND producto_id=?`, [imgId, productoId]);
    await conn.commit();
    ok(res, { id: imgId });
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

async function imgReordenar(req, res) {
  const imgId = Number(req.params.imgId);
  const img = await imagenEnScope(req, imgId);
  if (!img) return notFound(res, 'Imagen no encontrada en la sede activa');
  await pool.query(`UPDATE producto_imagen SET orden=? WHERE id=?`, [Number(req.body?.nuevo_orden ?? req.body?.orden ?? 0), imgId]);
  ok(res, { id: imgId });
}

async function imgEliminar(req, res) {
  const imgId = Number(req.params.imgId);
  const img = await imagenEnScope(req, imgId);
  if (!img) return notFound(res, 'Imagen no encontrada en la sede activa');

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(`DELETE FROM producto_imagen WHERE id=?`, [imgId]);
    if (Number(img.es_principal) === 1) {
      const [[next]] = await conn.query(
        `SELECT id FROM producto_imagen WHERE producto_id=? ORDER BY orden ASC, id ASC LIMIT 1`,
        [img.producto_id]
      );
      if (next?.id) await conn.query(`UPDATE producto_imagen SET es_principal=1 WHERE id=?`, [next.id]);
    }
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }

  borrarArchivoSilencioso(localImageFileFromUrl(img.producto_id, img.url));
  ok(res, { id: imgId });
}

function limpiarArchivosSubidos(files = []) {
  for (const f of files) {
    if (!f?.path) continue;
    try { fs.unlinkSync(f.path); } catch { /* archivo ya movido/eliminado */ }
  }
}

async function imgUpload(req, res) {
  const id = Number(req.params.id);
  const files = req.files || [];
  if (!files.length) return badRequest(res, 'No se subieron archivos');

  const producto = await productoEnScope(req, id);
  if (!producto) {
    limpiarArchivosSubidos(files);
    return notFound(res, 'Producto no encontrado en la sede activa');
  }

  const [[actuales]] = await pool.query(
    `SELECT COUNT(*) AS total, COALESCE(MAX(orden),-1) AS max_orden FROM producto_imagen WHERE producto_id=?`,
    [id]
  );
  const totalActual = Number(actuales?.total || 0);
  if (totalActual + files.length > 3) {
    limpiarArchivosSubidos(files);
    return badRequest(res, `Máximo 3 imágenes por producto. Actualmente hay ${totalActual}.`);
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // El comportamiento previo marcaba la primera imagen de cada carga como principal,
    // pero no quitaba la principal anterior. Dejamos una sola principal de forma atómica.
    await conn.query(`UPDATE producto_imagen SET es_principal=0 WHERE producto_id=?`, [id]);

    const uploaded = [];
    const inicioOrden = Number(actuales?.max_orden ?? -1) + 1;
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const publicPath = `/productos/${id}/imagenes/public/${path.basename(f.filename)}`;
      const [r] = await conn.query(
        `INSERT INTO producto_imagen(producto_id,url,alt,es_principal,orden,fecha) VALUES(?,?,?,?,?,UTC_TIMESTAMP())`,
        [id, publicPath, f.originalname, i === 0 ? 1 : 0, inicioOrden + i]
      );
      uploaded.push({ id: r.insertId, url: publicPath, es_principal: i === 0 ? 1 : 0 });
    }

    await conn.commit();
    created(res, { uploaded, items: uploaded });
  } catch (e) {
    await conn.rollback();
    limpiarArchivosSubidos(files);
    throw e;
  } finally {
    conn.release();
  }
}

function localImageFileFromUrl(productoId, url) {
  const value = String(url || '');
  const prefix = `/productos/${productoId}/imagenes/public/`;
  if (!value.startsWith(prefix)) return null;
  const name = path.basename(value.slice(prefix.length));
  if (!name) return null;
  return path.resolve(config.uploads.dir, 'products', String(productoId), name);
}

function localVideoFileFromUrl(productoId, url) {
  const value = String(url || '');
  const prefix = `/productos/${productoId}/video/public/`;
  if (!value.startsWith(prefix)) return null;
  const name = path.basename(value.slice(prefix.length));
  if (!name) return null;
  return path.resolve(config.uploads.dir, 'products', String(productoId), 'video', name);
}

function borrarArchivoSilencioso(filePath) {
  if (!filePath) return;
  try { fs.unlinkSync(filePath); } catch { /* ya no existe */ }
}

async function videoUpload(req, res) {
  const id = Number(req.params.id);
  const file = req.file;
  if (!file) return badRequest(res, 'No se subió ningún video');

  const producto = await productoEnScope(req, id);
  if (!producto) {
    borrarArchivoSilencioso(file.path);
    return notFound(res, 'Producto no encontrado en la sede activa');
  }

  let duration;
  try {
    duration = videoDurationSeconds(file.path);
  } catch {
    borrarArchivoSilencioso(file.path);
    return badRequest(res, 'No fue posible leer la duración del video. Usa un MP4 o MOV válido.');
  }

  if (duration === null) {
    borrarArchivoSilencioso(file.path);
    return badRequest(res, 'No fue posible leer la duración del video. Usa un MP4 o MOV válido.');
  }
  if (duration <= 0 || duration > MAX_VIDEO_SECONDS + 0.05) {
    borrarArchivoSilencioso(file.path);
    return badRequest(res, `El video debe durar máximo ${MAX_VIDEO_SECONDS} segundos. Duración detectada: ${duration.toFixed(2)} s.`);
  }

  const [[actual]] = await pool.query(`SELECT video_url FROM producto WHERE id=? AND sede_id=? LIMIT 1`, [id, producto.sede_id]);
  const previousFile = localVideoFileFromUrl(id, actual?.video_url);
  const publicPath = `/productos/${id}/video/public/${path.basename(file.filename)}`;

  try {
    await pool.query(
      `UPDATE producto SET video_url=?, video_duracion_segundos=?, video_mime=?, fecha=UTC_TIMESTAMP() WHERE id=? AND sede_id=?`,
      [publicPath, Number(duration.toFixed(3)), file.mimetype, id, producto.sede_id]
    );
  } catch (e) {
    borrarArchivoSilencioso(file.path);
    throw e;
  }

  if (previousFile && path.resolve(previousFile) !== path.resolve(file.path)) borrarArchivoSilencioso(previousFile);
  created(res, { id, video_url: publicPath, video_duracion_segundos: Number(duration.toFixed(3)), video_mime: file.mimetype });
}

async function videoEliminar(req, res) {
  const id = Number(req.params.id);
  const producto = await productoEnScope(req, id);
  if (!producto) return notFound(res, 'Producto no encontrado en la sede activa');

  const [[actual]] = await pool.query(`SELECT video_url FROM producto WHERE id=? AND sede_id=? LIMIT 1`, [id, producto.sede_id]);
  const previousFile = localVideoFileFromUrl(id, actual?.video_url);
  await pool.query(
    `UPDATE producto SET video_url=NULL, video_duracion_segundos=NULL, video_mime=NULL, fecha=UTC_TIMESTAMP() WHERE id=? AND sede_id=?`,
    [id, producto.sede_id]
  );
  borrarArchivoSilencioso(previousFile);
  ok(res, { id, message: 'Video eliminado' });
}

async function webCatalogo(req, res) { return publicCatalogo(req, res); }
async function webProducto(req, res) { return publicProducto(req, res); }
async function publicCatalogo(req, res) {
  const sedeId = Number(req.query.sede_id || config.public.defaultSedeId || 1);
  const [items] = await pool.query(
    `SELECT p.id, p.codigo, p.nombre, p.descripcion, p.precio, p.precio_m, p.video_url, p.video_duracion_segundos, ${stockExpr('p')} stock,
            (SELECT pi.url FROM producto_imagen pi WHERE pi.producto_id=p.id ORDER BY pi.es_principal DESC, pi.orden ASC, pi.id ASC LIMIT 1) imagen
       FROM producto p WHERE p.sede_id=? AND p.activo=1 ORDER BY p.nombre`, [sedeId]);
  ok(res, { total: items.length, items });
}
async function publicProducto(req, res) {
  const sedeId = Number(req.query.sede_id || config.public.defaultSedeId || 1);
  const [rows] = await pool.query(
    `SELECT p.id, p.codigo, p.nombre, p.descripcion, p.garantia_info, p.precio, p.precio_m, p.categoria_id,
            p.video_url, p.video_duracion_segundos, ${stockExpr('p')} stock,
            (SELECT pi.url FROM producto_imagen pi WHERE pi.producto_id=p.id ORDER BY pi.es_principal DESC, pi.orden ASC, pi.id ASC LIMIT 1) imagen
       FROM producto p
      WHERE p.id=? AND p.sede_id=? AND p.activo=1
      LIMIT 1`,
    [Number(req.params.id), sedeId]
  );
  ok(res, rows[0] || null);
}
module.exports = { listar, get, crear, crearConImagenes, actualizar, estado, cambiarEstado: estado, imgAgregar, imgListar, imgSetPrincipal, imgReordenar, imgEliminar, imgUpload, videoUpload, videoEliminar, webCatalogo, webProducto, publicCatalogo, publicProducto };
