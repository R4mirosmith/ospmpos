const { Server } = require('socket.io');
const { verifyAccess } = require('./utils/jwt');
const { pool } = require('./db/pool');
const config = require('./config');

let io = null;

function socketCorsOrigin() {
  const origins = String(config.server.corsOrigin || '*')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  if (origins.includes('*')) return true;
  return (origin, callback) => {
    if (!origin || origins.includes(origin)) return callback(null, true);
    return callback(new Error('Origen no permitido por CORS'));
  };
}

function initRealtime(httpServer) {
  io = new Server(httpServer, {
    path: '/api/socket.io',
    cors: {
      origin: socketCorsOrigin(),
      methods: ['GET', 'POST'],
      credentials: true,
    },
  });

  io.use((socket, next) => {
    const token = String(socket.handshake.auth?.token || '');
    if (!token) return next(new Error('Token requerido'));
    try {
      socket.user = verifyAccess(token);
      if (socket.user?.temp_login) return next(new Error('Debes seleccionar una sede antes de conectar realtime'));
      return next();
    } catch {
      return next(new Error('Token inválido o expirado'));
    }
  });

  io.on('connection', (socket) => {
    const user = socket.user || null;
    if (user?.id) socket.join(`user:${user.id}`);
    if (user?.sede_id) socket.join(`sede:${user.sede_id}`);
    socket.join('pos'); // compatibilidad visual; los pedidos se emiten por usuario configurado.

    console.log('Realtime conectado:', socket.id, user?.email || 'auth');
  });

  return io;
}

async function emitPedidoWebNuevo(payload, context = {}) {
  if (!io) return;
  const sedeId = Number(context.sede_id || payload?.sede_id || 0);
  if (!sedeId) return;

  const [targets] = await pool.query(
    `SELECT DISTINCT usuario_id
       FROM notificacion_config
      WHERE activo = 1
        AND tipo = 'PEDIDO_WEB'
        AND sede_id = ?`,
    [sedeId]
  );

  for (const row of targets) {
    io.to(`user:${row.usuario_id}`).emit('pedido-web:nuevo', payload);
  }
}

module.exports = { initRealtime, emitPedidoWebNuevo };
