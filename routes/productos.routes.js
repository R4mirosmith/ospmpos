const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { asyncHandler } = require('../utils/asyncHandler');
const { requireAuth, requireRoles } = require('../middleware/authJwt');
const ctl = require('../controllers/productos.controller');
const { ALLOWED_VIDEO_MIME, ALLOWED_VIDEO_EXT } = require('../utils/video');

const router = express.Router();
const uploadDir = path.resolve(process.env.UPLOAD_DIR || 'uploads', 'products');
fs.mkdirSync(uploadDir, { recursive: true });

function numericProductId(req) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    throw Object.assign(new Error('ID de producto inválido'), { httpStatus: 400, code: 'PRODUCTO_ID_INVALIDO' });
  }
  return id;
}

function productDir(req) {
  return path.join(uploadDir, String(numericProductId(req)));
}

function publicFile(res, baseDir, filename, notFoundMessage) {
  const safe = path.basename(String(filename || ''));
  if (!safe || safe !== filename) {
    return res.status(400).json({ success: 0, status: 'BAD_REQUEST', result: { message: 'Nombre de archivo inválido' } });
  }
  const base = path.resolve(baseDir);
  const file = path.resolve(base, safe);
  if (!file.startsWith(base + path.sep)) {
    return res.status(400).json({ success: 0, status: 'BAD_REQUEST', result: { message: 'Ruta de archivo inválida' } });
  }
  fs.access(file, fs.constants.R_OK, (err) => {
    if (err) return res.status(404).json({ success: 0, status: 'NOT_FOUND', result: { message: notFoundMessage } });
    return res.sendFile(file);
  });
}

const imageStorage = multer.diskStorage({
  destination: (req, _file, cb) => {
    try {
      const dir = productDir(req);
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    } catch (e) { cb(e); }
  },
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, '_')}`),
});

const imageUpload = multer({
  storage: imageStorage,
  limits: { fileSize: Number(process.env.PRODUCT_IMAGE_MAX_MB || 10) * 1024 * 1024, files: 3 },
  fileFilter: (_req, file, cb) => {
    const mime = String(file.mimetype || '').toLowerCase();
    const ext = path.extname(file.originalname || '').toLowerCase();
    const allowed = new Map([
      ['image/jpeg', new Set(['.jpg', '.jpeg'])],
      ['image/png', new Set(['.png'])],
      ['image/webp', new Set(['.webp'])],
      ['image/gif', new Set(['.gif'])],
    ]);
    if (!allowed.has(mime) || !allowed.get(mime).has(ext)) {
      return cb(Object.assign(new Error('Formato de imagen no permitido. Usa JPG, PNG, WEBP o GIF.'), { httpStatus: 400, code: 'IMAGEN_TIPO_INVALIDO' }));
    }
    cb(null, true);
  },
});

const videoStorage = multer.diskStorage({
  destination: (req, _file, cb) => {
    try {
      const dir = path.join(productDir(req), 'video');
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    } catch (e) { cb(e); }
  },
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, '_')}`),
});

const videoUpload = multer({
  storage: videoStorage,
  limits: { fileSize: Number(process.env.PRODUCT_VIDEO_MAX_MB || 25) * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const mime = String(file.mimetype || '').toLowerCase();
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (!ALLOWED_VIDEO_MIME.has(mime) || !ALLOWED_VIDEO_EXT.has(ext)) {
      return cb(Object.assign(new Error('Formato de video no permitido. Usa MP4 o MOV.'), { httpStatus: 400, code: 'VIDEO_TIPO_INVALIDO' }));
    }
    cb(null, true);
  },
});

// Archivos públicos usados por OSPM Shopping.
router.get('/:id/imagenes/public/:filename', (req, res, next) => {
  try { return publicFile(res, productDir(req), req.params.filename, 'Imagen no encontrada'); } catch (e) { return next(e); }
});
router.get('/:id/video/public/:filename', (req, res, next) => {
  try { return publicFile(res, path.join(productDir(req), 'video'), req.params.filename, 'Video no encontrado'); } catch (e) { return next(e); }
});

router.get('/web/catalogo', asyncHandler(ctl.webCatalogo));
router.get('/web/productos/:id', asyncHandler(ctl.webProducto));

router.use(requireAuth);
router.get('/', asyncHandler(ctl.listar));
router.post('/', requireRoles('ADMIN', 'VENDEDOR', 'GESTOR_WEB'), asyncHandler(ctl.crear));
router.get('/:id', asyncHandler(ctl.get));
router.patch('/:id', requireRoles('ADMIN', 'VENDEDOR', 'GESTOR_WEB'), asyncHandler(ctl.actualizar));
router.patch('/:id/estado', requireRoles('ADMIN'), asyncHandler(ctl.estado));

router.post('/:id/imagenes', requireRoles('ADMIN', 'VENDEDOR', 'GESTOR_WEB'), asyncHandler(ctl.imgAgregar));
router.get('/:id/imagenes', asyncHandler(ctl.imgListar));
router.patch('/:id/imagenes/:imgId/principal', requireRoles('ADMIN', 'VENDEDOR', 'GESTOR_WEB'), asyncHandler(ctl.imgSetPrincipal));
router.post('/:id/imagenes/:imgId/principal', requireRoles('ADMIN', 'VENDEDOR', 'GESTOR_WEB'), asyncHandler(ctl.imgSetPrincipal));
router.patch('/imagenes/:imgId/orden', requireRoles('ADMIN', 'VENDEDOR', 'GESTOR_WEB'), asyncHandler(ctl.imgReordenar));
router.post('/imagenes/:imgId/orden', requireRoles('ADMIN', 'VENDEDOR', 'GESTOR_WEB'), asyncHandler(ctl.imgReordenar));
router.delete('/imagenes/:imgId', requireRoles('ADMIN', 'VENDEDOR', 'GESTOR_WEB'), asyncHandler(ctl.imgEliminar));
router.post('/:id/imagenes/upload', requireRoles('ADMIN', 'VENDEDOR', 'GESTOR_WEB'), imageUpload.array('images', 3), asyncHandler(ctl.imgUpload));

router.post('/:id/video/upload', requireRoles('ADMIN', 'VENDEDOR', 'GESTOR_WEB'), videoUpload.single('video'), asyncHandler(ctl.videoUpload));
router.delete('/:id/video', requireRoles('ADMIN', 'VENDEDOR', 'GESTOR_WEB'), asyncHandler(ctl.videoEliminar));

module.exports = router;
