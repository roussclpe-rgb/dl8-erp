const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "..", "data.sqlite");
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

const schema = fs.readFileSync(path.join(__dirname, "..", "schema.sql"), "utf8");
db.exec(schema);

try {
  require("./migrations/pagos-cxc-compat").prepararCompatibilidadPagosCxC(db);
  require("./migrations/cuentas-financieras-proveedor").migrarProveedorCuentaFinanciera(db);
  require("./migrations/cxc-estados-reversion").migrarEstadosReversionCxc(db);
  const esquemaFinanzas = fs.readFileSync(path.join(__dirname, "..", "finanzas-schema.sql"), "utf8");
  db.exec(esquemaFinanzas);
  require("./migrations/fin-eventos-caja").migrarTiposEventosCaja(db);
  require("./migrations/cxc-saldos-iniciales").migrarSaldosInicialesCxC(db);
  require("./migrations/mpf-invariantes").migrarInvariantesMpf(db);
} catch (e) {
  db.close();
  throw new Error("No se pudo cargar el esquema financiero. Revisa backend/finanzas-schema.sql.");
}

function columnaExiste(tabla, columna) {
  return db.prepare(`PRAGMA table_info(${tabla})`).all().some((c) => c.name === columna);
}

if (!columnaExiste("ventas", "descuento_tipo")) {
  db.exec("ALTER TABLE ventas ADD COLUMN descuento_tipo TEXT");
}
if (!columnaExiste("lotes_compra", "entidad_id")) {
  db.exec("ALTER TABLE lotes_compra ADD COLUMN entidad_id INTEGER REFERENCES fin_entidades_economicas(id)");
}
if (!columnaExiste("ventas", "descuento_valor")) {
  db.exec("ALTER TABLE ventas ADD COLUMN descuento_valor REAL DEFAULT 0");
}
for (const columna of ["calorias_por_100", "proteinas_por_100", "carbohidratos_por_100", "grasas_por_100", "fibra_por_100", "sodio_por_100"]) {
  if (!columnaExiste("ingredientes", columna)) {
    db.exec(`ALTER TABLE ingredientes ADD COLUMN ${columna} REAL NOT NULL DEFAULT 0 CHECK(${columna} >= 0)`);
  }
}
if (!columnaExiste("cajas", "entidad_id")) {
  db.exec("ALTER TABLE cajas ADD COLUMN entidad_id INTEGER REFERENCES fin_entidades_economicas(id)");
}
if (!columnaExiste("cajas", "cuenta_financiera_id")) {
  db.exec("ALTER TABLE cajas ADD COLUMN cuenta_financiera_id INTEGER REFERENCES fin_cuentas_financieras(id)");
}
if (!columnaExiste("fin_aplicaciones_cxc", "cobro_id")) {
  db.exec("ALTER TABLE fin_aplicaciones_cxc ADD COLUMN cobro_id INTEGER REFERENCES fin_cobros(id)");
}
for (const [columna, definicion] of [["cumplida_en", "TEXT"], ["cumplida_evento_financiero_id", "INTEGER REFERENCES fin_eventos_financieros(id)"], ["cumplida_por", "INTEGER REFERENCES usuarios(id)"]]) {
  if (!columnaExiste("mpf_metas_financieras", columna)) db.exec(`ALTER TABLE mpf_metas_financieras ADD COLUMN ${columna} ${definicion}`);
}
for (const [tabla, columna, definicion] of [["mpf_politicas", "activada_en", "TEXT"], ["mpf_aplicaciones", "politica_snapshot_json", "TEXT NOT NULL DEFAULT '{}'"]]) {
  if (!columnaExiste(tabla, columna)) db.exec(`ALTER TABLE ${tabla} ADD COLUMN ${columna} ${definicion}`);
}
for (const [columna, definicion] of [["tipo", "TEXT NOT NULL DEFAULT 'unica'"], ["frecuencia_recurrencia", "TEXT"], ["meta_origen_id", "INTEGER REFERENCES mpf_metas_financieras(id)"], ["saldo_inicial_minor", "INTEGER NOT NULL DEFAULT 0"]]) {
  if (!columnaExiste("mpf_metas_financieras", columna)) db.exec(`ALTER TABLE mpf_metas_financieras ADD COLUMN ${columna} ${definicion}`);
}
for (const [columna, definicion] of [["descripcion", "TEXT"], ["prioridad", "INTEGER NOT NULL DEFAULT 0"], ["saldo_minimo_minor", "INTEGER NOT NULL DEFAULT 0"]]) {
  if (!columnaExiste("fin_bolsillos", columna)) db.exec(`ALTER TABLE fin_bolsillos ADD COLUMN ${columna} ${definicion}`);
}
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_pagos_cobro_unico ON pagos(cobro_id) WHERE cobro_id IS NOT NULL");
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_pagos_aplicacion_unica ON pagos(aplicacion_cxc_id) WHERE aplicacion_cxc_id IS NOT NULL");
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_aplicacion_cobro_unico ON fin_aplicaciones_cxc(cobro_id) WHERE cobro_id IS NOT NULL");
db.exec(`
  CREATE TABLE IF NOT EXISTS pagos_claves_idempotencia (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    venta_id INTEGER NOT NULL REFERENCES ventas(id),
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
    clave TEXT NOT NULL,
    hash_payload TEXT NOT NULL,
    respuesta_json TEXT NOT NULL,
    creado_en TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(usuario_id, clave)
  )
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS ventas_claves_idempotencia (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
    clave TEXT NOT NULL,
    hash_payload TEXT NOT NULL,
    respuesta_json TEXT NOT NULL,
    creado_en TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(usuario_id, clave)
  )
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS compras_claves_idempotencia (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
    clave TEXT NOT NULL,
    hash_payload TEXT NOT NULL,
    respuesta_json TEXT NOT NULL,
    creado_en TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(usuario_id, clave)
  )
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS pagos_cxp_claves_idempotencia (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
    clave TEXT NOT NULL,
    hash_payload TEXT NOT NULL,
    respuesta_json TEXT NOT NULL,
    creado_en TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(usuario_id, clave)
  )
`);
db.exec(`CREATE TABLE IF NOT EXISTS correcciones_cxp_claves_idempotencia (
  id INTEGER PRIMARY KEY AUTOINCREMENT, usuario_id INTEGER NOT NULL REFERENCES usuarios(id), clave TEXT NOT NULL,
  hash_payload TEXT NOT NULL, respuesta_json TEXT NOT NULL, creado_en TEXT NOT NULL DEFAULT(datetime('now')), UNIQUE(usuario_id,clave)
)`);
db.exec(`CREATE TABLE IF NOT EXISTS movimientos_manuales_claves_idempotencia (
  id INTEGER PRIMARY KEY AUTOINCREMENT, usuario_id INTEGER NOT NULL REFERENCES usuarios(id), clave TEXT NOT NULL,
  hash_payload TEXT NOT NULL, respuesta_json TEXT NOT NULL, creado_en TEXT NOT NULL DEFAULT(datetime('now')), UNIQUE(usuario_id,clave)
)`);
require("./migrations/venta-item-costos").migrarVentaItemCostos(db);
db.exec(`CREATE TABLE IF NOT EXISTS mpf_politica_costos_fijos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  politica_id INTEGER NOT NULL REFERENCES mpf_politicas(id) ON DELETE CASCADE,
  receta_grupo_id INTEGER NOT NULL,
  costo_unidad_minor INTEGER NOT NULL CHECK(costo_unidad_minor>=0),
  moneda TEXT NOT NULL DEFAULT 'PEN',
  UNIQUE(politica_id, receta_grupo_id)
); CREATE INDEX IF NOT EXISTS idx_mpf_costos_fijos_politica ON mpf_politica_costos_fijos(politica_id);`);
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_cajas_cuenta_financiera_activa ON cajas(cuenta_financiera_id) WHERE activo = 1 AND cuenta_financiera_id IS NOT NULL");
for (const [columna, definicion] of [["entidad_id", "INTEGER REFERENCES fin_entidades_economicas(id)"], ["producto_id", "INTEGER"], ["vendedor_id", "INTEGER REFERENCES usuarios(id)"], ["canal_venta", "TEXT"]]) {
  if (!columnaExiste("objetivos_negocio", columna)) db.exec(`ALTER TABLE objetivos_negocio ADD COLUMN ${columna} ${definicion}`);
}
db.exec(`
  CREATE TRIGGER IF NOT EXISTS trg_cajas_cuenta_financiera_insert
  BEFORE INSERT ON cajas WHEN NEW.cuenta_financiera_id IS NOT NULL
  BEGIN
    SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM fin_cuentas_financieras WHERE id=NEW.cuenta_financiera_id AND entidad_id=NEW.entidad_id AND tipo='caja' AND estado='activa') THEN RAISE(ABORT,'La cuenta financiera de Caja debe ser una caja activa de la entidad') END;
  END;
  CREATE TRIGGER IF NOT EXISTS trg_cajas_cuenta_financiera_update
  BEFORE UPDATE OF entidad_id, cuenta_financiera_id ON cajas WHEN NEW.cuenta_financiera_id IS NOT NULL
  BEGIN
    SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM fin_cuentas_financieras WHERE id=NEW.cuenta_financiera_id AND entidad_id=NEW.entidad_id AND tipo='caja' AND estado='activa') THEN RAISE(ABORT,'La cuenta financiera de Caja debe ser una caja activa de la entidad') END;
  END;
`);

// Asegura que exista el periodo del mes actual (u otro, según fecha) abierto.
function obtenerOCrearPeriodo(fechaISO) {
  const [anio, mes] = fechaISO.slice(0, 7).split("-").map(Number);
  let periodo = db.prepare("SELECT * FROM periodos WHERE anio = ? AND mes = ?").get(anio, mes);
  if (!periodo) {
    const info = db.prepare("INSERT INTO periodos (anio, mes, estado) VALUES (?, ?, 'abierto')").run(anio, mes);
    periodo = db.prepare("SELECT * FROM periodos WHERE id = ?").get(info.lastInsertRowid);
  }
  return periodo;
}

function periodoEstaAbierto(periodo) {
  return periodo.estado === "abierto";
}

module.exports = { db, obtenerOCrearPeriodo, periodoEstaAbierto };
