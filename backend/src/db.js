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
  const esquemaFinanzas = fs.readFileSync(path.join(__dirname, "..", "finanzas-schema.sql"), "utf8");
  db.exec(esquemaFinanzas);
  require("./migrations/fin-eventos-caja").migrarTiposEventosCaja(db);
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
if (!columnaExiste("cajas", "entidad_id")) {
  db.exec("ALTER TABLE cajas ADD COLUMN entidad_id INTEGER REFERENCES fin_entidades_economicas(id)");
}
if (!columnaExiste("cajas", "cuenta_financiera_id")) {
  db.exec("ALTER TABLE cajas ADD COLUMN cuenta_financiera_id INTEGER REFERENCES fin_cuentas_financieras(id)");
}
if (!columnaExiste("fin_aplicaciones_cxc", "cobro_id")) {
  db.exec("ALTER TABLE fin_aplicaciones_cxc ADD COLUMN cobro_id INTEGER REFERENCES fin_cobros(id)");
}
if (!columnaExiste("mpf_politicas", "recupera_costo")) db.exec("ALTER TABLE mpf_politicas ADD COLUMN recupera_costo INTEGER NOT NULL DEFAULT 0");
if (!columnaExiste("mpf_politicas", "bolsillo_costo_id")) db.exec("ALTER TABLE mpf_politicas ADD COLUMN bolsillo_costo_id INTEGER REFERENCES fin_bolsillos(id)");
if (!columnaExiste("mpf_aplicaciones", "costo_recuperado_minor")) db.exec("ALTER TABLE mpf_aplicaciones ADD COLUMN costo_recuperado_minor INTEGER NOT NULL DEFAULT 0");
if (!columnaExiste("mpf_reglas", "meta_id")) db.exec("ALTER TABLE mpf_reglas ADD COLUMN meta_id INTEGER REFERENCES mpf_metas_financieras(id)");
if (!columnaExiste("mpf_reglas", "condicion_json")) db.exec("ALTER TABLE mpf_reglas ADD COLUMN condicion_json TEXT NOT NULL DEFAULT '{}'");
if (!columnaExiste("mpf_reglas", "accion")) db.exec("ALTER TABLE mpf_reglas ADD COLUMN accion TEXT NOT NULL DEFAULT 'aplicar'");
if (!columnaExiste("mpf_reglas", "bolsillo_destino_id")) db.exec("ALTER TABLE mpf_reglas ADD COLUMN bolsillo_destino_id INTEGER REFERENCES fin_bolsillos(id)");
if (!columnaExiste("mpf_reglas", "meta_destino_id")) db.exec("ALTER TABLE mpf_reglas ADD COLUMN meta_destino_id INTEGER REFERENCES mpf_metas_financieras(id)");
if (!columnaExiste("mpf_detalles_aplicacion", "condicion_evaluada_json")) db.exec("ALTER TABLE mpf_detalles_aplicacion ADD COLUMN condicion_evaluada_json TEXT NOT NULL DEFAULT '{}'");
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
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_cajas_cuenta_financiera_activa ON cajas(cuenta_financiera_id) WHERE activo = 1 AND cuenta_financiera_id IS NOT NULL");
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
