function tablaExiste(db, tabla) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(tabla);
}

function migrarEstadosReversionCxc(db) {
  if (!tablaExiste(db, "fin_cobros") || !tablaExiste(db, "fin_aplicaciones_cxc")) return false;
  db.exec(`
    DROP TRIGGER IF EXISTS trg_fin_cobros_no_update;
    DROP TRIGGER IF EXISTS trg_fin_cobros_estado_update;
    DROP TRIGGER IF EXISTS trg_fin_aplicaciones_no_update;
    DROP TRIGGER IF EXISTS trg_fin_aplicaciones_estado_update;
    CREATE TRIGGER trg_fin_cobros_no_update BEFORE UPDATE OF entidad_id,pago_id,documento_cxc_id,evento_financiero_id,cuenta_financiera_id,bolsillo_id,turno_caja_id,metodo_pago,importe_minor,fecha,creado_por,creado_en ON fin_cobros BEGIN
      SELECT RAISE(ABORT,'Los datos de un cobro confirmado son inmutables');
    END;
    CREATE TRIGGER trg_fin_cobros_estado_update BEFORE UPDATE OF estado ON fin_cobros WHEN NOT (OLD.estado='confirmado' AND NEW.estado='revertido') BEGIN
      SELECT RAISE(ABORT,'La única transición válida del cobro es confirmado a revertido');
    END;
    CREATE TRIGGER trg_fin_aplicaciones_no_update BEFORE UPDATE OF documento_cxc_id,cobro_id,evento_financiero_id,importe_minor,fecha_aplicacion,creado_por,creado_en ON fin_aplicaciones_cxc BEGIN
      SELECT RAISE(ABORT,'Los datos de una aplicación CxC confirmada son inmutables');
    END;
    CREATE TRIGGER trg_fin_aplicaciones_estado_update BEFORE UPDATE OF estado ON fin_aplicaciones_cxc WHEN NOT (OLD.estado='confirmada' AND NEW.estado='revertida') BEGIN
      SELECT RAISE(ABORT,'La única transición válida de la aplicación es confirmada a revertida');
    END;
  `);
  return true;
}

module.exports = { migrarEstadosReversionCxc };
