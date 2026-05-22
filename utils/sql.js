const { pool } = require('../db/pool');

function likeParam(value) { return `%${String(value || '').trim()}%`; }
function pageLimit(page = 1, pageSize = 50) {
  const limit = Math.max(1, Math.min(500, Number(pageSize) || 50));
  const offset = Math.max(0, ((Number(page) || 1) - 1) * limit);
  return { limit, offset };
}
async function one(sql, params = []) { const [rows] = await pool.query(sql, params); return rows[0] || null; }
async function many(sql, params = []) { const [rows] = await pool.query(sql, params); return rows; }
async function exec(sql, params = []) { const [r] = await pool.query(sql, params); return r; }

module.exports = { pool, likeParam, pageLimit, one, many, exec };
