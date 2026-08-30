-- =============================================================
-- OSPM - COLORES DISPONIBLES POR PRODUCTO
-- =============================================================
-- Seguro para ejecutar varias veces.
-- Los colores se guardan como un arreglo JSON dentro de TEXT para mantener
-- compatibilidad amplia con MySQL/MariaDB (ej. ["Negro","Azul"]).
-- =============================================================

SET @db := DATABASE();

SET @sql := IF(
  EXISTS(
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=@db AND TABLE_NAME='producto' AND COLUMN_NAME='colores_disponibles'
  ),
  'SELECT 1',
  'ALTER TABLE producto ADD COLUMN colores_disponibles TEXT NULL AFTER garantia_info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
