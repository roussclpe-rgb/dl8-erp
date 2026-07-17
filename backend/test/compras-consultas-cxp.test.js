const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");

process.env.NODE_ENV = "development";
process.env.DB_PATH = ":memory:";
const { db } = require("../src/db");
const { generarToken } = require("../src/auth");
const catalogos = require("../src/services/finanzas/catalogos");
const motor = require("../src/services/finanzas/motor");

const admin = Number(db.prepare("INSERT INTO usuarios(nombre,email,password_hash,rol_id) VALUES('Consultas CxP','consultas-cxp@test','x',1)").run().lastInsertRowid);
const sinAcceso = Number(db.prepare("INSERT INTO usuarios(nombre,email,password_hash,rol_id) VALUES('Consulta sin acceso','consultas-sin@test','x',1)").run().lastInsertRowid);
const entidad = catalogos.crearEntidadFundacion({ codigo: "CONSULTAS_CXP", nombre: "Consultas CxP", tipo: "empresa", fechaInicial: "2026-07-01", usuarioId: admin }).entidad;
const otraEntidad = catalogos.crearEntidadFundacion({ codigo: "CONSULTAS_OTRA", nombre: "Otra entidad", tipo: "empresa", fechaInicial: "2026-07-01", usuarioId: admin }).entidad;
const proveedorId = Number(db.prepare("INSERT INTO proveedores(nombre) VALUES('Proveedor consultas')").run().lastInsertRowid);
const proveedorDosId = Number(db.prepare("INSERT INTO proveedores(nombre) VALUES('Proveedor dos')").run().lastInsertRowid);
const ingredienteId = Number(db.prepare("INSERT INTO ingredientes(nombre,unidad_base) VALUES('Ingrediente consultas','kg')").run().lastInsertRowid);
const planBanco = db.prepare("SELECT id FROM fin_plan_cuentas WHERE entidad_id=? AND codigo='1102'").get(entidad.id).id;
const banco = catalogos.crearCuentaFinanciera({ entidadId: entidad.id, cuentaContableId: planBanco, codigo: "BANCO_CONS", nombre: "Banco consultas", tipo: "banco", usuarioId: admin });
const bolsilloId = db.prepare("SELECT id FROM fin_bolsillos WHERE entidad_id=? AND tipo='sin_asignar'").get(entidad.id).id;
motor.inicial(entidad.id, admin, "inicial-consultas", { cuenta_financiera_id: banco.id, bolsillo_id: bolsilloId, importe_minor: 10000, fecha: "2026-07-01" });

const app = express();
app.use(express.json());
app.use("/api/compras", require("../src/routes/compras"));
let server, baseUrl;
test.before(async () => { server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); }); baseUrl = `http://127.0.0.1:${server.address().port}`; });
test.after(async () => new Promise((resolve) => server.close(resolve)));
const token = (id = admin) => generarToken({ id, nombre: "Consultas", rol_nombre: "admin" });
const request = (path, options = {}, usuario = admin) => fetch(`${baseUrl}${path}`, { ...options, headers: { Authorization: `Bearer ${token(usuario)}`, "Content-Type": "application/json", ...(options.headers || {}) } });
async function compra({ total, proveedor = proveedorId, entidadId = entidad.id, key }) {
  const response = await request("/api/compras", { method: "POST", headers: { "Idempotency-Key": key }, body: JSON.stringify({ entidad_id: entidadId, proveedor_id: proveedor, ingrediente_id: ingredienteId, fecha_compra: "2026-07-01", fecha_vencimiento: "2026-07-15", cantidad_comprada: 1, unidad_compra: "kg", contenido_por_presentacion: 1, costo_total: total }) });
  assert.equal(response.status, 201);
  return response.json();
}

test("lista CxP con saldo derivado, filtros y contrato explícito", async () => {
  const una = await compra({ total: 10, key: "consulta-una" });
  const dos = await compra({ total: 20, proveedor: proveedorDosId, key: "consulta-dos" });
  await compra({ total: 10, entidadId: otraEntidad.id, key: "consulta-otra" });
  const pago = await request("/api/compras/pagos", { method: "POST", headers: { "Idempotency-Key": "consulta-pago" }, body: JSON.stringify({ entidad_id: entidad.id, proveedor_id: proveedorId, cuenta_financiera_id: banco.id, bolsillo_id: bolsilloId, metodo_pago: "Transferencia", fecha: "2026-07-01", monto: 4, aplicaciones: [{ documento_cxp_id: una.documento_cxp_id, monto: 4 }] }) });
  assert.equal(pago.status, 201);
  const listado = await request(`/api/compras/documentos-cxp?entidad_id=${entidad.id}`);
  assert.equal(listado.status, 200);
  const rows = await listado.json();
  assert.equal(rows.length, 2);
  const parcial = rows.find((r) => r.id === una.documento_cxp_id);
  assert.deepEqual(Object.keys(parcial).filter((k) => ["id", "entidad_id", "proveedor_id", "importe_original_minor", "aplicado_minor", "saldo_minor", "estado", "historico"].includes(k)).sort(), ["aplicado_minor", "entidad_id", "estado", "historico", "id", "importe_original_minor", "proveedor_id", "saldo_minor"]);
  assert.equal(parcial.aplicado_minor, 400);
  assert.equal(parcial.saldo_minor, 600);
  assert.equal(parcial.estado, "parcial");
  assert.equal((await request(`/api/compras/documentos-cxp?entidad_id=${entidad.id}&proveedor_id=${proveedorDosId}&estado=abierta&fecha_emision_desde=2026-07-01&fecha_vencimiento_hasta=2026-07-15`)).status, 200);
  const filtrado = await (await request(`/api/compras/documentos-cxp?entidad_id=${entidad.id}&proveedor_id=${proveedorDosId}&estado=abierta`)).json();
  assert.equal(filtrado.length, 1);
  assert.equal(filtrado[0].id, dos.documento_cxp_id);
  assert.equal((await request("/api/compras/documentos-cxp")).status, 400);
  assert.equal((await request(`/api/compras/documentos-cxp?entidad_id=${entidad.id}`, {}, sinAcceso)).status, 403);
});

test("detalle incluye compra, evento, pagos y aplicaciones; respeta acceso", async () => {
  const documento = db.prepare("SELECT id FROM fin_documentos_cxp WHERE entidad_id=? AND proveedor_id=? ORDER BY id LIMIT 1").get(entidad.id, proveedorId);
  const response = await request(`/api/compras/documentos-cxp/${documento.id}`);
  assert.equal(response.status, 200);
  const detalle = await response.json();
  assert.equal(detalle.documento.id, documento.id);
  assert.equal(detalle.documento.documento_cxp_id, documento.id);
  assert.equal(detalle.compra.id, detalle.documento.lote_compra_id);
  assert.equal(detalle.proveedor.id, proveedorId);
  assert.equal(detalle.evento_emision.id, detalle.documento.evento_emision_id);
  assert.equal(detalle.evento_emision.lineas.length, 2);
  assert.equal(detalle.pagos.length, 1);
  assert.equal(detalle.aplicaciones.length, 1);
  assert.equal((await request(`/api/compras/documentos-cxp/${documento.id}`, {}, sinAcceso)).status, 403);
});

test("separa compras históricas y bloquea rutas operativas sobre compras financieras", async () => {
  const periodo = db.prepare("SELECT id FROM periodos WHERE anio=2026 AND mes=7").get().id;
  const historicaId = Number(db.prepare("INSERT INTO lotes_compra(ingrediente_id,periodo_id,fecha_compra,cantidad_comprada,unidad_compra,contenido_por_presentacion,cantidad_total_base,cantidad_restante,costo_total,costo_unidad_base,usuario_id) VALUES(?,?,?,1,'kg',1,1,1,5,5,?)").run(ingredienteId, periodo, "2026-07-01", admin).lastInsertRowid);
  const historicas = await request("/api/compras/historicas");
  assert.equal(historicas.status, 200);
  assert.ok((await historicas.json()).some((r) => r.id === historicaId && r.historico && r.documento_cxp_id === null));
  const financiera = db.prepare("SELECT lote_compra_id FROM fin_documentos_cxp WHERE entidad_id=? LIMIT 1").get(entidad.id);
  const bloqueada = await request(`/api/compras/${financiera.lote_compra_id}`, { method: "PUT", body: JSON.stringify({ costo_total: 99 }) });
  assert.equal(bloqueada.status, 409);
  const legacy = await request(`/api/compras/${historicaId}`, { method: "PUT", body: JSON.stringify({ fecha_compra: "2026-07-01", cantidad_comprada: 1, unidad_compra: "kg", contenido_por_presentacion: 1, costo_total: 6 }) });
  assert.equal(legacy.status, 200);
});
