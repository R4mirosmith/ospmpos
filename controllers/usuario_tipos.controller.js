const { pool } = require('../db/pool');
const { ok, created, badRequest } = require('../utils/http');
async function listar(req, res) {
  const [items] = await pool.query(`SELECT * FROM usuario_tipo WHERE (? IS NULL OR activo=?) ORDER BY tipo`, [req.query.activo ?? null, req.query.activo ?? null]);
  ok(res, { items, total: items.length });
}
async function crear(req, res) { if (!req.body?.tipo) return badRequest(res,'tipo requerido'); const [r]=await pool.query(`INSERT INTO usuario_tipo(tipo,activo,fecha) VALUES(?,1,UTC_TIMESTAMP())`,[String(req.body.tipo).toUpperCase()]); created(res,{id:r.insertId}); }
async function estado(req, res) { await pool.query(`UPDATE usuario_tipo SET activo=? WHERE id=?`,[req.body?.activo?1:0,Number(req.params.id)]); ok(res,{id:Number(req.params.id)}); }
module.exports={listar,crear,estado};
