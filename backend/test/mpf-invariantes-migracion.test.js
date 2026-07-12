const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");
const { COLUMNAS, migrarInvariantesMpf, requiereMigracionMpf } = require("../src/migrations/mpf-invariantes");
const { requiereMigracion: requiereEventos } = require("../src/migrations/fin-eventos-caja");

function baseFresca() {
  const db = new Database(":memory:"); db.pragma("foreign_keys = ON");
  db.exec(fs.readFileSync(path.join(__dirname, "..", "schema.sql"), "utf8"));
  db.exec(fs.readFileSync(path.join(__dirname, "..", "finanzas-schema.sql"), "utf8"));
  return db;
}

function baseAntigua() {
  const db = new Database(":memory:"); db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE usuarios(id INTEGER PRIMARY KEY); CREATE TABLE fin_entidades_economicas(id INTEGER PRIMARY KEY);
    CREATE TABLE fin_bolsillos(id INTEGER PRIMARY KEY); CREATE TABLE fin_eventos_financieros(id INTEGER PRIMARY KEY);
    CREATE TABLE mpf_metas_financieras(id INTEGER PRIMARY KEY);
    INSERT INTO usuarios VALUES(1); INSERT INTO fin_entidades_economicas VALUES(1); INSERT INTO fin_bolsillos VALUES(1); INSERT INTO fin_eventos_financieros VALUES(1);
    CREATE TABLE mpf_politicas(id INTEGER PRIMARY KEY AUTOINCREMENT,entidad_id INTEGER NOT NULL REFERENCES fin_entidades_economicas(id),nombre TEXT NOT NULL,evento_tipo TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,estado TEXT NOT NULL DEFAULT 'borrador',es_predeterminada INTEGER NOT NULL DEFAULT 0,creado_por INTEGER NOT NULL REFERENCES usuarios(id),creado_en TEXT NOT NULL DEFAULT(datetime('now')),UNIQUE(entidad_id,nombre,version));
    CREATE UNIQUE INDEX idx_mpf_politica_predeterminada ON mpf_politicas(entidad_id,evento_tipo) WHERE estado='activa' AND es_predeterminada=1;
    CREATE TABLE mpf_reglas(id INTEGER PRIMARY KEY AUTOINCREMENT,politica_id INTEGER NOT NULL REFERENCES mpf_politicas(id),orden INTEGER NOT NULL,nombre TEXT NOT NULL,base TEXT NOT NULL,tipo TEXT NOT NULL,valor_minor INTEGER NOT NULL,bolsillo_id INTEGER NOT NULL REFERENCES fin_bolsillos(id),UNIQUE(politica_id,orden));
    CREATE TABLE mpf_aplicaciones(id INTEGER PRIMARY KEY AUTOINCREMENT,entidad_id INTEGER NOT NULL REFERENCES fin_entidades_economicas(id),evento_financiero_id INTEGER NOT NULL UNIQUE REFERENCES fin_eventos_financieros(id),politica_id INTEGER NOT NULL REFERENCES mpf_politicas(id),politica_version INTEGER NOT NULL,importe_ingreso_minor INTEGER NOT NULL,importe_distribuido_minor INTEGER NOT NULL,creado_en TEXT NOT NULL DEFAULT(datetime('now')));
    CREATE TABLE mpf_detalles_aplicacion(id INTEGER PRIMARY KEY AUTOINCREMENT,aplicacion_id INTEGER NOT NULL REFERENCES mpf_aplicaciones(id),regla_id INTEGER NOT NULL REFERENCES mpf_reglas(id),bolsillo_id INTEGER NOT NULL REFERENCES fin_bolsillos(id),importe_minor INTEGER NOT NULL);
    INSERT INTO mpf_politicas(id,entidad_id,nombre,evento_tipo,creado_por)VALUES(7,1,'Legacy','cobro_venta',1);
    INSERT INTO mpf_reglas(id,politica_id,orden,nombre,base,tipo,valor_minor,bolsillo_id)VALUES(8,7,1,'Regla','ingreso','porcentaje',1000,1);
    INSERT INTO mpf_aplicaciones(id,entidad_id,evento_financiero_id,politica_id,politica_version,importe_ingreso_minor,importe_distribuido_minor)VALUES(9,1,1,7,1,1000,100);
    INSERT INTO mpf_detalles_aplicacion(id,aplicacion_id,regla_id,bolsillo_id,importe_minor)VALUES(10,9,8,1,100);
  `);
  return db;
}

function estructura(db, tabla) {
  return {
    columnas: db.prepare(`PRAGMA table_info(${tabla})`).all().map(({ name, type, notnull, dflt_value, pk }) => ({ name, type, notnull, dflt_value, pk })),
    fks: db.prepare(`PRAGMA foreign_key_list(${tabla})`).all().map(({ table, from, to, on_update, on_delete }) => ({ table, from, to, on_update, on_delete })).sort((a, b) => a.from.localeCompare(b.from)),
    indices: db.prepare(`PRAGMA index_list(${tabla})`).all().map(({ unique, origin, partial }) => ({ unique, origin, partial })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  };
}

test("base fresca y base antigua migrada terminan con invariantes MPF equivalentes", () => {
  const fresca = baseFresca(); const antigua = baseAntigua();
  assert.equal(requiereMigracionMpf(fresca), false);
  assert.equal(requiereEventos(fresca), false);
  assert.equal(migrarInvariantesMpf(antigua), true);
  assert.equal(migrarInvariantesMpf(antigua), false);
  for (const tabla of Object.keys(COLUMNAS)) assert.deepEqual(estructura(antigua, tabla), estructura(fresca, tabla), tabla);
  assert.deepEqual(antigua.prepare("SELECT id,recupera_costo,bolsillo_costo_id FROM mpf_politicas").get(), { id: 7, recupera_costo: 0, bolsillo_costo_id: null });
  assert.deepEqual(antigua.prepare("SELECT id,condicion_json,accion FROM mpf_reglas").get(), { id: 8, condicion_json: "{}", accion: "aplicar" });
  assert.equal(antigua.prepare("SELECT costo_recuperado_minor FROM mpf_aplicaciones WHERE id=9").get().costo_recuperado_minor, 0);
  assert.equal(antigua.pragma("foreign_key_check").length, 0);
  assert.equal(fresca.pragma("foreign_key_check").length, 0);
  fresca.close(); antigua.close();
});
