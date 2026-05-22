require('dotenv').config();

module.exports = {
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'inletshop_multisede',
    waitForConnections: true,
    connectionLimit: Number(process.env.DB_POOL_LIMIT || 10),
    queueLimit: 0,
    multipleStatements: false,
    timezone: 'Z',
    dateStrings: false,
  },
  server: {
    port: Number(process.env.PORT || 3010),
    corsOrigin: process.env.CORS_ORIGIN || '*',
  },
  jwt: {
    secret: process.env.JWT_SECRET || 'dev',
    expires: process.env.JWT_EXPIRES || '1d',
    refreshSecret: process.env.REFRESH_SECRET || 'dev-refresh',
    refreshExpires: process.env.REFRESH_EXPIRES || '7d',
  },
  uploads: {
    dir: process.env.UPLOAD_DIR || 'uploads',
  },
  public: {
    apiBaseUrl: (process.env.PUBLIC_API_BASE_URL || 'http://localhost:3010/api').replace(/\/$/, ''),
    defaultSedeId: Number(process.env.DEFAULT_PUBLIC_SEDE_ID || 1),
  },
};
