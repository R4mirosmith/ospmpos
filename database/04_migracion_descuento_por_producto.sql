-- Migración segura para soporte de descuento por producto/línea.
-- Si tu schema ya tiene venta_detalle.descuento, no hará cambios.

SET @db := DATABASE();

SET @exists_desc := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db
    AND TABLE_NAME = 'venta_detalle'
    AND COLUMN_NAME = 'descuento'
);

SET @sql := IF(
  @exists_desc = 0,
  'ALTER TABLE venta_detalle ADD COLUMN descuento DECIMAL(18,2) NOT NULL DEFAULT 0 AFTER precio_unitario',
  'SELECT ''venta_detalle.descuento ya existe'' AS info'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Recalcula total_linea como neto cuando existan descuentos por línea.
-- No toca ventas antiguas con descuento = 0.
UPDATE venta_detalle
   SET total_linea = GREATEST(0, (cantidad * precio_unitario) - descuento)
 WHERE descuento > 0;
