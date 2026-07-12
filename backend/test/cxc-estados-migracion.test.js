const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const { migrarEstadosReversionCxc } = require("../src/migrations/cxc-estados-reversion");

test("la migración CxC permite solo transiciones auditables y es idempotente", () => {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE fin_cobros(id INTEGER PRIMARY KEY,entidad_id INTEGER,pago_id INTEGER,documento_cxc_id INTEGER,evento_financiero_id INTEGER,cuenta_financiera_id INTEGER,bolsillo_id INTEGER,turno_caja_id INTEGER,metodo_pago TEXT,importe_minor INTEGER,fecha TEXT,estado TEXT,creado_por INTEGER,creado_en TEXT);
    CREATE TABLE fin_aplicaciones_cxc(id INTEGER PRIMARY KEY,documento_cxc_id INTEGER,cobro_id INTEGER,evento_financiero_id INTEGER,importe_minor INTEGER,fecha_aplicacion TEXT,estado TEXT,creado_por INTEGER,creado_en TEXT);
    INSERT INTO fin_cobros VALUES(1,1,1,1,1,1,1,NULL,'Yape',100,'2026-07-01','confirmado',1,'2026-07-01');
    INSERT INTO fin_aplicaciones_cxc VALUES(1,1,1,1,100,'2026-07-01','confirmada',1,'2026-07-01');
  `);
  assert.equal(migrarEstadosReversionCxc(db), true);
  assert.equal(migrarEstadosReversionCxc(db), true);
  db.prepare("UPDATE fin_aplicaciones_cxc SET estado='revertida' WHERE id=1").run();
  db.prepare("UPDATE fin_cobros SET estado='revertido' WHERE id=1").run();
  assert.throws(() => db.prepare("UPDATE fin_cobros SET estado='confirmado' WHERE id=1").run(), /única transición/);
  assert.throws(() => db.prepare("UPDATE fin_aplicaciones_cxc SET importe_minor=99 WHERE id=1").run(), /inmutables/);
  db.close();
});
