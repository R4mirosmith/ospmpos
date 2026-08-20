const router = require('express').Router();
const { asyncHandler } = require('../utils/asyncHandler');
const ctl = require('../controllers/public.controller');

// Catálogo público para la tienda externa. No requiere autenticación.
router.get('/categories', asyncHandler(ctl.categories));
router.get('/products', asyncHandler(ctl.products));
router.get('/products/:id', asyncHandler(ctl.productDetail));
router.post('/orders/delivery', asyncHandler(ctl.createDeliveryOrder));

module.exports = router;
