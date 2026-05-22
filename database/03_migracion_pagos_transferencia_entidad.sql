-- Migración: entidad/canal de transferencia para pagos
-- Ejecutar solo si ya tienes la base creada con versiones anteriores.

SET @db_name := DATABASE();

SET @sql := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE venta_pago ADD COLUMN entidad_transferencia ENUM(''NEQUI'',''BANCOLOMBIA'',''DAVIPLATA'',''OTRO'') NULL AFTER metodo',
    'SELECT ''entidad_transferencia ya existe'' AS message'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'venta_pago'
    AND COLUMN_NAME = 'entidad_transferencia'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Si alguna venta vieja usó metodo NEQUI/DAVIPLATA como método directo, la normalizamos
-- para reportes futuros sin perder el dato.
UPDATE venta_pago
SET entidad_transferencia = 'NEQUI', metodo = 'TRANSFERENCIA'
WHERE metodo = 'NEQUI';

UPDATE venta_pago
SET entidad_transferencia = 'DAVIPLATA', metodo = 'TRANSFERENCIA'
WHERE metodo = 'DAVIPLATA';

UPDATE venta_pago
SET entidad_transferencia = 'OTRO'
WHERE metodo = 'TRANSFERENCIA'
  AND entidad_transferencia IS NULL;
