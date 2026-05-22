USE inletshop_multisede;

CREATE TABLE IF NOT EXISTS deduccion_concepto (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  sede_id INT NOT NULL,
  nombre VARCHAR(160) NOT NULL,
  tipo ENUM('PRESTAMO_EMPLEADO','PRESTAMO_SEDE','GASTO','OTRO') NOT NULL DEFAULT 'OTRO',
  activo TINYINT NOT NULL DEFAULT 1,
  fecha DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_deduccion_concepto_scope (empresa_id, sede_id),
  CONSTRAINT fk_deduccion_concepto_empresa FOREIGN KEY (empresa_id) REFERENCES empresa(id),
  CONSTRAINT fk_deduccion_concepto_sede FOREIGN KEY (sede_id) REFERENCES sede(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS deduccion (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  sede_id INT NOT NULL,
  concepto_id INT NOT NULL,
  empleado_usuario_id INT NULL,
  sede_destino_id INT NULL,
  descripcion TEXT NULL,
  monto DECIMAL(18,2) NOT NULL DEFAULT 0,
  fecha DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by INT NOT NULL,
  activo TINYINT NOT NULL DEFAULT 1,
  KEY idx_deduccion_scope_fecha (empresa_id, sede_id, fecha),
  KEY idx_deduccion_concepto (concepto_id),
  KEY idx_deduccion_empleado (empleado_usuario_id),
  CONSTRAINT fk_deduccion_empresa FOREIGN KEY (empresa_id) REFERENCES empresa(id),
  CONSTRAINT fk_deduccion_sede FOREIGN KEY (sede_id) REFERENCES sede(id),
  CONSTRAINT fk_deduccion_concepto FOREIGN KEY (concepto_id) REFERENCES deduccion_concepto(id),
  CONSTRAINT fk_deduccion_empleado FOREIGN KEY (empleado_usuario_id) REFERENCES usuario(id),
  CONSTRAINT fk_deduccion_sede_destino FOREIGN KEY (sede_destino_id) REFERENCES sede(id),
  CONSTRAINT fk_deduccion_created_by FOREIGN KEY (created_by) REFERENCES usuario(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO deduccion_concepto(empresa_id,sede_id,nombre,tipo,activo)
SELECT s.empresa_id, s.id, 'Préstamo a empleado', 'PRESTAMO_EMPLEADO', 1
FROM sede s
WHERE NOT EXISTS (
  SELECT 1 FROM deduccion_concepto dc WHERE dc.sede_id=s.id AND dc.nombre='Préstamo a empleado'
);

INSERT INTO deduccion_concepto(empresa_id,sede_id,nombre,tipo,activo)
SELECT s.empresa_id, s.id, 'Préstamo entre sedes', 'PRESTAMO_SEDE', 1
FROM sede s
WHERE NOT EXISTS (
  SELECT 1 FROM deduccion_concepto dc WHERE dc.sede_id=s.id AND dc.nombre='Préstamo entre sedes'
);

INSERT INTO deduccion_concepto(empresa_id,sede_id,nombre,tipo,activo)
SELECT s.empresa_id, s.id, 'Gasto operativo', 'GASTO', 1
FROM sede s
WHERE NOT EXISTS (
  SELECT 1 FROM deduccion_concepto dc WHERE dc.sede_id=s.id AND dc.nombre='Gasto operativo'
);
