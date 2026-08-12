const path = require('path');
const fs = require('fs');
const multer = require('multer');
const router = require('express').Router();
const { asyncHandler } = require('../utils/asyncHandler');
const { requireAuth, requireRoles } = require('../middleware/authJwt');
const ctl = require('../controllers/admin.controller');
const config = require('../config');

const logoRoot = path.resolve(config.uploads.dir, 'sedes');
const logoStorage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const dir = path.join(logoRoot, String(Number(req.params.id)), 'logo');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase().replace(/[^.a-z0-9]/g, '');
    cb(null, `logo-${Date.now()}${ext || '.img'}`);
  },
});
const logoUpload = multer({
  storage: logoStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!String(file.mimetype || '').startsWith('image/')) {
      return cb(Object.assign(new Error('El logo debe ser una imagen'), { httpStatus: 400, code: 'INVALID_IMAGE' }));
    }
    cb(null, true);
  },
});

router.use(requireAuth, requireRoles('ADMIN'));
router.get('/empresas', asyncHandler(ctl.listarEmpresas));
router.post('/empresas', asyncHandler(ctl.crearEmpresa));
router.patch('/empresas/:id', asyncHandler(ctl.actualizarEmpresa));
router.get('/sedes', asyncHandler(ctl.listarSedes));
router.post('/sedes', asyncHandler(ctl.crearSede));
router.patch('/sedes/:id', asyncHandler(ctl.actualizarSede));
router.post('/sedes/:id/logo', logoUpload.single('logo'), asyncHandler(ctl.subirLogoSede));

module.exports = router;
