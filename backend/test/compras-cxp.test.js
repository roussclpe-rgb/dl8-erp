const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");

process.env.NODE_ENV = "development";
process.env.DB_PATH = ":memory:";
const { db } = require("../src/db");
const { generarToken } = require("../src/auth");
const catalogos = require("../src/services/finanzas/catalogos");
const motor = require("../src/services/finanzas/motor");

const admin = Number(db.prepare("INSERT INTO usuarios(nombre,email,password_hash,rol_id) VALUES('Compras CxP','compras-cxp@test','x',1)").run().lastInsertRowid);
const sinAcceso = Number(db.prepare("INSERT INTO usuarios(nombre,email,password_hash,rol_id) VALUES('Sin acceso','compras-sin-acceso@test','x',1)").run().lastInsertRowid);
const entidad = catalogos.crearEntidadFundacion({ codigo: "CXP_HTTP", nombre: "CxP HTTP", tipo: "empresa", fechaInicial: "2026-07-01", usuarioId: admin }).entidad;
const proveedorId = Number(db.prepare("INSERT INTO proveedores(nombre) VALUES('Proveedor CxP')").run().lastInsertRowid);
const proveedorDosId = Number(db.prepare("INSERT INTO proveedores(nombre) VALUES('Proveedor cruzado')").run().lastInsertRowid);
const ingredienteId = Number(db.prepare("INSERT INTO ingredientes(nombre,unidad_base) VALUES('Harina CxP','kg')").run().lastInsertRowid);

const app = express();
app.use(express.json());
app.use("/api/compras", require("../src/routes/compras"));
let server, baseUrl;
test.before(async () => { server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); }); baseUrl = `http://127.0.0.1:${server.address().port}`; });
test.after(async () => new Promise((resolve) => server.close(resolve)));
const token = (id = admin) => generarToken({ id, nombre: "Compras", rol_nombre: "admin" });
const payload = { entidad_id: entidad.id, proveedor_id: proveedorId, ingrediente_id: ingredienteId, fecha_compra: "2026-07-01", cantidad_comprada: 2, unidad_compra: "kg", contenido_por_presentacion: 1, costo_total: 10.005 };
const pedir = (body, key, usuario = admin) => fetch(`${baseUrl}/api/compras`, { method: "POST", headers: { Authorization: `Bearer ${token(usuario)}`, "Content-Type": "application/json", ...(key ? { "Idempotency-Key": key } : {}) }, body: JSON.stringify(body) });

test("compra nueva emite CxP y asiento 1301/2101 sin tesorería", async () => {
  const response = await pedir(payload, "compra-cxp-1");
  assert.equal(response.status, 201);
  const compra = await response.json();
  const lote = db.prepare("SELECT * FROM lotes_compra WHERE id=?").get(compra.id);
  const documento = db.prepare("SELECT * FROM fin_documentos_cxp WHERE lote_compra_id=?").get(compra.id);
  assert.equal(lote.entidad_id, entidad.id);
  assert.equal(documento.proveedor_id, proveedorId);
  assert.equal(documento.importe_original_minor, 1001);
  assert.equal(documento.estado, "abierta");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM movimientos_inventario WHERE referencia_tipo='lote_compra' AND referencia_id=?").get(compra.id).n, 1);
  const lineas = db.prepare("SELECT pc.codigo,l.debe_minor,l.haber_minor FROM fin_lineas_asiento l JOIN fin_asientos_contables a ON a.id=l.asiento_id JOIN fin_plan_cuentas pc ON pc.id=l.cuenta_contable_id WHERE a.evento_id=? ORDER BY pc.codigo").all(documento.evento_emision_id);
  assert.deepEqual(lineas, [{ codigo: "1301", debe_minor: 1001, haber_minor: 0 }, { codigo: "2101", debe_minor: 0, haber_minor: 1001 }]);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM fin_movimientos_tesoreria WHERE evento_id=?").get(documento.evento_emision_id).n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM fin_asignaciones_bolsillo WHERE evento_id=?").get(documento.evento_emision_id).n, 0);
  const editar = await fetch(`${baseUrl}/api/compras/${compra.id}`, { method: "PUT", headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" }, body: JSON.stringify({ costo_total: 12 }) });
  assert.equal(editar.status, 409);
});

test("idempotencia no duplica la compra y la misma clave con otro payload da conflicto", async () => {
  const primero = await pedir(payload, "compra-cxp-2");
  const resultado = await primero.json();
  const segundo = await pedir(payload, "compra-cxp-2");
  assert.equal(segundo.status, 201);
  assert.deepEqual(await segundo.json(), resultado);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM fin_documentos_cxp WHERE lote_compra_id=?").get(resultado.id).n, 1);
  assert.equal((await pedir({ ...payload, costo_total: 12 }, "compra-cxp-2")).status, 409);
});

test("rechaza proveedor, entidad y período financiero inválidos; un fallo revierte todo", async () => {
  assert.equal((await pedir({ ...payload, proveedor_id: 999999 }, "proveedor-invalido")).status, 400);
  assert.equal((await pedir({ ...payload, entidad_id: 999999 }, "entidad-invalida")).status, 403);
  assert.equal((await pedir(payload, "sin-acceso", sinAcceso)).status, 403);
  db.prepare("UPDATE fin_periodos SET estado='cerrado' WHERE entidad_id=?").run(entidad.id);
  assert.equal((await pedir(payload, "periodo-fin-cerrado")).status, 409);
  db.prepare("UPDATE fin_periodos SET estado='abierto' WHERE entidad_id=?").run(entidad.id);
  db.prepare("UPDATE periodos SET estado='cerrado' WHERE anio=2026 AND mes=7").run();
  assert.equal((await pedir(payload, "periodo-operativo-cerrado")).status, 409);
  db.prepare("UPDATE periodos SET estado='abierto' WHERE anio=2026 AND mes=7").run();
  const antes = db.prepare("SELECT COUNT(*) n FROM lotes_compra").get().n;
  db.exec("CREATE TRIGGER fallo_cxp BEFORE INSERT ON fin_documentos_cxp BEGIN SELECT RAISE(ABORT,'fallo inducido'); END");
  assert.equal((await pedir(payload, "fallo-cxp")).status, 400);
  db.exec("DROP TRIGGER fallo_cxp");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM lotes_compra").get().n, antes);
});

test("triggers rechazan relaciones cruzadas y el documento confirmado es inmutable", async () => {
  const periodo = db.prepare("SELECT id FROM periodos WHERE anio=2026 AND mes=7").get().id;
  const loteId = Number(db.prepare("INSERT INTO lotes_compra(ingrediente_id,proveedor_id,entidad_id,periodo_id,fecha_compra,cantidad_comprada,unidad_compra,contenido_por_presentacion,cantidad_total_base,cantidad_restante,costo_total,costo_unidad_base,usuario_id) VALUES(?,?,?,?,?,1,'kg',1,1,1,1,1,?)").run(ingredienteId, proveedorDosId, entidad.id, periodo, "2026-07-01", admin).lastInsertRowid);
  const c1301 = db.prepare("SELECT id FROM fin_plan_cuentas WHERE entidad_id=? AND codigo='1301'").get(entidad.id).id;
  const c2101 = db.prepare("SELECT id FROM fin_plan_cuentas WHERE entidad_id=? AND codigo='2101'").get(entidad.id).id;
  const evento = motor.ejecutar({ entidadId: entidad.id, tipo: "emision_compra", fecha: "2026-07-01", descripcion: "prueba cruzada", usuarioId: admin, clave: "cxp-cruzada", payload: { loteId }, lineas: [{ cuenta_contable_id: c1301, debe_minor: 100, haber_minor: 0 }, { cuenta_contable_id: c2101, debe_minor: 0, haber_minor: 100 }] });
  assert.throws(() => db.prepare("INSERT INTO fin_documentos_cxp(entidad_id,lote_compra_id,proveedor_id,fecha_emision,importe_original_minor,evento_emision_id,creado_por) VALUES(?,?,?,?,?,?,?)").run(entidad.id, loteId, proveedorId, "2026-07-01", 100, evento.id, admin), /CxP no coincide/);
  const documento = db.prepare("SELECT * FROM fin_documentos_cxp LIMIT 1").get();
  assert.throws(() => db.prepare("UPDATE fin_documentos_cxp SET importe_original_minor=1 WHERE id=?").run(documento.id), /inmutables/);
  assert.throws(() => motor.revertir({ entidadId: entidad.id, eventoId: documento.evento_emision_id, usuarioId: admin, clave: "reversion-cxp-directa" }), /CxC\/CxP/);
});

test("las compras históricas sin CxP conservan el flujo de edición", async () => {
  const periodo = db.prepare("SELECT id FROM periodos WHERE anio=2026 AND mes=7").get().id;
  const historicoId = Number(db.prepare("INSERT INTO lotes_compra(ingrediente_id,periodo_id,fecha_compra,cantidad_comprada,unidad_compra,contenido_por_presentacion,cantidad_total_base,cantidad_restante,costo_total,costo_unidad_base,usuario_id) VALUES(?,?,?,1,'kg',1,1,1,5,5,?)").run(ingredienteId, periodo, "2026-07-01", admin).lastInsertRowid);
  const response = await fetch(`${baseUrl}/api/compras/${historicoId}`, { method: "PUT", headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" }, body: JSON.stringify({ fecha_compra: "2026-07-01", cantidad_comprada: 1, unidad_compra: "kg", contenido_por_presentacion: 1, costo_total: 6 }) });
  assert.equal(response.status, 200);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM fin_documentos_cxp WHERE lote_compra_id=?").get(historicoId).n, 0);
});

test("anulación devuelve el resultado original al reintentar con la misma clave", async () => {
  const compra = await (await pedir(payload, "compra-anulable")).json();
  const anular = (key) => fetch(`${baseUrl}/api/compras/${compra.id}/anular`, { method: "POST", headers: { Authorization: `Bearer ${token()}`, "Idempotency-Key": key } });
  const primero = await anular("anular-idempotente");
  const resultado = await primero.json();
  const segundo = await anular("anular-idempotente");
  assert.equal(primero.status, 200);
  assert.equal(segundo.status, 200);
  assert.deepEqual(await segundo.json(), resultado);
  const documento = db.prepare("SELECT evento_emision_id,estado FROM fin_documentos_cxp WHERE lote_compra_id=?").get(compra.id);
  assert.equal(documento.estado, "anulada");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM fin_eventos_financieros WHERE reversion_de_id=?").get(documento.evento_emision_id).n, 1);
  assert.equal((await anular("anular-otra-clave")).status, 409);
});
