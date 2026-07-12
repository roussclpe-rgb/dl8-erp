function migrarVentaItemCostos(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS venta_item_costos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    venta_item_id INTEGER NOT NULL REFERENCES venta_items(id),
    produccion_id INTEGER NOT NULL REFERENCES producciones(id),
    cantidad REAL NOT NULL CHECK(cantidad > 0),
    costo_unidad REAL NOT NULL CHECK(costo_unidad >= 0),
    UNIQUE(venta_item_id, produccion_id)
  ); CREATE INDEX IF NOT EXISTS idx_venta_item_costos_item ON venta_item_costos(venta_item_id);`);
}

module.exports = { migrarVentaItemCostos };
