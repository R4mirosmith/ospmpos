const router = require('express').Router();
const { asyncHandler } = require('../utils/asyncHandler');
const { requireAuth } = require('../middleware/authJwt');
const ctl = require('../controllers/reportes.controller');

router.use(requireAuth);
router.get('/ventas-series', asyncHandler(ctl.ventasSeries));
router.get('/top-productos', asyncHandler(ctl.topProductos));
router.get('/ventas-por-categoria', asyncHandler(ctl.ventasPorCategoria));
router.get('/productos-por-categoria', asyncHandler(ctl.productosPorCategoria));
router.get('/movimientos-detalle', asyncHandler(ctl.movimientosDetalle));
router.get('/stock', asyncHandler(ctl.stock));
router.get('/pagos-por-metodo', asyncHandler(ctl.pagosPorMetodo));
router.get('/cxc', asyncHandler(ctl.cxc));
router.get('/ventas-por-usuario', asyncHandler(ctl.ventasPorUsuario));
router.get('/admin-resumen', asyncHandler(ctl.resumenAdmin));

module.exports = router;
