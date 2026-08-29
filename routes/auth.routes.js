const router = require('express').Router();
const { asyncHandler } = require('../utils/asyncHandler');
const { requireAuthAllowTemp } = require('../middleware/authJwt');
const ctl = require('../controllers/auth.controller');
router.get('/login-users', asyncHandler(ctl.loginUsersCtrl));
router.post('/login', asyncHandler(ctl.loginCtrl));
router.post('/select-sede', requireAuthAllowTemp, asyncHandler(ctl.selectSedeCtrl));
router.post('/refresh', asyncHandler(ctl.refreshCtrl));
module.exports = router;
