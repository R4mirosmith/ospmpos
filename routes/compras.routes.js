const router = require('express').Router();
const { asyncHandler } = require('../utils/asyncHandler');
const { requireAuth, requireRoles } = require('../middleware/authJwt');
const ctl = require('../controllers/compras.controller');

router.use(requireAuth);
router.get('/', requireRoles('ADMIN', 'VENDEDOR'), asyncHandler(ctl.listar));
router.get('/:id', requireRoles('ADMIN', 'VENDEDOR'), asyncHandler(ctl.obtener));
router.post('/', requireRoles('ADMIN', 'VENDEDOR'), asyncHandler(ctl.crear));
router.post('/:id/anular', requireRoles('ADMIN'), asyncHandler(ctl.anular));

module.exports = router;
