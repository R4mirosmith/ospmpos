require('dotenv').config();
const http = require('http');
const app = require('../app');
const config = require('../config');
const { initRealtime } = require('../realtime');

const server = http.createServer(app);
initRealtime(server);

server.listen(config.server.port, () => {
  console.log(`API POS multisede escuchando en puerto ${config.server.port}`);
});
