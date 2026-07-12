const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const { prepararCompatibilidadPagosCxC } = require("../src/migrations/pagos-cxc-compat");

function baseHistorica() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys=ON");
  db.exec(`CREATE TABLE ventas(id INTEGER PRIMARY KEY);
    CREATE TABLE pagos(id INTEGER PRIMARY KEY,venta_id INTEGER NOT NULL REFERENCES ventas(id),monto REAL NOT NULL,metodo_pago TEXT NOT NULL,fecha TEXT NOT NULL,usuario_id INTEGER NOT NULL);
    CREATE TRIGGER trg_pagos_cxc_no_update BEFORE UPDATE ON pagos WHEN OLD.cobro_id IS NOT NULL BEGIN SELECT RAISE(ABORT,'inmutable'); END;
    CREATE TRIGGER trg_pagos_cxc_no_delete BEFORE DELETE ON pagos WHEN OLD.cobro_id IS NOT NULL BEGIN SELECT RAISE(ABORT,'inmutable'); END;`);
  return db;
}

test("compatibilidad agrega columnas de pagos y recrea solo los triggers CxC de una base histórica", () => {
  const db = baseHistorica();
  assert.equal(prepararCompatibilidadPagosCxC(db), true);
  assert.deepEqual(db.prepare("PRAGMA table_info(pagos)").all().map((columna) => columna.name).slice(-3), ["evento_financiero_id", "cobro_id", "aplicacion_cxc_id"]);
  assert.equal(db.prepare("SELECT 1 FROM sqlite_master WHERE type='trigger' AND name='trg_pagos_cxc_no_update'").get(), undefined);
  assert.equal(db.prepare("SELECT 1 FROM sqlite_master WHERE type='trigger' AND name='trg_pagos_cxc_no_delete'").get(), undefined);
  assert.equal(prepararCompatibilidadPagosCxC(db), false);
  db.close();
});
