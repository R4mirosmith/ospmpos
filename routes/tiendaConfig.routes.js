const path = require('path');
const fs = require('fs');
const multer = require('multer');
const router = require('express').Router();
const { asyncHandler } = require('../utils/asyncHandler');
const { requireAuth, requireRoles } = require('../middleware/authJwt');
const ctl = require('../controllers/tiendaConfig.controller');
const config = require('../config');

const root = path.resolve(config.uploads.dir, 'sedes');
const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const sedeId = Number(req.user?.sede_id || req.headers['x-sede-id']);
    if (!Number.isInteger(sedeId) || sedeId <= 0) {
      return cb(Object.assign(new Error('Debes seleccionar una sede válida'), { httpStatus: 400, code: 'SEDE_INVALIDA' }));
    }
    const dir = path.join(root, String(sedeId), 'tienda', 'logo');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    cb(null, `logo-web-${Date.now()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const mime = String(file.mimetype || '').toLowerCase();
    const ext = path.extname(file.originalname || '').toLowerCase();
    const valid = (mime === 'image/jpeg' && ['.jpg', '.jpeg'].includes(ext)) ||
      (mime === 'image/png' && ext === '.png') ||
      (mime === 'image/webp' && ext === '.webp');
    if (!valid) return cb(Object.assign(new Error('El logo debe ser JPG, PNG o WEBP'), { httpStatus: 400, code: 'INVALID_IMAGE' }));
    cb(null, true);
  },
});

router.use(requireAuth, requireRoles('ADMIN', 'GESTOR_WEB'));
router.get('/', asyncHandler(ctl.getConfig));
router.patch('/', asyncHandler(ctl.updateConfig));
router.post('/logo', upload.single('logo'), asyncHandler(ctl.uploadLogo));
router.delete('/logo', asyncHandler(ctl.resetLogo));

module.exports = router;
