const { verifyAccess } = require('../utils/jwt');
const { forbidden } = require('../utils/http');

const ROL_GESTOR_WEB = 'GESTOR_WEB';

function gestorWebScope(req, res, next) {
  if (req.method === 'OPTIONS') return next();

  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next();

  let user;
  try {
    user = verifyAccess(token);
  } catch {
    // La autenticación específica de cada ruta devolverá el error correspondiente.
    return next();
  }

  if (String(user?.role || '').toUpperCase() !== ROL_GESTOR_WEB) return next();

  const route = String(req.path || '');
  const method = String(req.method || 'GET').toUpperCase();

  const allowed =
    route.startsWith('/api/productos') ||
    route.startsWith('/api/pedidos-web') ||
    route.startsWith('/api/public') ||
    (route.startsWith('/api/categorias') && method === 'GET');

  if (!allowed) {
    return forbidden(res, 'Este rol solo puede acceder a productos, pedidos web y notificaciones asociadas a la tienda.');
  }

  return next();
}

module.exports = { gestorWebScope };
