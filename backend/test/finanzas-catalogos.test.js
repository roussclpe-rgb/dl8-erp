const test = require("node:test");
const assert = require("node:assert/strict");

process.env.DB_PATH = ":memory:";
const { db } = require("../src/db");
const catalogos = require("../src/services/finanzas/catalogos");

const adminId = Number(db.prepare("INSERT INTO usuarios (nombre, email, password_hash, rol_id) VALUES ('Admin pruebas', 'admin-finanzas@test.local', 'x', 1)").run().lastInsertRowid);

test("la fundación crea entidad, período, plan mínimo, bolsillo y acceso en una transacción", () => {
  const resultado = catalogos.crearEntidadFundacion({ codigo: "DL8_TEST", nombre: "DL8 Test", tipo: "empresa", fechaInicial: "2026-07-01", usuarioId: adminId });
  assert.equal(resultado.entidad.estado, "activa");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM fin_periodos WHERE entidad_id = ?").get(resultado.entidad.id).n, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM fin_plan_cuentas WHERE entidad_id = ?").get(resultado.entidad.id).n, 14);
  assert.equal(db.prepare("SELECT tipo FROM fin_bolsillos WHERE id = ?").get(resultado.bolsilloSinAsignarId).tipo, "sin_asignar");
  assert.equal(db.prepare("SELECT rol_financiero FROM fin_accesos_entidad WHERE entidad_id = ? AND usuario_id = ?").get(resultado.entidad.id, adminId).rol_financiero, "finanzas_admin");
});

test("participaciones activas no se superponen ni exceden 10000", () => {
  const entidad = catalogos.crearEntidadFundacion({ codigo: "PART_TEST", nombre: "Participaciones", tipo: "empresa", fechaInicial: "2026-07-01", usuarioId: adminId }).entidad;
  const p1 = catalogos.crearPropietario({ tipo: "persona", nombre: "Ana", creadoPor: adminId });
  const p2 = catalogos.crearPropietario({ tipo: "persona", nombre: "Luis", creadoPor: adminId });
  catalogos.crearParticipacion({ entidadId: entidad.id, propietarioId: p1.id, porcentajeMinor: 6000, fechaInicio: "2026-01-01", usuarioId: adminId });
  assert.throws(() => catalogos.crearParticipacion({ entidadId: entidad.id, propietarioId: p1.id, porcentajeMinor: 1000, fechaInicio: "2026-06-01", usuarioId: adminId }), /superpone/);
  assert.throws(() => catalogos.crearParticipacion({ entidadId: entidad.id, propietarioId: p2.id, porcentajeMinor: 5000, fechaInicio: "2026-01-01", usuarioId: adminId }), /10000/);
});

test("una cuenta financiera exige mapeo contable compatible y permite compartir cuenta contable", () => {
  const entidad = catalogos.crearEntidadFundacion({ codigo: "MAP_TEST", nombre: "Mapeo", tipo: "empresa", fechaInicial: "2026-07-01", usuarioId: adminId }).entidad;
  const caja = db.prepare("SELECT * FROM fin_plan_cuentas WHERE entidad_id = ? AND codigo = '1101'").get(entidad.id);
  const ingreso = db.prepare("SELECT * FROM fin_plan_cuentas WHERE entidad_id = ? AND codigo = '4101'").get(entidad.id);
  const primera = catalogos.crearCuentaFinanciera({ entidadId: entidad.id, cuentaContableId: caja.id, codigo: "CAJA_1", nombre: "Caja 1", tipo: "caja", usuarioId: adminId });
  const segunda = catalogos.crearCuentaFinanciera({ entidadId: entidad.id, cuentaContableId: caja.id, codigo: "CAJA_2", nombre: "Caja 2", tipo: "caja", usuarioId: adminId });
  assert.equal(primera.cuenta_contable_id, segunda.cuenta_contable_id);
  assert.throws(() => catalogos.crearCuentaFinanciera({ entidadId: entidad.id, cuentaContableId: ingreso.id, codigo: "MAL", nombre: "Inválida", tipo: "caja", usuarioId: adminId }), /mapeo/);
});

test("el esquema financiero es idempotente y crea sus restricciones SQLite", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const antes = db.prepare("SELECT COUNT(*) AS n FROM fin_entidades_economicas").get().n;
  db.exec(fs.readFileSync(path.join(__dirname, "..", "finanzas-schema.sql"), "utf8"));
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM fin_entidades_economicas").get().n, antes);
  assert.equal(db.pragma("foreign_keys", { simple: true }), 1);
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_fin_bolsillo_sin_asignar_unico'").get());
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'trigger' AND name = 'trg_fin_participacion_sin_solape_insert'").get());
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'trigger' AND name = 'trg_fin_cuenta_financiera_mapeo_insert'").get());
  const tablasConFk = ["fin_entidades_economicas", "fin_propietarios", "fin_periodos", "fin_plan_cuentas", "fin_participaciones", "fin_cuentas_financieras", "fin_bolsillos", "fin_accesos_entidad", "fin_auditoria"];
  for (const tabla of tablasConFk) assert.ok(db.prepare(`PRAGMA foreign_key_list(${tabla})`).all().length > 0, `${tabla} debe conservar sus claves foráneas`);
  const triggers = db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'trg_fin_%' ORDER BY name").all().map((r) => r.name);
  assert.deepEqual(triggers, [
    "trg_fin_aplicaciones_cxc_integridad",
    "trg_fin_aplicaciones_cxp_integridad",
    "trg_fin_aplicaciones_cxp_no_delete",
    "trg_fin_aplicaciones_cxp_no_update",
    "trg_fin_aplicaciones_no_delete",
    "trg_fin_aplicaciones_no_update",
    "trg_fin_asientos_no_delete",
    "trg_fin_asientos_no_update",
    "trg_fin_asignaciones_no_delete",
    "trg_fin_asignaciones_no_update",
    "trg_fin_cobros_integridad",
    "trg_fin_cobros_no_delete",
    "trg_fin_cobros_no_update",
    "trg_fin_cobros_proveedor",
    "trg_fin_cuenta_financiera_mapeo_insert",
    "trg_fin_cuenta_financiera_mapeo_update",
    "trg_fin_cuenta_financiera_proveedor_insert",
    "trg_fin_cuenta_financiera_proveedor_update",
    "trg_fin_documentos_cxc_integridad",
    "trg_fin_documentos_cxp_integridad",
    "trg_fin_documentos_cxp_no_delete",
    "trg_fin_documentos_cxp_no_update",
    "trg_fin_eventos_no_delete",
    "trg_fin_eventos_no_update",
    "trg_fin_lineas_no_delete",
    "trg_fin_lineas_no_update",
    "trg_fin_notas_credito_cxp_integridad",
    "trg_fin_notas_credito_cxp_no_delete",
    "trg_fin_notas_credito_cxp_no_update",
    "trg_fin_notas_credito_cxp_reglas",
    "trg_fin_pagos_cxp_confirmar",
    "trg_fin_pagos_cxp_integridad",
    "trg_fin_pagos_cxp_no_delete",
    "trg_fin_pagos_cxp_no_update",
    "trg_fin_pagos_cxp_proveedor",
    "trg_fin_participacion_sin_solape_insert",
    "trg_fin_participacion_sin_solape_update",
    "trg_fin_tesoreria_no_delete",
    "trg_fin_tesoreria_no_update"
  ]);
});

test("la creación de la fundación se revierte por completo si falla una etapa posterior", () => {
  db.exec("CREATE TRIGGER test_fallo_fundacion BEFORE INSERT ON fin_bolsillos WHEN NEW.codigo = 'SIN_ASIGNAR' BEGIN SELECT RAISE(ABORT, 'fallo inducido'); END;");
  assert.throws(() => catalogos.crearEntidadFundacion({ codigo: "ROLLBACK_TEST", nombre: "Rollback", tipo: "empresa", fechaInicial: "2026-07-01", usuarioId: adminId }), /fallo inducido/);
  db.exec("DROP TRIGGER test_fallo_fundacion");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM fin_entidades_economicas WHERE codigo = 'ROLLBACK_TEST'").get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM fin_plan_cuentas WHERE entidad_id IN (SELECT id FROM fin_entidades_economicas WHERE codigo = 'ROLLBACK_TEST')").get().n, 0);
});

test("las entidades personales requieren acceso financiero explícito incluso para otro admin global", () => {
  const otroAdminId = Number(db.prepare("INSERT INTO usuarios (nombre, email, password_hash, rol_id) VALUES ('Otro admin', 'otro-admin-finanzas@test.local', 'x', 1)").run().lastInsertRowid);
  const personal = catalogos.crearEntidadFundacion({ codigo: "PERSONAL_TEST", nombre: "Personal", tipo: "persona", fechaInicial: "2026-07-01", usuarioId: adminId }).entidad;
  assert.equal(catalogos.listarEntidadesParaUsuario(otroAdminId).some((e) => e.id === personal.id), false);
  assert.throws(() => catalogos.exigirAcceso(personal.id, otroAdminId), /No tienes acceso/);
  assert.equal(catalogos.exigirAcceso(personal.id, adminId).rol_financiero, "finanzas_personal_propietario");
});

test("no permite segundo bolsillo Sin asignar, IDs inválidos ni mapeos entre entidades", () => {
  const a = catalogos.crearEntidadFundacion({ codigo: "AISLADA_A", nombre: "Aislada A", tipo: "empresa", fechaInicial: "2026-07-01", usuarioId: adminId }).entidad;
  const b = catalogos.crearEntidadFundacion({ codigo: "AISLADA_B", nombre: "Aislada B", tipo: "empresa", fechaInicial: "2026-07-01", usuarioId: adminId }).entidad;
  assert.throws(() => db.prepare("INSERT INTO fin_bolsillos (entidad_id, codigo, nombre, tipo, creado_por, actualizado_por) VALUES (?, 'OTRO_SIN', 'Otro', 'sin_asignar', ?, ?)").run(a.id, adminId, adminId), /UNIQUE/);
  const cuentaA = db.prepare("SELECT id FROM fin_plan_cuentas WHERE entidad_id = ? AND codigo = '1101'").get(a.id);
  assert.throws(() => catalogos.crearCuentaFinanciera({ entidadId: b.id, cuentaContableId: cuentaA.id, codigo: "CRUZADA", nombre: "Cruzada", tipo: "caja", usuarioId: adminId }), /mapeo/);
  assert.throws(() => catalogos.crearBolsillo({ entidadId: "abc", codigo: "X", nombre: "X", tipo: "otro", usuarioId: adminId }), /ID positivo/);
});
