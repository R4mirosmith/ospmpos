-- =============================================================
-- OSPM - CONFIGURACION VISUAL DE LA TIENDA WEB POR SEDE
-- =============================================================
-- Seguro para ejecutar varias veces.
-- Permite administrar desde el POS el logo, paleta y tipografia de la web.
-- =============================================================

CREATE TABLE IF NOT EXISTS tienda_configuracion (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  sede_id INT NOT NULL,
  logo_url TEXT NULL,
  color_primario VARCHAR(7) NOT NULL DEFAULT '#050505',
  color_secundario VARCHAR(7) NOT NULL DEFAULT '#FFFFFF',
  color_acento VARCHAR(7) NOT NULL DEFAULT '#10B981',
  color_fondo VARCHAR(7) NOT NULL DEFAULT '#F8FAFC',
  color_texto VARCHAR(7) NOT NULL DEFAULT '#0F172A',
  fuente VARCHAR(30) NOT NULL DEFAULT 'INTER',
  fecha_actualizacion DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tienda_config_sede (sede_id),
  KEY idx_tienda_config_empresa (empresa_id),
  CONSTRAINT fk_tienda_config_empresa FOREIGN KEY (empresa_id) REFERENCES empresa(id),
  CONSTRAINT fk_tienda_config_sede FOREIGN KEY (sede_id) REFERENCES sede(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
