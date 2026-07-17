function migrarSaldosInicialesCxC(db) {
  const columnas = db.prepare("PRAGMA table_info(ventas)").all();
  if (!columnas.some((c) => c.name === "es_saldo_inicial")) db.exec("ALTER TABLE ventas ADD COLUMN es_saldo_inicial INTEGER NOT NULL DEFAULT 0 CHECK(es_saldo_inicial IN (0,1))");
  db.exec(`DROP TRIGGER IF EXISTS trg_fin_documentos_cxc_integridad;
    CREATE TRIGGER trg_fin_documentos_cxc_integridad BEFORE INSERT ON fin_documentos_cxc BEGIN
      SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM ventas v WHERE v.id=NEW.venta_id AND v.cliente_id=NEW.cliente_id) THEN RAISE(ABORT,'La CxC no coincide con la venta y el cliente') END;
      SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM fin_eventos_financieros e WHERE e.id=NEW.evento_emision_id AND e.entidad_id=NEW.entidad_id AND e.tipo IN ('emision_venta','saldo_inicial')) THEN RAISE(ABORT,'El evento de emisión no pertenece a la entidad') END;
      SELECT CASE WHEN EXISTS (SELECT 1 FROM fin_movimientos_tesoreria WHERE evento_id=NEW.evento_emision_id) THEN RAISE(ABORT,'La emisión de CxC no puede mover tesorería') END;
      SELECT CASE WHEN EXISTS (SELECT 1 FROM fin_eventos_financieros WHERE id=NEW.evento_emision_id AND tipo='emision_venta') AND NOT EXISTS (SELECT 1 FROM fin_lineas_asiento l JOIN fin_asientos_contables a ON a.id=l.asiento_id JOIN fin_plan_cuentas pc ON pc.id=l.cuenta_contable_id WHERE a.evento_id=NEW.evento_emision_id AND pc.entidad_id=NEW.entidad_id AND pc.codigo='4101' AND l.debe_minor=0 AND l.haber_minor=NEW.importe_original_minor) THEN RAISE(ABORT,'La emisión no acredita 4101 por el importe de la CxC') END;
      SELECT CASE WHEN EXISTS (SELECT 1 FROM fin_eventos_financieros WHERE id=NEW.evento_emision_id AND tipo='saldo_inicial') AND NOT EXISTS (SELECT 1 FROM fin_lineas_asiento l JOIN fin_asientos_contables a ON a.id=l.asiento_id JOIN fin_plan_cuentas pc ON pc.id=l.cuenta_contable_id WHERE a.evento_id=NEW.evento_emision_id AND pc.entidad_id=NEW.entidad_id AND pc.codigo='3901' AND l.debe_minor=0 AND l.haber_minor=NEW.importe_original_minor) THEN RAISE(ABORT,'El saldo inicial debe acreditar 3901') END;
    END;`);
}
module.exports = { migrarSaldosInicialesCxC };
