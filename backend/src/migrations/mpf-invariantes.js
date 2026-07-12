const DEFINICIONES = {
  mpf_politicas: `CREATE TABLE mpf_politicas_nueva (id INTEGER PRIMARY KEY AUTOINCREMENT, entidad_id INTEGER NOT NULL REFERENCES fin_entidades_economicas(id), nombre TEXT NOT NULL, evento_tipo TEXT NOT NULL CHECK(evento_tipo IN ('cobro_venta','aporte','prestamo')), version INTEGER NOT NULL DEFAULT 1, estado TEXT NOT NULL DEFAULT 'borrador' CHECK(estado IN ('borrador','activa','inactiva')), es_predeterminada INTEGER NOT NULL DEFAULT 0 CHECK(es_predeterminada IN (0,1)), recupera_costo INTEGER NOT NULL DEFAULT 0 CHECK(recupera_costo IN (0,1)), bolsillo_costo_id INTEGER REFERENCES fin_bolsillos(id), creado_por INTEGER NOT NULL REFERENCES usuarios(id), creado_en TEXT NOT NULL DEFAULT(datetime('now')), UNIQUE(entidad_id,nombre,version))`,
  mpf_reglas: `CREATE TABLE mpf_reglas_nueva (id INTEGER PRIMARY KEY AUTOINCREMENT, politica_id INTEGER NOT NULL REFERENCES mpf_politicas(id), orden INTEGER NOT NULL CHECK(orden>0), nombre TEXT NOT NULL, base TEXT NOT NULL CHECK(base IN ('ingreso','remanente')), tipo TEXT NOT NULL CHECK(tipo IN ('porcentaje','importe_fijo')), valor_minor INTEGER NOT NULL CHECK(valor_minor>=0), bolsillo_id INTEGER NOT NULL REFERENCES fin_bolsillos(id), meta_id INTEGER REFERENCES mpf_metas_financieras(id), condicion_json TEXT NOT NULL DEFAULT '{}', accion TEXT NOT NULL DEFAULT 'aplicar' CHECK(accion IN ('aplicar','resto','omitir')), bolsillo_destino_id INTEGER REFERENCES fin_bolsillos(id), meta_destino_id INTEGER REFERENCES mpf_metas_financieras(id), UNIQUE(politica_id,orden))`,
  mpf_aplicaciones: `CREATE TABLE mpf_aplicaciones_nueva (id INTEGER PRIMARY KEY AUTOINCREMENT, entidad_id INTEGER NOT NULL REFERENCES fin_entidades_economicas(id), evento_financiero_id INTEGER NOT NULL UNIQUE REFERENCES fin_eventos_financieros(id), politica_id INTEGER NOT NULL REFERENCES mpf_politicas(id), politica_version INTEGER NOT NULL, importe_ingreso_minor INTEGER NOT NULL CHECK(importe_ingreso_minor>0), costo_recuperado_minor INTEGER NOT NULL DEFAULT 0 CHECK(costo_recuperado_minor>=0), importe_distribuido_minor INTEGER NOT NULL CHECK(importe_distribuido_minor>=0), creado_en TEXT NOT NULL DEFAULT(datetime('now')))`,
  mpf_detalles_aplicacion: `CREATE TABLE mpf_detalles_aplicacion_nueva (id INTEGER PRIMARY KEY AUTOINCREMENT, aplicacion_id INTEGER NOT NULL REFERENCES mpf_aplicaciones(id), regla_id INTEGER NOT NULL REFERENCES mpf_reglas(id), bolsillo_id INTEGER NOT NULL REFERENCES fin_bolsillos(id), importe_minor INTEGER NOT NULL CHECK(importe_minor>=0), condicion_evaluada_json TEXT NOT NULL DEFAULT '{}')`,
};

const COLUMNAS = {
  mpf_politicas: ["id", "entidad_id", "nombre", "evento_tipo", "version", "estado", "es_predeterminada", "recupera_costo", "bolsillo_costo_id", "creado_por", "creado_en"],
  mpf_reglas: ["id", "politica_id", "orden", "nombre", "base", "tipo", "valor_minor", "bolsillo_id", "meta_id", "condicion_json", "accion", "bolsillo_destino_id", "meta_destino_id"],
  mpf_aplicaciones: ["id", "entidad_id", "evento_financiero_id", "politica_id", "politica_version", "importe_ingreso_minor", "costo_recuperado_minor", "importe_distribuido_minor", "creado_en"],
  mpf_detalles_aplicacion: ["id", "aplicacion_id", "regla_id", "bolsillo_id", "importe_minor", "condicion_evaluada_json"],
};

function columnas(db, tabla) { return new Set(db.prepare(`PRAGMA table_info(${tabla})`).all().map((item) => item.name)); }
function expresion(tabla, columna, existentes) {
  if (existentes.has(columna)) return columna;
  if (["recupera_costo", "costo_recuperado_minor"].includes(columna)) return "0";
  if (["condicion_json", "condicion_evaluada_json"].includes(columna)) return "'{}'";
  if (columna === "accion") return "'aplicar'";
  return "NULL";
}

function requiereMigracionMpf(db) {
  const requeridos = {
    mpf_politicas: ["recupera_costo", "bolsillo_costo_id", "CHECK(recupera_costo IN (0,1))"],
    mpf_reglas: ["meta_id", "condicion_json", "accion", "bolsillo_destino_id", "meta_destino_id", "CHECK(accion IN ('aplicar','resto','omitir'))"],
    mpf_aplicaciones: ["costo_recuperado_minor", "CHECK(costo_recuperado_minor>=0)"],
    mpf_detalles_aplicacion: ["condicion_evaluada_json"],
  };
  return Object.entries(requeridos).some(([tabla, fragmentos]) => {
    const row = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(tabla);
    return !row || fragmentos.some((fragmento) => !row.sql.replaceAll(" ", "").includes(fragmento.replaceAll(" ", "")));
  });
}

function migrarInvariantesMpf(db) {
  if (!requiereMigracionMpf(db)) return false;
  const foreignKeys = db.pragma("foreign_keys", { simple: true });
  if (foreignKeys) db.pragma("foreign_keys = OFF");
  try {
    db.transaction(() => {
      const existentes = Object.fromEntries(Object.keys(DEFINICIONES).map((tabla) => [tabla, columnas(db, tabla)]));
      Object.values(DEFINICIONES).forEach((sql) => db.exec(sql));
      for (const [tabla, columnasDestino] of Object.entries(COLUMNAS)) {
        const seleccion = columnasDestino.map((columna) => expresion(tabla, columna, existentes[tabla])).join(",");
        db.exec(`INSERT INTO ${tabla}_nueva(${columnasDestino.join(",")}) SELECT ${seleccion} FROM ${tabla}`);
      }
      ["mpf_detalles_aplicacion", "mpf_reglas", "mpf_aplicaciones", "mpf_politicas"].forEach((tabla) => db.exec(`DROP TABLE ${tabla}`));
      ["mpf_politicas", "mpf_reglas", "mpf_aplicaciones", "mpf_detalles_aplicacion"].forEach((tabla) => db.exec(`ALTER TABLE ${tabla}_nueva RENAME TO ${tabla}`));
      db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_mpf_politica_predeterminada ON mpf_politicas(entidad_id,evento_tipo) WHERE estado='activa' AND es_predeterminada=1");
    })();
  } finally { if (foreignKeys) db.pragma("foreign_keys = ON"); }
  return true;
}

module.exports = { COLUMNAS, migrarInvariantesMpf, requiereMigracionMpf };
