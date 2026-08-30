const router = require('express').Router();
const { asyncHandler } = require('../utils/asyncHandler');
const { requireAuth, requireRoles } = require('../middleware/authJwt');
const ctl = require('../controllers/pedidosWeb.controller');

router.use(requireAuth);
router.get('/', requireRoles('ADMIN', 'VENDEDOR', 'GESTOR_WEB'), asyncHandler(ctl.listar));
// Debe ir antes de /:id para que "ventas-realizadas" no se interprete como id.
router.get('/ventas-realizadas', requireRoles('GESTOR_WEB'), asyncHandler(ctl.ventasRealizadas));
router.get('/:id', requireRoles('ADMIN', 'VENDEDOR', 'GESTOR_WEB'), asyncHandler(ctl.get));
router.patch('/:id/confirmar', requireRoles('ADMIN', 'VENDEDOR', 'GESTOR_WEB'), asyncHandler(ctl.confirmar));
router.patch('/:id/cancelar', requireRoles('ADMIN', 'VENDEDOR', 'GESTOR_WEB'), asyncHandler(ctl.cancelar));
router.post('/:id/facturar', requireRoles('ADMIN', 'VENDEDOR', 'GESTOR_WEB'), asyncHandler(ctl.facturar));
router.patch('/:id/estado', requireRoles('ADMIN', 'VENDEDOR', 'GESTOR_WEB'), asyncHandler(ctl.cambiarEstado));

module.exports = router;
