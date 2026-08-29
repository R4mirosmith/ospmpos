const { verifyAccess } = require('../utils/jwt');
const { unauthorized, forbidden } = require('../utils/http');

function authenticate({ allowTemp = false } = {}) {
  return (req, res, next) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return unauthorized(res, 'Token requerido');

    try {
      const user = verifyAccess(token);
      if (user?.temp_login && !allowTemp) {
        return unauthorized(res, 'Debes seleccionar un negocio/sede antes de continuar');
      }
      req.user = user;
      return next();
    } catch {
      return unauthorized(res, 'Token inválido o expirado');
    }
  };
}

// Middleware normal: exige que el usuario ya haya terminado el login y elegido sede.
const requireAuth = authenticate();
// Solo para /auth/select-sede: permite el token temporal emitido por /auth/login.
const requireAuthAllowTemp = authenticate({ allowTemp: true });

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

module.exports = { requireAuth, requireAuthAllowTemp, requireRoles };
