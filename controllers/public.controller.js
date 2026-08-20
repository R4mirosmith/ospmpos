const { pool } = require('../utils/sql');
const { ok, created, badRequest } = require('../utils/http');
const { emitPedidoWebNuevo } = require('../realtime');
const config = require('../config');

function publicSedeId(req) {
  return Number(req.query.sede_id || config.public.defaultSedeId);
}

async function categories(req, res) {
  const sedeId = publicSedeId(req);

  const [items] = await pool.query(
    `SELECT
       c.id,
       c.nombre,
       COUNT(p.id) AS total_productos
     FROM categoria c
     LEFT JOIN producto p
       ON p.categoria_id = c.id
      AND p.sede_id = c.sede_id
      AND p.activo = 1
     WHERE c.sede_id = ?
       AND c.activo = 1
     GROUP BY c.id, c.nombre
     ORDER BY c.nombre ASC`,
    [sedeId]
  );

  ok(res, items);
}

async function products(req, res) {
  const sedeId = publicSedeId(req);
  const categoriaId = Number(req.query.categoria_id || 0);
  const q = String(req.query.q || '').trim();
  const onlyAvailable = String(req.query.only_available || '') === '1';

  const where = ['p.sede_id=?', 'p.activo=1'];
  const params = [sedeId];

  if (categoriaId > 0) {
    where.push('p.categoria_id=?');
    params.push(categoriaId);
  }

  if (q) {
    const like = `%${q}%`;
    where.push('(p.nombre LIKE ? OR p.codigo LIKE ? OR p.descripcion LIKE ? OR c.nombre LIKE ?)');
    params.push(like, like, like, like);
  }

  if (onlyAvailable) {
    where.push(`(
      SELECT COALESCE(SUM(m.cantidad),0)
      FROM inv_movimiento m
      WHERE m.producto_id=p.id
        AND m.sede_id=p.sede_id
        AND m.activo=1
    ) > 0`);
  }

  const [items] = await pool.query(
    `SELECT
       p.id,
       p.codigo,
       p.nombre,
       p.descripcion,
       p.precio,
       p.precio_m,
       p.categoria_id,
       c.nombre AS categoria_nombre,
       (SELECT COALESCE(SUM(m.cantidad),0)
          FROM inv_movimiento m
         WHERE m.producto_id=p.id
           AND m.sede_id=p.sede_id
           AND m.activo=1) AS stock,
       (SELECT pi.url
          FROM producto_imagen pi
         WHERE pi.producto_id=p.id
         ORDER BY pi.es_principal DESC, pi.orden ASC, pi.id ASC
         LIMIT 1) AS imagen
     FROM producto p
     LEFT JOIN categoria c ON c.id=p.categoria_id
     WHERE ${where.join(' AND ')}
     ORDER BY p.nombre`,
    params
  );

  ok(res, items);
}

// Se conserva el comportamiento estable existente de detalle.
async function productDetail(req,res){ const [[p]]=await pool.query(`SELECT * FROM producto WHERE id=? AND activo=1`,[Number(req.params.id)]); ok(res,p||null); }

// IMPORTANTE: se conserva el flujo estable de creación + Socket.IO sin cambios funcionales.
async function createDeliveryOrder(req,res){ const body=req.body||{}; const sedeId=Number(body.sede_id||req.query.sede_id||config.public.defaultSedeId); const [[sede]]=await pool.query(`SELECT * FROM sede WHERE id=? AND activo=1`,[sedeId]); if(!sede) return badRequest(res,'Sede pública no configurada'); const required=['cliente_nombre','cliente_telefono','cliente_direccion','cliente_barrio']; for(const k of required) if(!body[k]) return badRequest(res,`${k} requerido`); const items=Array.isArray(body.items)?body.items:[]; if(!items.length) return badRequest(res,'El pedido debe tener productos'); const conn=await pool.getConnection(); try{ await conn.beginTransaction(); const [r]=await conn.query(`INSERT INTO pedidos_web(empresa_id,sede_id,cliente_nombre,cliente_telefono,cliente_direccion,cliente_barrio,observacion,subtotal,total,metodo_pago,origen,estado,pagado,fecha_creacion) VALUES(?,?,?,?,?,?,?,?,0,'CONTRA_ENTREGA','WEB','PENDIENTE',0,UTC_TIMESTAMP())`,[sede.empresa_id,sede.id,body.cliente_nombre,body.cliente_telefono,body.cliente_direccion,body.cliente_barrio,body.observacion||null,0]); const pedidoId=r.insertId; let total=0; const cleanItems=[]; for(const it of items){ const [[p]]=await conn.query(`SELECT id,nombre,precio FROM producto WHERE id=? AND sede_id=? AND activo=1`,[Number(it.producto_id),sede.id]); if(!p) throw new Error(`Producto ${it.producto_id} no disponible`); const cantidad=Number(it.cantidad ?? 1); if(!Number.isFinite(cantidad) || cantidad<=0) throw Object.assign(new Error(`Cantidad inválida para ${p.nombre}`),{httpStatus:400,code:'CANTIDAD_INVALIDA'}); const subtotal=Number(p.precio)*cantidad; total+=subtotal; await conn.query(`INSERT INTO pedidos_web_detalle(pedido_web_id,producto_id,nombre_producto,precio,cantidad,subtotal,fecha_creacion) VALUES(?,?,?,?,?,?,UTC_TIMESTAMP())`,[pedidoId,p.id,p.nombre,p.precio,cantidad,subtotal]); cleanItems.push({producto_id:p.id,nombre:p.nombre,cantidad,subtotal}); } await conn.query(`UPDATE pedidos_web SET subtotal=?, total=? WHERE id_pedido_web=?`,[total,total,pedidoId]); await conn.commit(); const payload={id_pedido_web:pedidoId,sede_id:sede.id,cliente_nombre:body.cliente_nombre,cliente_telefono:body.cliente_telefono,cliente_barrio:body.cliente_barrio,cliente_direccion:body.cliente_direccion,total,cantidad_items:cleanItems.length,items:cleanItems,fecha:new Date().toISOString()}; await emitPedidoWebNuevo(payload,{sede_id:sede.id}); created(res,{id_pedido_web:pedidoId,estado:'PENDIENTE',total}); }catch(e){ await conn.rollback(); throw e;} finally{conn.release();}}

module.exports={categories,products,productDetail,createDeliveryOrder};
