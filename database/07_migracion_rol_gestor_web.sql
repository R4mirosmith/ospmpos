-- =============================================================
-- OSPM - Rol GESTOR_WEB
-- =============================================================
-- Seguro para ejecutar varias veces.
-- El rol administra el contenido del catálogo web sin acceso a
-- precios/costos administrativos y puede consultar pedidos web.
-- =============================================================

INSERT INTO usuario_tipo (tipo, activo, fecha)
SELECT 'GESTOR_WEB', 1, UTC_TIMESTAMP()
WHERE NOT EXISTS (
  SELECT 1 FROM usuario_tipo WHERE UPPER(tipo) = 'GESTOR_WEB'
);

UPDATE usuario_tipo
   SET activo = 1
 WHERE UPPER(tipo) = 'GESTOR_WEB';
