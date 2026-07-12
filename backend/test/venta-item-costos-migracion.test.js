const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { migrarVentaItemCostos } = require('../src/migrations/venta-item-costos');

function baseAntigua() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE venta_items(id INTEGER PRIMARY KEY);
    CREATE TABLE producciones(id INTEGER PRIMARY KEY);
    INSERT INTO venta_items(id) VALUES(1);
    INSERT INTO producciones(id) VALUES(1);
  `);
  return db;
}

test('la migración crea venta_item_costos sobre una base antigua y es idempotente', () => {
  const db = baseAntigua();
  migrarVentaItemCostos(db);
  migrarVentaItemCostos(db);
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='venta_item_costos'").get());
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_venta_item_costos_item'").get());
  db.prepare('INSERT INTO venta_item_costos(venta_item_id,produccion_id,cantidad,costo_unidad) VALUES(1,1,2,3.5)').run();
  assert.throws(() => db.prepare('INSERT INTO venta_item_costos(venta_item_id,produccion_id,cantidad,costo_unidad) VALUES(1,1,1,3.5)').run(), /UNIQUE/);
  assert.throws(() => db.prepare('INSERT INTO venta_item_costos(venta_item_id,produccion_id,cantidad,costo_unidad) VALUES(999,1,1,3.5)').run(), /FOREIGN KEY/);
  db.close();
});
