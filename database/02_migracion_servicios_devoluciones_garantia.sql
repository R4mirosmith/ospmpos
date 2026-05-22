USE inletshop_multisede;

DELIMITER $$
CREATE PROCEDURE add_column_if_missing(IN p_table VARCHAR(64), IN p_column VARCHAR(64), IN p_definition TEXT)
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = p_table AND COLUMN_NAME = p_column
  ) THEN
    SET @sql = CONCAT('ALTER TABLE `', p_table, '` ADD COLUMN ', p_definition);
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END$$
DELIMITER ;

CALL add_column_if_missing('producto','garantia_info','garantia_info TEXT NULL AFTER descripcion');

CREATE TABLE IF NOT EXISTS servicio (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  sede_id INT NOT NULL,
  categoria_id INT NULL,
  codigo VARCHAR(80) NOT NULL,
  nombre VARCHAR(255) NOT NULL,
  descripcion TEXT NULL,
  precio DECIMAL(18,2) NOT NULL DEFAULT 0,
  activo TINYINT NOT NULL DEFAULT 1,
  fecha DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_servicio_codigo_sede (sede_id, codigo),
  KEY idx_servicio_scope (empresa_id, sede_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CALL add_column_if_missing('venta_detalle','item_tipo','item_tipo ENUM(''PRODUCTO'',''SERVICIO'') NOT NULL DEFAULT ''PRODUCTO'' AFTER venta_id');
CALL add_column_if_missing('venta_detalle','servicio_id','servicio_id INT NULL AFTER producto_id');
CALL add_column_if_missing('venta_detalle','nombre_item','nombre_item VARCHAR(255) NULL AFTER servicio_id');
CALL add_column_if_missing('venta_detalle','codigo_item','codigo_item VARCHAR(80) NULL AFTER nombre_item');

ALTER TABLE venta_detalle MODIFY producto_id INT NULL;

CREATE TABLE IF NOT EXISTS devolucion_venta (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  sede_id INT NOT NULL,
  venta_id INT NOT NULL,
  usuario_id INT NOT NULL,
  motivo TEXT NULL,
  total_devuelto DECIMAL(18,2) NOT NULL DEFAULT 0,
  fecha DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  activo TINYINT NOT NULL DEFAULT 1,
  KEY idx_devolucion_scope_fecha (empresa_id, sede_id, fecha)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS devolucion_venta_detalle (
  id INT AUTO_INCREMENT PRIMARY KEY,
  devolucion_id INT NOT NULL,
  venta_detalle_id INT NOT NULL,
  producto_id INT NULL,
  servicio_id INT NULL,
  item_tipo ENUM('PRODUCTO','SERVICIO') NOT NULL DEFAULT 'PRODUCTO',
  nombre_item VARCHAR(255) NULL,
  cantidad DECIMAL(18,2) NOT NULL,
  precio_unitario DECIMAL(18,2) NOT NULL,
  total_linea DECIMAL(18,2) NOT NULL,
  KEY idx_dvd_devolucion (devolucion_id),
  KEY idx_dvd_detalle (venta_detalle_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

DROP PROCEDURE IF EXISTS add_column_if_missing;
