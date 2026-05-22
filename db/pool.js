const mysql = require('mysql2/promise');
const config = require('../config');

const pool = mysql.createPool(config.db);

async function initSession() {
  try {
    await pool.query("SET time_zone = '+00:00'");
  } catch (error) {
    console.warn('No se pudo fijar time_zone UTC:', error.message);
  }
}

initSession();

module.exports = { pool };
