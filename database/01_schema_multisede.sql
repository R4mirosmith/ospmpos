CREATE DATABASE IF NOT EXISTS inletshop_multisede CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE inletshop_multisede;

SET FOREIGN_KEY_CHECKS=0;
DROP TABLE IF EXISTS tienda_configuracion, notificacion_config, pedidos_web_detalle, pedidos_web, deduccion, deduccion_concepto, devolucion_venta_detalle, devolucion_venta, venta_pago, venta_detalle, venta, compra_detalle, compra, inv_movimiento, producto_imagen, producto, servicio, proveedor, cliente, categoria, usuario_sede, usuario, sede, empresa, usuario_tipo;
SET FOREIGN_KEY_CHECKS=1;

CREATE TABLE usuario_tipo (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tipo VARCHAR(40) NOT NULL UNIQUE,
  activo TINYINT NOT NULL DEFAULT 1,
  fecha DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE empresa (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(160) NOT NULL,
  nit VARCHAR(50) NULL,
  telefono VARCHAR(40) NULL,
  direccion VARCHAR(255) NULL,
  activo TINYINT NOT NULL DEFAULT 1,
  fecha_creacion DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE sede (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  nombre VARCHAR(160) NOT NULL,
  razon_social VARCHAR(180) NULL,
  nit VARCHAR(50) NULL,
  codigo VARCHAR(40) NULL,
  direccion VARCHAR(255) NULL,
  telefono VARCHAR(40) NULL,
  correo VARCHAR(120) NULL,
  logo_url TEXT NULL,
  prefijo_factura VARCHAR(20) NULL,
  es_principal TINYINT NOT NULL DEFAULT 0,
  activo TINYINT NOT NULL DEFAULT 1,
  fecha_creacion DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_sede_empresa (empresa_id),
  CONSTRAINT fk_sede_empresa FOREIGN KEY (empresa_id) REFERENCES empresa(id)
 ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE tienda_configuracion (
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

CREATE TABLE usuario (
  id INT AUTO_INCREMENT PRIMARY KEY,
  usuario_tipo_id INT NOT NULL,
  nombre VARCHAR(255) NOT NULL,
  hash_password TEXT NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  activo TINYINT NOT NULL DEFAULT 1,
  fecha DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_usuario_tipo FOREIGN KEY (usuario_tipo_id) REFERENCES usuario_tipo(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE usuario_sede (
  id INT AUTO_INCREMENT PRIMARY KEY,
  usuario_id INT NOT NULL,
  sede_id INT NOT NULL,
  activo TINYINT NOT NULL DEFAULT 1,
  fecha_creacion DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_usuario_sede (usuario_id, sede_id),
  KEY idx_usuario_sede_sede (sede_id),
  CONSTRAINT fk_us_usuario FOREIGN KEY (usuario_id) REFERENCES usuario(id),
  CONSTRAINT fk_us_sede FOREIGN KEY (sede_id) REFERENCES sede(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE categoria (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  sede_id INT NOT NULL,
  nombre VARCHAR(255) NOT NULL,
  descripcion TEXT NULL,
  activo TINYINT NOT NULL DEFAULT 1,
  fecha DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_categoria_scope (empresa_id, sede_id),
  CONSTRAINT fk_categoria_empresa FOREIGN KEY (empresa_id) REFERENCES empresa(id),
  CONSTRAINT fk_categoria_sede FOREIGN KEY (sede_id) REFERENCES sede(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE cliente (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  sede_id INT NOT NULL,
  nombre VARCHAR(160) NOT NULL,
  documento VARCHAR(45) NULL,
  email VARCHAR(100) NULL,
  direccion VARCHAR(255) NULL,
  activo TINYINT NOT NULL DEFAULT 1,
  fecha DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_cliente_scope (empresa_id, sede_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE proveedor (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  sede_id INT NOT NULL,
  nombre VARCHAR(255) NOT NULL,
  nit VARCHAR(45) NULL,
  telefono VARCHAR(40) NULL,
  direccion TEXT NULL,
  activo TINYINT NOT NULL DEFAULT 1,
  fecha DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_proveedor_scope (empresa_id, sede_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


CREATE TABLE servicio (
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
  KEY idx_servicio_scope (empresa_id, sede_id),
  CONSTRAINT fk_servicio_categoria FOREIGN KEY (categoria_id) REFERENCES categoria(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE producto (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  sede_id INT NOT NULL,
  categoria_id INT NOT NULL,
  codigo VARCHAR(80) NOT NULL,
  nombre VARCHAR(255) NOT NULL,
  descripcion TEXT NULL,
  garantia_info TEXT NULL,
  colores_disponibles TEXT NULL,
  video_url TEXT NULL,
  video_duracion_segundos DECIMAL(7,3) NULL,
  video_mime VARCHAR(80) NULL,
  costo DECIMAL(18,2) NOT NULL DEFAULT 0,
  precio DECIMAL(18,2) NOT NULL DEFAULT 0,
  precio_m DECIMAL(18,2) NULL,
  stock_minimo INT NOT NULL DEFAULT 0,
  activo TINYINT NOT NULL DEFAULT 1,
  codigo_barras VARCHAR(120) NOT NULL,
  fecha DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_producto_codigo_sede (sede_id, codigo),
  UNIQUE KEY uq_producto_barra_sede (sede_id, codigo_barras),
  KEY idx_producto_scope (empresa_id, sede_id),
  CONSTRAINT fk_producto_categoria FOREIGN KEY (categoria_id) REFERENCES categoria(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE producto_imagen (
  id INT AUTO_INCREMENT PRIMARY KEY,
  producto_id INT NOT NULL,
  url TEXT NOT NULL,
  alt VARCHAR(180) NULL,
  es_principal TINYINT NOT NULL DEFAULT 0,
  orden INT NOT NULL DEFAULT 0,
  fecha DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_producto_imagen_producto FOREIGN KEY (producto_id) REFERENCES producto(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE compra (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  sede_id INT NOT NULL,
  proveedor_id INT NOT NULL,
  usuario_id INT NOT NULL,
  subtotal DECIMAL(18,2) NOT NULL DEFAULT 0,
  total DECIMAL(18,2) NOT NULL DEFAULT 0,
  fecha DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  activo TINYINT NOT NULL DEFAULT 1,
  KEY idx_compra_scope_fecha (empresa_id, sede_id, fecha)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE compra_detalle (
  id INT AUTO_INCREMENT PRIMARY KEY,
  compra_id INT NOT NULL,
  producto_id INT NOT NULL,
  cantidad DECIMAL(18,2) NOT NULL,
  costo_unitario DECIMAL(18,2) NOT NULL,
  total_linea DECIMAL(18,2) NOT NULL,
  CONSTRAINT fk_compra_detalle_compra FOREIGN KEY (compra_id) REFERENCES compra(id) ON DELETE CASCADE,
  CONSTRAINT fk_compra_detalle_producto FOREIGN KEY (producto_id) REFERENCES producto(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE venta (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  sede_id INT NOT NULL,
  cliente_id INT NOT NULL,
  usuario_id INT NOT NULL,
  subtotal DECIMAL(18,2) NOT NULL DEFAULT 0,
  descuento DECIMAL(18,2) NOT NULL DEFAULT 0,
  impuesto DECIMAL(18,2) NOT NULL DEFAULT 0,
  total DECIMAL(18,2) NOT NULL DEFAULT 0,
  canal ENUM('WEB','APP','POS') NOT NULL DEFAULT 'POS',
  fecha DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  direccion_envio TEXT NULL,
  estado ENUM('EMITIDA','PAGADA','ANULADA') NOT NULL DEFAULT 'EMITIDA',
  activo TINYINT NOT NULL DEFAULT 1,
  pagado DECIMAL(18,2) NOT NULL DEFAULT 0,
  saldo DECIMAL(18,2) NOT NULL DEFAULT 0,
  fecha_anulacion DATETIME NULL,
  anulado_por INT NULL,
  motivo_anulacion TEXT NULL,
  KEY idx_venta_scope_fecha (empresa_id, sede_id, fecha),
  KEY idx_venta_estado (estado)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE venta_detalle (
  id INT AUTO_INCREMENT PRIMARY KEY,
  venta_id INT NOT NULL,
  item_tipo ENUM('PRODUCTO','SERVICIO') NOT NULL DEFAULT 'PRODUCTO',
  producto_id INT NULL,
  servicio_id INT NULL,
  nombre_item VARCHAR(255) NULL,
  codigo_item VARCHAR(80) NULL,
  cantidad DECIMAL(18,2) NOT NULL,
  precio_unitario DECIMAL(18,2) NOT NULL,
  descuento DECIMAL(18,2) NOT NULL DEFAULT 0,
  total_linea DECIMAL(18,2) NOT NULL,
  CONSTRAINT fk_venta_detalle_venta FOREIGN KEY (venta_id) REFERENCES venta(id) ON DELETE CASCADE,
  CONSTRAINT fk_venta_detalle_producto FOREIGN KEY (producto_id) REFERENCES producto(id),
  CONSTRAINT fk_venta_detalle_servicio FOREIGN KEY (servicio_id) REFERENCES servicio(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


CREATE TABLE devolucion_venta (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  sede_id INT NOT NULL,
  venta_id INT NOT NULL,
  usuario_id INT NOT NULL,
  motivo TEXT NULL,
  total_devuelto DECIMAL(18,2) NOT NULL DEFAULT 0,
  fecha DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  activo TINYINT NOT NULL DEFAULT 1,
  KEY idx_devolucion_scope_fecha (empresa_id, sede_id, fecha),
  CONSTRAINT fk_devolucion_venta FOREIGN KEY (venta_id) REFERENCES venta(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE devolucion_venta_detalle (
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
  CONSTRAINT fk_dvd_devolucion FOREIGN KEY (devolucion_id) REFERENCES devolucion_venta(id) ON DELETE CASCADE,
  CONSTRAINT fk_dvd_detalle FOREIGN KEY (venta_detalle_id) REFERENCES venta_detalle(id),
  CONSTRAINT fk_dvd_producto FOREIGN KEY (producto_id) REFERENCES producto(id),
  CONSTRAINT fk_dvd_servicio FOREIGN KEY (servicio_id) REFERENCES servicio(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE venta_pago (
  id INT AUTO_INCREMENT PRIMARY KEY,
  venta_id INT NOT NULL,
  metodo ENUM('EFECTIVO','TARJETA','TRANSFERENCIA','NEQUI','DAVIPLATA','BONO','OTRO','MIXTO') NOT NULL,
  entidad_transferencia ENUM('NEQUI','BANCOLOMBIA','DAVIPLATA','OTRO') NULL,
  monto DECIMAL(18,2) NOT NULL,
  recibido DECIMAL(18,2) NULL,
  cambio DECIMAL(18,2) NULL,
  referencia TEXT NULL,
  fecha DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  anulado TINYINT NOT NULL DEFAULT 0,
  fecha_anulacion DATETIME NULL,
  CONSTRAINT fk_venta_pago_venta FOREIGN KEY (venta_id) REFERENCES venta(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE inv_movimiento (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  sede_id INT NOT NULL,
  producto_id INT NOT NULL,
  usuario_id INT NOT NULL,
  tipo ENUM('IN_COMPRA','OUT_VENTA','IN_AJUSTE','OUT_AJUSTE','IN_DEV_VENTA','OUT_DEV_COMPRA') NOT NULL,
  compra_id INT NULL,
  venta_id INT NULL,
  cantidad DECIMAL(18,2) NOT NULL,
  costo_unitario DECIMAL(18,2) NOT NULL DEFAULT 0,
  comentario TEXT NULL,
  fecha DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  activo TINYINT NOT NULL DEFAULT 1,
  KEY idx_inv_producto_sede (producto_id, sede_id),
  KEY idx_inv_scope_fecha (empresa_id, sede_id, fecha)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


CREATE TABLE deduccion_concepto (
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

CREATE TABLE deduccion (
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

CREATE TABLE pedidos_web (
  id_pedido_web INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  sede_id INT NOT NULL,
  cliente_nombre VARCHAR(160) NOT NULL,
  cliente_telefono VARCHAR(40) NOT NULL,
  cliente_direccion VARCHAR(255) NOT NULL,
  cliente_barrio VARCHAR(120) NOT NULL,
  observacion TEXT NULL,
  subtotal DECIMAL(12,2) NOT NULL DEFAULT 0,
  total DECIMAL(12,2) NOT NULL DEFAULT 0,
  metodo_pago VARCHAR(40) NOT NULL DEFAULT 'CONTRA_ENTREGA',
  origen VARCHAR(30) NOT NULL DEFAULT 'WEB',
  estado VARCHAR(30) NOT NULL DEFAULT 'PENDIENTE',
  pagado TINYINT(1) NOT NULL DEFAULT 0,
  venta_id INT NULL,
  observacion_interna TEXT NULL,
  usuario_actualiza_id INT NULL,
  fecha_creacion DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  fecha_confirmacion DATETIME NULL,
  fecha_cancelacion DATETIME NULL,
  fecha_conversion DATETIME NULL,
  KEY idx_pedidos_scope_estado (empresa_id, sede_id, estado),
  KEY idx_pedidos_fecha (fecha_creacion)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE pedidos_web_detalle (
  id_pedido_web_detalle INT AUTO_INCREMENT PRIMARY KEY,
  pedido_web_id INT NOT NULL,
  producto_id INT NOT NULL,
  nombre_producto VARCHAR(180) NOT NULL,
  precio DECIMAL(12,2) NOT NULL DEFAULT 0,
  cantidad DECIMAL(12,2) NOT NULL DEFAULT 1,
  subtotal DECIMAL(12,2) NOT NULL DEFAULT 0,
  fecha_creacion DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_pedido_web_detalle_pedido FOREIGN KEY (pedido_web_id) REFERENCES pedidos_web(id_pedido_web) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE notificacion_config (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  sede_id INT NOT NULL,
  usuario_id INT NOT NULL,
  tipo VARCHAR(40) NOT NULL DEFAULT 'PEDIDO_WEB',
  activo TINYINT NOT NULL DEFAULT 1,
  fecha_creacion DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_notif (sede_id, usuario_id, tipo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO usuario_tipo(id,tipo,activo) VALUES (1,'ADMIN',1),(2,'VENDEDOR',1),(3,'GESTOR_WEB',1);
INSERT INTO empresa(id,nombre,nit,activo) VALUES (1,'Grupo Demo / Cliente','000000000',1);
INSERT INTO sede(id,empresa_id,nombre,razon_social,nit,codigo,direccion,telefono,correo,prefijo_factura,es_principal,activo) VALUES (1,1,'Negocio Principal','Negocio Principal S.A.S.','000000000-0','PRINCIPAL','Dirección principal','3000000000','admin@demo.com','NP',1,1);
INSERT INTO usuario(id,usuario_tipo_id,nombre,hash_password,email,activo) VALUES (1,1,'Administrador','$s256$0123456789ABCDEF0123456789ABCDEF$B00BDB3F47BE7BDE1183F94793126A7D9F29F46A24BB72352B55378CE773F428','admin@demo.com',1);
-- Password admin: admin123
INSERT INTO usuario_sede(usuario_id,sede_id,activo) VALUES (1,1,1);
INSERT INTO cliente(id,empresa_id,sede_id,nombre,documento,activo) VALUES (1,1,1,'Consumidor final','00000000',1);
INSERT INTO categoria(id,empresa_id,sede_id,nombre,descripcion,activo) VALUES (1,1,1,'General','Categoría inicial',1);
INSERT INTO notificacion_config(empresa_id,sede_id,usuario_id,tipo,activo) VALUES (1,1,1,'PEDIDO_WEB',1);
INSERT INTO deduccion_concepto(empresa_id,sede_id,nombre,tipo,activo) VALUES
(1,1,'Préstamo a empleado','PRESTAMO_EMPLEADO',1),
(1,1,'Préstamo entre sedes','PRESTAMO_SEDE',1),
(1,1,'Gasto operativo','GASTO',1);

