const router=require('express').Router(); const {asyncHandler}=require('../utils/asyncHandler'); const {requireAuth,requireRoles}=require('../middleware/authJwt'); const ctl=require('../controllers/usuarios.controller');
router.use(requireAuth, requireRoles('ADMIN'));
router.get('/',asyncHandler(ctl.listar)); router.post('/',asyncHandler(ctl.crear)); router.get('/:id',asyncHandler(ctl.get)); router.patch('/:id',asyncHandler(ctl.actualizar)); router.patch('/:id/password',asyncHandler(ctl.setPassword)); router.patch('/:id/estado',asyncHandler(ctl.estado)); module.exports=router;
