const { verifyAccess } = require('../utils/jwt');
const { unauthorized, forbidden } = require('../utils/http');

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return unauthorized(res, 'Token requerido');
  try {
    req.user = verifyAccess(token);
    return next();
  } catch (error) {
    return unauthorized(res, 'Token inválido o expirado');
  }
}

function requireRoles(...roles) {
  const allowed = roles.map((r) => String(r).toUpperCase());
  return (req, res, next) => {
    if (!req.user) return unauthorized(res, 'Token requerido');
    if (!allowed.includes(String(req.user.role || '').toUpperCase())) {
      return forbidden(res);
    }
    next();
  };
}

module.exports = { requireAuth, requireRoles };
