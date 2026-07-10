-- ============================================================================
-- ESQUEMA: ERP Panadería / Producción con inventario
-- Motor de arranque: SQLite. Está escrito para migrar a PostgreSQL con cambios
-- mínimos (ver notas "PG:" en cada tabla) cuando el negocio lo requiera.
-- ============================================================================

PRAGMA foreign_keys = ON;

-- ---------- USUARIOS Y ROLES ----------
-- PG: INTEGER PRIMARY KEY AUTOINCREMENT -> SERIAL PRIMARY KEY
CREATE TABLE IF NOT EXISTS roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL UNIQUE  -- 'admin' | 'operador' | 'lectura'
);
INSERT OR IGNORE INTO roles (id, nombre) VALUES (1, 'admin'), (2, 'operador'), (3, 'lectura');

CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  rol_id INTEGER NOT NULL REFERENCES roles(id),
  activo INTEGER NOT NULL DEFAULT 1,  -- PG: BOOLEAN
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------- PERIODOS (CIERRE CONTABLE) ----------
-- Una vez cerrado un periodo, ninguna transacción con fecha dentro de él
-- puede editarse ni borrarse: solo se permite una reversión/ajuste nuevo
-- fechado en un periodo abierto. Esto es lo que evita que el historial
-- "se mueva" después de que ya tomaste decisiones (precios, impuestos, etc).
CREATE TABLE IF NOT EXISTS periodos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  anio INTEGER NOT NULL,
  mes INTEGER NOT NULL, -- 1-12
  estado TEXT NOT NULL DEFAULT 'abierto', -- 'abierto' | 'cerrado'
  cerrado_por INTEGER REFERENCES usuarios(id),
  cerrado_en TEXT,
  UNIQUE(anio, mes)
);

-- ---------- PROVEEDORES ----------
CREATE TABLE IF NOT EXISTS proveedores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  contacto TEXT,
  telefono TEXT,
  email TEXT,
  notas TEXT,
  activo INTEGER NOT NULL DEFAULT 1,
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------- INGREDIENTES ----------
CREATE TABLE IF NOT EXISTS ingredientes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  unidad_base TEXT NOT NULL,       -- g, kg, ml, l, unidad, lb, oz (ver families.js)
  stock_minimo REAL NOT NULL DEFAULT 0 CHECK (stock_minimo >= 0),
  dias_cobertura_deseados INTEGER NOT NULL DEFAULT 7 CHECK (dias_cobertura_deseados > 0), -- para sugerencias de compra
  activo INTEGER NOT NULL DEFAULT 1,
  creado_en TEXT NOT NULL DEFAULT (datetime('now')),
  actualizado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------- LOTES DE COMPRA (FIFO + vencimiento) ----------
CREATE TABLE IF NOT EXISTS lotes_compra (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ingrediente_id INTEGER NOT NULL REFERENCES ingredientes(id),
  proveedor_id INTEGER REFERENCES proveedores(id),
  periodo_id INTEGER NOT NULL REFERENCES periodos(id),
  fecha_compra TEXT NOT NULL,
  fecha_vencimiento TEXT,  -- NULL si no aplica
  presentacion TEXT,
  cantidad_comprada REAL NOT NULL CHECK (cantidad_comprada > 0),
  unidad_compra TEXT NOT NULL,
  contenido_por_presentacion REAL NOT NULL CHECK (contenido_por_presentacion > 0),
  cantidad_total_base REAL NOT NULL CHECK (cantidad_total_base > 0),   -- ya convertida a unidad_base del ingrediente
  cantidad_restante REAL NOT NULL CHECK (cantidad_restante >= 0),
  costo_total REAL NOT NULL CHECK (costo_total >= 0),
  costo_unidad_base REAL NOT NULL CHECK (costo_unidad_base >= 0),     -- costo_total / cantidad_total_base
  anulado INTEGER NOT NULL DEFAULT 0,  -- reversión lógica, nunca se borra un lote con historial
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_lotes_ingrediente ON lotes_compra(ingrediente_id);
CREATE INDEX IF NOT EXISTS idx_lotes_vencimiento ON lotes_compra(fecha_vencimiento);
-- Índice parcial: acelera lotesDisponibles() (fifo.js), que siempre filtra
-- por estas tres condiciones juntas en cada consumo/producción/ajuste.
CREATE INDEX IF NOT EXISTS idx_lotes_disponibles ON lotes_compra(ingrediente_id, fecha_vencimiento, fecha_compra)
  WHERE cantidad_restante > 0 AND anulado = 0;

-- ---------- BITÁCORA DE MOVIMIENTOS DE INVENTARIO (append-only, auditoría) ----------
-- Cada compra, consumo de producción, ajuste o reversión genera EXACTAMENTE
-- una fila aquí. Esta tabla nunca se actualiza ni se borra: es la fuente de
-- verdad de "qué pasó, cuándo, quién lo hizo y por qué".
CREATE TABLE IF NOT EXISTS movimientos_inventario (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ingrediente_id INTEGER NOT NULL REFERENCES ingredientes(id),
  tipo TEXT NOT NULL, -- 'compra' | 'consumo_produccion' | 'merma' | 'uso_externo' | 'conteo_sobra' | 'reversion'
  cantidad_base REAL NOT NULL CHECK (cantidad_base != 0),   -- positivo = entra, negativo = sale
  costo_unidad_base REAL NOT NULL CHECK (costo_unidad_base >= 0),
  referencia_tipo TEXT,          -- 'lote_compra' | 'produccion' | 'ajuste'
  referencia_id INTEGER,
  motivo TEXT,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  fecha TEXT NOT NULL,           -- fecha "de negocio" del evento
  periodo_id INTEGER NOT NULL REFERENCES periodos(id),
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_mov_ingrediente ON movimientos_inventario(ingrediente_id);
CREATE INDEX IF NOT EXISTS idx_mov_fecha ON movimientos_inventario(fecha);
-- Índice compuesto: rotacion() y consumoDiarioPromedio() (sugerencias.js)
-- siempre filtran por ingrediente_id Y fecha a la vez.
CREATE INDEX IF NOT EXISTS idx_mov_ingrediente_fecha ON movimientos_inventario(ingrediente_id, fecha);

-- ---------- CONFIGURACIÓN DE COSTOS INDIRECTOS Y MANO DE OBRA ----------
CREATE TABLE IF NOT EXISTS config_costos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,             -- ej. 'Gas horno', 'Empaque', 'Electricidad'
  tipo TEXT NOT NULL CHECK (tipo IN ('por_tanda', 'por_unidad', 'mensual_prorrateado')),
  valor REAL NOT NULL CHECK (valor >= 0),              -- costo en $ según el tipo (si es mensual, es el total del mes)
  unidades_estimadas_mes REAL CHECK (unidades_estimadas_mes IS NULL OR unidades_estimadas_mes > 0),      -- solo para 'mensual_prorrateado': unidades que esperas producir al mes
  activo INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS config_mano_obra (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL DEFAULT 'Costo por hora estándar',
  costo_por_hora REAL NOT NULL CHECK (costo_por_hora > 0),
  activo INTEGER NOT NULL DEFAULT 1
);

-- ---------- RECETAS (versionadas: editar crea versión nueva, no reescribe historia) ----------
CREATE TABLE IF NOT EXISTS recetas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  grupo_id INTEGER NOT NULL,   -- agrupa todas las versiones de "la misma receta"
  version INTEGER NOT NULL DEFAULT 1,
  nombre_producto TEXT NOT NULL,
  rendimiento REAL NOT NULL CHECK (rendimiento > 0),
  minutos_mano_obra REAL NOT NULL DEFAULT 0 CHECK (minutos_mano_obra >= 0),
  vigente INTEGER NOT NULL DEFAULT 1, -- solo una versión vigente por grupo_id
  activo INTEGER NOT NULL DEFAULT 1,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_recetas_grupo ON recetas(grupo_id);

CREATE TABLE IF NOT EXISTS receta_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  receta_id INTEGER NOT NULL REFERENCES recetas(id),
  ingrediente_id INTEGER NOT NULL REFERENCES ingredientes(id),
  cantidad_base REAL NOT NULL CHECK (cantidad_base > 0)
);
CREATE INDEX IF NOT EXISTS idx_receta_items_receta ON receta_items(receta_id);

-- ---------- PRODUCCIÓN ----------
CREATE TABLE IF NOT EXISTS producciones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  receta_id INTEGER NOT NULL REFERENCES recetas(id), -- referencia la versión exacta usada
  periodo_id INTEGER NOT NULL REFERENCES periodos(id),
  tandas REAL NOT NULL CHECK (tandas > 0),
  unidades_producidas REAL NOT NULL CHECK (unidades_producidas > 0),
  costo_materia_prima REAL NOT NULL CHECK (costo_materia_prima >= 0),
  costo_mano_obra REAL NOT NULL CHECK (costo_mano_obra >= 0),
  costo_indirectos REAL NOT NULL CHECK (costo_indirectos >= 0),
  costo_total REAL NOT NULL CHECK (costo_total >= 0),
  costo_unidad REAL NOT NULL CHECK (costo_unidad >= 0),
  fecha TEXT NOT NULL,
  anulado INTEGER NOT NULL DEFAULT 0,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_producciones_receta ON producciones(receta_id);
CREATE INDEX IF NOT EXISTS idx_producciones_fecha ON producciones(fecha);

-- ---------- MERMAS DE PRODUCTO TERMINADO ----------
CREATE TABLE IF NOT EXISTS mermas_producto (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  produccion_id INTEGER REFERENCES producciones(id), -- opcional: de qué tanda salió
  grupo_receta_id INTEGER NOT NULL,                   -- para poder mermar aunque cambie de versión
  cantidad REAL NOT NULL,
  motivo TEXT NOT NULL,
  fecha TEXT NOT NULL,
  periodo_id INTEGER NOT NULL REFERENCES periodos(id),
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------- AUDITORÍA GENERAL (ediciones que no mueven stock: nombre, config, etc.) ----------
CREATE TABLE IF NOT EXISTS log_auditoria (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  entidad TEXT NOT NULL,      -- 'ingrediente' | 'receta' | 'proveedor' | 'usuario' | ...
  entidad_id INTEGER NOT NULL,
  accion TEXT NOT NULL,       -- 'crear' | 'editar' | 'desactivar'
  datos_antes TEXT,           -- JSON
  datos_despues TEXT,         -- JSON
  fecha TEXT NOT NULL DEFAULT (datetime('now'))
);
-- ============================================================
-- MÓDULO DE VENTAS
-- ============================================================

CREATE TABLE IF NOT EXISTS productos_venta (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  receta_grupo_id INTEGER NOT NULL UNIQUE,
  precio_normal REAL NOT NULL CHECK (precio_normal >= 0),
  precio_mayorista REAL NOT NULL CHECK (precio_mayorista >= 0),
  activo INTEGER NOT NULL DEFAULT 1,
  usuario_id INTEGER NOT NULL,
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS clientes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('minorista', 'mayorista')) DEFAULT 'minorista',
  activo INTEGER NOT NULL DEFAULT 1,
  usuario_id INTEGER NOT NULL,
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ventas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  folio INTEGER NOT NULL UNIQUE,
  fecha TEXT NOT NULL,
  cliente_id INTEGER NOT NULL REFERENCES clientes(id),
  periodo_id INTEGER NOT NULL REFERENCES periodos(id),
  subtotal REAL NOT NULL,
  total REAL NOT NULL,
  anulado INTEGER NOT NULL DEFAULT 0,
  usuario_id INTEGER NOT NULL,
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS venta_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  venta_id INTEGER NOT NULL REFERENCES ventas(id),
  receta_grupo_id INTEGER NOT NULL,
  nombre_producto TEXT NOT NULL,
  cantidad REAL NOT NULL CHECK (cantidad > 0),
  precio_unitario REAL NOT NULL CHECK (precio_unitario >= 0),
  subtotal REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS pagos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  venta_id INTEGER NOT NULL REFERENCES ventas(id),
  monto REAL NOT NULL CHECK (monto > 0),
  metodo_pago TEXT NOT NULL CHECK (
    metodo_pago IN ('Efectivo','Yape','Transferencia','Tarjeta')
  ),
  fecha TEXT NOT NULL,
  usuario_id INTEGER NOT NULL,
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);
-- ============================================================
-- M�DULO DE CAJA
-- ============================================================

CREATE TABLE IF NOT EXISTS cajas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  activo INTEGER NOT NULL DEFAULT 1,
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS turnos_caja (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  caja_id INTEGER NOT NULL REFERENCES cajas(id),
  estado TEXT NOT NULL DEFAULT 'abierto',
  monto_apertura REAL NOT NULL CHECK (monto_apertura >= 0),
  monto_cierre_esperado REAL,
  monto_cierre_contado REAL,
  diferencia REAL,
  notas_apertura TEXT,
  notas_cierre TEXT,
  usuario_apertura_id INTEGER NOT NULL REFERENCES usuarios(id),
  usuario_cierre_id INTEGER REFERENCES usuarios(id),
  fecha_apertura TEXT NOT NULL DEFAULT (datetime('now')),
  fecha_cierre TEXT
);

CREATE INDEX IF NOT EXISTS idx_turnos_caja_caja ON turnos_caja(caja_id);
CREATE INDEX IF NOT EXISTS idx_turnos_caja_fecha ON turnos_caja(fecha_apertura);

CREATE UNIQUE INDEX IF NOT EXISTS idx_turno_abierto_unico
ON turnos_caja(caja_id)
WHERE estado = 'abierto';

CREATE TABLE IF NOT EXISTS movimientos_caja (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  turno_id INTEGER NOT NULL REFERENCES turnos_caja(id),
  tipo TEXT NOT NULL,
  metodo_pago TEXT,
  monto REAL NOT NULL,
  motivo TEXT,
  referencia_tipo TEXT,
  referencia_id INTEGER,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  fecha TEXT NOT NULL DEFAULT (datetime('now')),
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_mov_caja_turno ON movimientos_caja(turno_id);
CREATE INDEX IF NOT EXISTS idx_mov_caja_fecha ON movimientos_caja(fecha);
CREATE INDEX IF NOT EXISTS idx_mov_caja_referencia
ON movimientos_caja(referencia_tipo, referencia_id);

