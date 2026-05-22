const { pool, pageLimit } = require('../utils/sql');
const { ok, created, badRequest } = require('../utils/http');
const { writeScope, addScopeWhere, clean } = require('../utils/scope');

const TABLES = {
  categorias: { table: 'categoria', fields: ['nombre','descripcion','activo'], required: ['nombre'] },
  clientes: { table: 'cliente', fields: ['nombre','documento','email','direccion','activo'], required: ['nombre'] },
  proveedores: { table: 'proveedor', fields: ['nombre','nit','telefono','direccion','activo'], required: ['nombre'] },
};

function handler(kind) {
  const cfg = TABLES[kind];
  return {
    async listar(req, res) {
      const { limit, offset } = pageLimit(req.query.page, req.query.pageSize);
      const scope = addScopeWhere(req, 't');
      const where = [...scope.where]; const params = [...scope.params];
      const buscar = clean(req.query.buscar);
      if (buscar) { where.push('(t.nombre LIKE ? OR CAST(t.id AS CHAR) LIKE ?)'); params.push(`%${buscar}%`,`%${buscar}%`); }
      if (clean(req.query.activo) !== null) { where.push('t.activo=?'); params.push(Number(req.query.activo)); }
      const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const [[countRow]] = await pool.query(`SELECT COUNT(*) total FROM ${cfg.table} t ${w}`, params);
      const [items] = await pool.query(`SELECT t.* FROM ${cfg.table} t ${w} ORDER BY t.id DESC LIMIT ? OFFSET ?`, [...params, limit, offset]);
      ok(res, { items, total: Number(countRow.total || 0) });
    },
    async get(req, res) {
      const scope = addScopeWhere(req, 't');
      const [rows] = await pool.query(`SELECT t.* FROM ${cfg.table} t WHERE t.id=? ${scope.where.length ? 'AND ' + scope.where.join(' AND ') : ''} LIMIT 1`, [Number(req.params.id), ...scope.params]);
      ok(res, rows[0] || null);
    },
    async crear(req, res) {
      for (const f of cfg.required) if (!req.body?.[f]) return badRequest(res, `${f} requerido`);
      const s = await writeScope(req);
      const data = { ...req.body, activo: req.body?.activo === undefined ? 1 : (req.body.activo ? 1 : 0), empresa_id: s.empresa_id, sede_id: s.sede_id };
      const fields = ['empresa_id','sede_id',...cfg.fields,'fecha'];
      const vals = fields.map(f => f === 'fecha' ? null : (data[f] ?? null));
      const sqlFields = fields.map(f => f === 'fecha' ? 'fecha' : f).join(',');
      const placeholders = fields.map(f => f === 'fecha' ? 'UTC_TIMESTAMP()' : '?').join(',');
      const [r] = await pool.query(`INSERT INTO ${cfg.table}(${sqlFields}) VALUES(${placeholders})`, vals.filter((_,i)=>fields[i] !== 'fecha'));
      created(res, { id: r.insertId, message: 'Registro creado' });
    },
    async actualizar(req, res) {
      const updates = cfg.fields.filter(f => req.body?.[f] !== undefined);
      if (!updates.length) return ok(res, { id: Number(req.params.id) });
      const set = updates.map(f => `${f}=?`).join(', ');
      const params = updates.map(f => f === 'activo' ? (req.body[f] ? 1 : 0) : req.body[f]);
      const scope = addScopeWhere(req, cfg.table);
      await pool.query(`UPDATE ${cfg.table} SET ${set}, fecha=UTC_TIMESTAMP() WHERE id=? ${scope.where.length ? 'AND ' + scope.where.join(' AND ') : ''}`, [...params, Number(req.params.id), ...scope.params]);
      ok(res, { id: Number(req.params.id), message: 'Registro actualizado' });
    },
    async estado(req, res) {
      const scope = addScopeWhere(req, cfg.table);
      await pool.query(`UPDATE ${cfg.table} SET activo=?, fecha=UTC_TIMESTAMP() WHERE id=? ${scope.where.length ? 'AND ' + scope.where.join(' AND ') : ''}`, [req.body?.activo ? 1 : 0, Number(req.params.id), ...scope.params]);
      ok(res, { id: Number(req.params.id), activo: req.body?.activo ? 1 : 0 });
    }
  };
}

module.exports = { categorias: handler('categorias'), clientes: handler('clientes'), proveedores: handler('proveedores') };
