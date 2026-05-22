const { pool, pageLimit } = require('../utils/sql');
const { ok, created, badRequest } = require('../utils/http');
const { writeScope, addScopeWhere, colombiaDateRange, clean } = require('../utils/scope');
function num(v,d=0){const n=Number(v);return Number.isFinite(n)?n:d;}
async function ajuste(req,res){
  const { producto_id, tipo='IN_AJUSTE', cantidad, costo_unitario=0, comentario=null }=req.body||{}; if(!producto_id||!cantidad) return badRequest(res,'producto_id y cantidad requeridos');
  const s=await writeScope(req); const sign=String(tipo).startsWith('OUT')?-1:1;
  const [r]=await pool.query(`INSERT INTO inv_movimiento(empresa_id,sede_id,producto_id,usuario_id,tipo,cantidad,costo_unitario,comentario,fecha,activo) VALUES(?,?,?,?,?,?,?,?,UTC_TIMESTAMP(),1)`,[s.empresa_id,s.sede_id,producto_id,req.user.id,tipo,Math.abs(num(cantidad))*sign,num(costo_unitario),comentario]);
  created(res,{id:r.insertId});
}
async function stockInicial(req,res){ req.body.tipo='IN_AJUSTE'; return ajuste(req,res); }
async function stockList(req,res){
  const {limit,offset}=pageLimit(req.query.page,req.query.pageSize); const scope=addScopeWhere(req,'p'); const where=[...scope.where]; const params=[...scope.params]; if(clean(req.query.buscar)){where.push('(p.nombre LIKE ? OR p.codigo LIKE ?)');params.push(`%${req.query.buscar}%`,`%${req.query.buscar}%`);} const w=where.length?`WHERE ${where.join(' AND ')}`:'';
  const [items]=await pool.query(`SELECT p.id producto_id,p.codigo,p.nombre,p.stock_minimo,p.costo costo_promedio,COALESCE(SUM(m.cantidad),0) stock_actual,COALESCE(SUM(m.cantidad),0)*p.costo valor FROM producto p LEFT JOIN inv_movimiento m ON m.producto_id=p.id AND m.sede_id=p.sede_id AND m.activo=1 ${w} GROUP BY p.id ORDER BY p.nombre LIMIT ? OFFSET ?`,[...params,limit,offset]);
  ok(res,{items,total:items.length});
}
async function kardex(req,res){
  const scope=addScopeWhere(req,'m'); const where=[...scope.where]; const params=[...scope.params]; if(req.query.producto_id){where.push('m.producto_id=?'); params.push(Number(req.query.producto_id));} const r=colombiaDateRange(req.query.desde,req.query.hasta,'m.fecha'); where.push(...r.where); params.push(...r.params);
  const [items]=await pool.query(`SELECT m.*,p.nombre producto_nombre,p.codigo,u.nombre usuario_nombre FROM inv_movimiento m JOIN producto p ON p.id=m.producto_id LEFT JOIN usuario u ON u.id=m.usuario_id ${where.length?'WHERE '+where.join(' AND '):''} ORDER BY m.fecha DESC, m.id DESC LIMIT 500`,params); ok(res,{items,total:items.length});
}
module.exports={ajuste,stockInicial,stockList,kardex};
