const TIPOS = "'saldo_inicial','transferencia_interna','reasignacion_bolsillo','ingreso_caja','egreso_caja','ajuste_conciliacion','cobro_venta','reversion'";

function requiereMigracion(db) {
  const tabla = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='fin_eventos_financieros'").get();
  return !!tabla && !['ingreso_caja','egreso_caja','ajuste_conciliacion','cobro_venta'].every((tipo) => tabla.sql.includes(`'${tipo}'`));
}

function migrarTiposEventosCaja(db, { fallarDespuesDeCopiar = false } = {}) {
  if (!requiereMigracion(db)) return false;
  const objetos = db.prepare("SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL AND ((type='index' AND tbl_name='fin_eventos_financieros') OR type='trigger' AND sql LIKE '%fin_eventos_financieros%')").all();
  const foreignKeys = db.pragma('foreign_keys', { simple: true });
  if (foreignKeys) db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      for (const objeto of objetos.filter((objeto) => objeto.type === 'trigger')) db.exec(`DROP TRIGGER IF EXISTS "${objeto.name}"`);
      db.exec(`CREATE TABLE fin_eventos_financieros_nueva (id INTEGER PRIMARY KEY AUTOINCREMENT, entidad_id INTEGER NOT NULL REFERENCES fin_entidades_economicas(id), tipo TEXT NOT NULL CHECK(tipo IN (${TIPOS})), estado TEXT NOT NULL DEFAULT 'confirmado' CHECK(estado='confirmado'), fecha TEXT NOT NULL, moneda TEXT NOT NULL DEFAULT 'PEN' CHECK(moneda='PEN'), descripcion TEXT NOT NULL, reversion_de_id INTEGER UNIQUE REFERENCES fin_eventos_financieros_nueva(id), creado_por INTEGER NOT NULL REFERENCES usuarios(id), creado_en TEXT NOT NULL DEFAULT(datetime('now')))`);
      db.exec('INSERT INTO fin_eventos_financieros_nueva(id,entidad_id,tipo,estado,fecha,moneda,descripcion,reversion_de_id,creado_por,creado_en) SELECT id,entidad_id,tipo,estado,fecha,moneda,descripcion,reversion_de_id,creado_por,creado_en FROM fin_eventos_financieros');
      if (fallarDespuesDeCopiar) throw new Error('Fallo inducido de migración financiera');
      db.exec('DROP TABLE fin_eventos_financieros');
      db.exec('ALTER TABLE fin_eventos_financieros_nueva RENAME TO fin_eventos_financieros');
      for (const objeto of objetos) db.exec(objeto.sql);
    })();
  } finally {
    if (foreignKeys) db.pragma('foreign_keys = ON');
  }
  return true;
}

module.exports = { requiereMigracion, migrarTiposEventosCaja };
