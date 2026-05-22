const { Server } = require('socket.io');
const { verifyAccess } = require('./utils/jwt');
const { pool } = require('./db/pool');

let io = null;

function initRealtime(httpServer) {
  io = new Server(httpServer, {
    path: '/api/socket.io',
    cors: { origin: '*', methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'] },
  });

  io.on('connection', (socket) => {
    const token = socket.handshake.auth?.token || '';
    let user = null;
    try {
      user = token ? verifyAccess(token) : null;
    } catch {}

    if (user?.id) socket.join(`user:${user.id}`);
    if (user?.sede_id) socket.join(`sede:${user.sede_id}`);
    socket.join('pos'); // compatibilidad visual, no se usa para pedidos web dirigidos

    console.log('Realtime conectado:', socket.id, user?.email || 'public');
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
