const router = require('express').Router();
const { asyncHandler } = require('../utils/asyncHandler');
const { requireAuth, requireRoles } = require('../middleware/authJwt');
const ctl = require('../controllers/deducciones.controller');

router.use(requireAuth, requireRoles('ADMIN'));
router.get('/conceptos', asyncHandler(ctl.conceptos));
router.post('/conceptos', asyncHandler(ctl.crearConcepto));
router.patch('/conceptos/:id', asyncHandler(ctl.actualizarConcepto));
router.get('/resumen', asyncHandler(ctl.resumen));
router.get('/', asyncHandler(ctl.listar));
router.post('/', asyncHandler(ctl.crear));
router.patch('/:id/anular', asyncHandler(ctl.anular));

module.exports = router;
