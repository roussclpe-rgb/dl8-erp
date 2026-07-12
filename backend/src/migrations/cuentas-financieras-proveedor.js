const PROVEEDORES = ["efectivo", "banco", "yape", "plin", "otra_billetera", "procesador", "custodia_tercero", "transito", "otro"];

function tablaExiste(db, tabla) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(tabla);
}

function columnaExiste(db, tabla, columna) {
  return db.prepare(`PRAGMA table_info(${tabla})`).all().some((item) => item.name === columna);
}

function crearTriggersProveedor(db) {
  db.exec(`
    DROP TRIGGER IF EXISTS trg_fin_cuenta_financiera_proveedor_insert;
    DROP TRIGGER IF EXISTS trg_fin_cuenta_financiera_proveedor_update;
    DROP TRIGGER IF EXISTS trg_fin_cobros_proveedor;
    DROP TRIGGER IF EXISTS trg_fin_pagos_cxp_proveedor;
    CREATE TRIGGER trg_fin_cuenta_financiera_proveedor_insert BEFORE INSERT ON fin_cuentas_financieras BEGIN
      SELECT CASE WHEN NOT (
        (NEW.tipo='caja' AND NEW.proveedor='efectivo') OR
        (NEW.tipo='banco' AND NEW.proveedor='banco') OR
        (NEW.tipo='billetera' AND NEW.proveedor IN ('yape','plin','otra_billetera','otro')) OR
        (NEW.tipo='procesador' AND NEW.proveedor IN ('procesador','otro')) OR
        (NEW.tipo='custodia_tercero' AND NEW.proveedor IN ('custodia_tercero','otro')) OR
        (NEW.tipo='transito' AND NEW.proveedor IN ('transito','otro'))
      ) THEN RAISE(ABORT,'El proveedor no es compatible con el tipo de cuenta financiera') END;
    END;
    CREATE TRIGGER trg_fin_cuenta_financiera_proveedor_update BEFORE UPDATE OF tipo, proveedor ON fin_cuentas_financieras BEGIN
      SELECT CASE WHEN NOT (
        (NEW.tipo='caja' AND NEW.proveedor='efectivo') OR
        (NEW.tipo='banco' AND NEW.proveedor='banco') OR
        (NEW.tipo='billetera' AND NEW.proveedor IN ('yape','plin','otra_billetera','otro')) OR
        (NEW.tipo='procesador' AND NEW.proveedor IN ('procesador','otro')) OR
        (NEW.tipo='custodia_tercero' AND NEW.proveedor IN ('custodia_tercero','otro')) OR
        (NEW.tipo='transito' AND NEW.proveedor IN ('transito','otro'))
      ) THEN RAISE(ABORT,'El proveedor no es compatible con el tipo de cuenta financiera') END;
    END;
  `);
  if (tablaExiste(db, "fin_cobros")) db.exec(`
    CREATE TRIGGER trg_fin_cobros_proveedor BEFORE INSERT ON fin_cobros BEGIN
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM fin_cuentas_financieras c WHERE c.id=NEW.cuenta_financiera_id AND (
          (NEW.metodo_pago='Efectivo' AND c.tipo='caja' AND c.proveedor='efectivo') OR
          (NEW.metodo_pago='Yape' AND c.tipo='billetera' AND c.proveedor='yape') OR
          (NEW.metodo_pago='Plin' AND c.tipo='billetera' AND c.proveedor='plin') OR
          (NEW.metodo_pago='Transferencia' AND c.tipo='banco' AND c.proveedor='banco') OR
          (NEW.metodo_pago='Tarjeta' AND c.tipo='procesador')
        )
      ) THEN RAISE(ABORT,'El proveedor de la cuenta no coincide con el método de cobro') END;
    END;
  `);
  if (tablaExiste(db, "fin_pagos_cxp")) db.exec(`
    CREATE TRIGGER trg_fin_pagos_cxp_proveedor BEFORE INSERT ON fin_pagos_cxp BEGIN
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM fin_cuentas_financieras c WHERE c.id=NEW.cuenta_financiera_id AND (
          (NEW.metodo_pago='Efectivo' AND c.tipo='caja' AND c.proveedor='efectivo') OR
          (NEW.metodo_pago='Yape' AND c.tipo='billetera' AND c.proveedor='yape') OR
          (NEW.metodo_pago='Plin' AND c.tipo='billetera' AND c.proveedor='plin') OR
          (NEW.metodo_pago='Transferencia' AND c.tipo='banco' AND c.proveedor='banco') OR
          (NEW.metodo_pago='Tarjeta' AND c.tipo='procesador')
        )
      ) THEN RAISE(ABORT,'El proveedor de la cuenta no coincide con el método de pago') END;
    END;
  `);
}

function migrarProveedorCuentaFinanciera(db) {
  if (!tablaExiste(db, "fin_cuentas_financieras")) return false;
  let cambio = false;
  if (!columnaExiste(db, "fin_cuentas_financieras", "proveedor")) {
    db.exec(`ALTER TABLE fin_cuentas_financieras ADD COLUMN proveedor TEXT NOT NULL DEFAULT 'otro' CHECK(proveedor IN (${PROVEEDORES.map((value) => `'${value}'`).join(",")}))`);
    cambio = true;
  }
  db.exec(`UPDATE fin_cuentas_financieras SET proveedor=CASE tipo
    WHEN 'caja' THEN 'efectivo' WHEN 'banco' THEN 'banco' WHEN 'billetera' THEN 'otra_billetera'
    WHEN 'procesador' THEN 'procesador' WHEN 'custodia_tercero' THEN 'custodia_tercero'
    WHEN 'transito' THEN 'transito' ELSE 'otro' END WHERE proveedor='otro'`);
  crearTriggersProveedor(db);
  return cambio;
}

module.exports = { PROVEEDORES, crearTriggersProveedor, migrarProveedorCuentaFinanciera };
