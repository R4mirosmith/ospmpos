const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const config = require('./config');
const { errorHandler } = require('./utils/http');
const { gestorWebScope } = require('./middleware/gestorWebScope');

const app = express();
const configuredCorsOrigins = String(config.server.corsOrigin || '*')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

const corsOrigin = configuredCorsOrigins.includes('*')
  ? true
  : (origin, callback) => {
      // Permite requests sin Origin (health checks, apps nativas, server-to-server)
      if (!origin || configuredCorsOrigins.includes(origin)) return callback(null, true);
      return callback(new Error('Origen no permitido por CORS'));
    };

app.use(cors({ origin: corsOrigin, credentials: true }));
app.use(express.json({ limit: '8mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));
app.use('/files', express.static(path.resolve(config.uploads.dir)));

app.get('/api/health', (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

app.use('/api/auth', require('./routes/auth.routes'));
app.use(gestorWebScope);
app.use('/api/admin', require('./routes/admin.routes'));
app.use('/api/empresas', require('./routes/empresas.routes'));
app.use('/api/sedes', require('./routes/sedes.routes'));
app.use('/api/usuarios', require('./routes/usuarios.routes'));
app.use('/api/usuario-tipos', require('./routes/usuario_tipos.routes'));
app.use('/api/categorias', require('./routes/categorias.routes'));
app.use('/api/clientes', require('./routes/clientes.routes'));
app.use('/api/proveedores', require('./routes/proveedores.routes'));
app.use('/api/productos', require('./routes/productos.routes'));
app.use('/api/servicios', require('./routes/servicios.routes'));
app.use('/api/inventario', require('./routes/inventario.routes'));
app.use('/api/compras', require('./routes/compras.routes'));
app.use('/api/ventas', require('./routes/ventas.routes'));
app.use('/api/dashboard', require('./routes/dashboard.routes'));
app.use('/api/reportes', require('./routes/reportes.routes'));
app.use('/api/deducciones', require('./routes/deducciones.routes'));
app.use('/api/pedidos-web', require('./routes/pedidosWeb.routes'));
app.use('/api/notificaciones', require('./routes/notificaciones.routes'));
app.use('/api/public', require('./routes/public.routes'));

app.use((req, res) => res.status(404).json({ success: 0, status: 'NOT_FOUND', result: { message: 'Ruta no encontrada' } }));
app.use(errorHandler);

module.exports = app;
