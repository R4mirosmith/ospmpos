const router = require('express').Router();
const { asyncHandler } = require('../utils/asyncHandler');
const { requireAuth, requireRoles } = require('../middleware/authJwt');
const ctl = require('../controllers/admin.controller');
router.use(requireAuth);
router.get('/', requireRoles('ADMIN','VENDEDOR'), asyncHandler(ctl.listarSedes));
router.post('/', requireRoles('ADMIN'), asyncHandler(ctl.crearSede));
router.patch('/:id', requireRoles('ADMIN'), asyncHandler(ctl.actualizarSede));
module.exports = router;
