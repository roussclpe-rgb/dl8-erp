const COLUMNAS_PAGOS = [
  ["evento_financiero_id", "INTEGER REFERENCES fin_eventos_financieros(id)"],
  ["cobro_id", "INTEGER REFERENCES fin_cobros(id)"],
  ["aplicacion_cxc_id", "INTEGER REFERENCES fin_aplicaciones_cxc(id)"],
];

const TRIGGERS_AFECTADOS = ["trg_pagos_cxc_no_update", "trg_pagos_cxc_no_delete"];

function columnasDe(db, tabla) {
  return new Set(db.prepare(`PRAGMA table_info(${tabla})`).all().map((columna) => columna.name));
}

function prepararCompatibilidadPagosCxC(db) {
  const columnas = columnasDe(db, "pagos");
  const faltantes = COLUMNAS_PAGOS.filter(([nombre]) => !columnas.has(nombre));
  if (faltantes.length === 0) return false;

  db.transaction(() => {
    // Un trigger heredado puede referir OLD.cobro_id antes de que exista la columna.
    // Se eliminan solo estos dos triggers; finanzas-schema.sql los recrea enseguida.
    for (const trigger of TRIGGERS_AFECTADOS) db.exec(`DROP TRIGGER IF EXISTS ${trigger}`);
    for (const [nombre, definicion] of faltantes) db.exec(`ALTER TABLE pagos ADD COLUMN ${nombre} ${definicion}`);
  })();
  return true;
}

module.exports = { prepararCompatibilidadPagosCxC, TRIGGERS_AFECTADOS };
