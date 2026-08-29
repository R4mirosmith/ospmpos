-- =============================================================
-- OSPM - VIDEO OPCIONAL POR PRODUCTO (máximo 30 segundos)
-- =============================================================
-- Ejecutar una sola vez sobre la base existente.
-- Compatible con MySQL/MariaDB modernos.

SET @db := DATABASE();

SET @sql := IF(
  EXISTS(
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=@db AND TABLE_NAME='producto' AND COLUMN_NAME='video_url'
  ),
  'SELECT 1',
  'ALTER TABLE producto ADD COLUMN video_url TEXT NULL AFTER garantia_info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(
  EXISTS(
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=@db AND TABLE_NAME='producto' AND COLUMN_NAME='video_duracion_segundos'
  ),
  'SELECT 1',
  'ALTER TABLE producto ADD COLUMN video_duracion_segundos DECIMAL(7,3) NULL AFTER video_url'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(
  EXISTS(
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=@db AND TABLE_NAME='producto' AND COLUMN_NAME='video_mime'
  ),
  'SELECT 1',
  'ALTER TABLE producto ADD COLUMN video_mime VARCHAR(80) NULL AFTER video_duracion_segundos'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
