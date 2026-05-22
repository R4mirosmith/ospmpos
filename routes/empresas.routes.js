const router = require('express').Router();
const { asyncHandler } = require('../utils/asyncHandler');
const { requireAuth, requireRoles } = require('../middleware/authJwt');
const ctl = require('../controllers/admin.controller');
router.use(requireAuth, requireRoles('ADMIN'));
router.get('/', asyncHandler(ctl.listarEmpresas));
router.post('/', asyncHandler(ctl.crearEmpresa));
router.patch('/:id', asyncHandler(ctl.actualizarEmpresa));
module.exports = router;
