const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");

process.env.NODE_ENV = "development";
process.env.DB_PATH = ":memory:";
const { db } = require("../src/db");
const { generarToken } = require("../src/auth");
const catalogos = require("../src/services/finanzas/catalogos");
const motor = require("../src/services/finanzas/motor");

const admin = Number(db.prepare("INSERT INTO usuarios(nombre,email,password_hash,rol_id) VALUES('Reversiones CxP','reversiones-cxp@test','x',1)").run().lastInsertRowid);
const otroAdmin = Number(db.prepare("INSERT INTO usuarios(nombre,email,password_hash,rol_id) VALUES('Admin sin acceso','reversiones-cxp-sin@test','x',1)").run().lastInsertRowid);
const operador = Number(db.prepare("INSERT INTO usuarios(nombre,email,password_hash,rol_id) VALUES('Operador CxP','reversiones-cxp-operador@test','x',2)").run().lastInsertRowid);
const entidad = catalogos.crearEntidadFundacion({ codigo: "REV_PAGOS_CXP", nombre: "Reversiones pagos CxP", tipo: "empresa", fechaInicial: "2026-07-01", usuarioId: admin }).entidad;
db.prepare("INSERT INTO fin_accesos_entidad(usuario_id,entidad_id,rol_financiero,otorgado_por,actualizado_por) VALUES(?,?,'finanzas_operador',?,?)")
  .run(operador, entidad.id, admin, admin);
const proveedorId = Number(db.prepare("INSERT INTO proveedores(nombre) VALUES('Proveedor reversiones')").run().lastInsertRowid);
const ingredienteId = Number(db.prepare("INSERT INTO ingredientes(nombre,unidad_base) VALUES('Ingrediente reversiones','kg')").run().lastInsertRowid);
const cuentaPlanBanco = db.prepare("SELECT id FROM fin_plan_cuentas WHERE entidad_id=? AND codigo='1102'").get(entidad.id).id;
const banco = catalogos.crearCuentaFinanciera({ entidadId: entidad.id, cuentaContableId: cuentaPlanBanco, codigo: "BANCO_REV_CXP", nombre: "Banco reversiones CxP", tipo: "banco", usuarioId: admin });
const bolsilloId = db.prepare("SELECT id FROM fin_bolsillos WHERE entidad_id=? AND tipo='sin_asignar'").get(entidad.id).id;
motor.inicial(entidad.id, admin, "saldo-inicial-reversiones-cxp", { cuenta_financiera_id: banco.id, bolsillo_id: bolsilloId, importe_minor: 100000, fecha: "2026-07-01" });

const app = express();
app.use(express.json());
app.use("/api/compras", require("../src/routes/compras"));
let server;
let baseUrl;
test.before(async () => {
  server = await new Promise((resolve) => { const instance = app.listen(0, () => resolve(instance)); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => new Promise((resolve) => server.close(resolve)));

const token = (id = admin, rol = "admin") => generarToken({ id, nombre: "Reversiones CxP", rol_nombre: rol });
const post = (path, body = {}, key, usuario = admin, rol = "admin") => fetch(`${baseUrl}${path}`, {
  method: "POST",
  headers: { Authorization: `Bearer ${token(usuario, rol)}`, "Content-Type": "application/json", ...(key ? { "Idempotency-Key": key } : {}) },
  body: JSON.stringify(body),
});

let secuencia = 0;
async function compra(total) {
  const response = await post("/api/compras", {
    entidad_id: entidad.id, proveedor_id: proveedorId, ingrediente_id: ingredienteId, fecha_compra: "2026-07-01",
    cantidad_comprada: 1, unidad_compra: "kg", contenido_por_presentacion: 1, costo_total: total,
  }, `rev-compra-${++secuencia}`);
  assert.equal(response.status, 201);
  return response.json();
}

async function pagar(aplicaciones, monto) {
  const response = await post("/api/compras/pagos", {
    entidad_id: entidad.id, proveedor_id: proveedorId, cuenta_financiera_id: banco.id, bolsillo_id: bolsilloId,
    metodo_pago: "Transferencia", fecha: "2026-07-01", monto, aplicaciones,
  }, `rev-pago-${++secuencia}`);
  assert.equal(response.status, 201);
  return response.json();
}

test("revierte un pago completo con contrapartida exacta y restaura CxP, tesorería y bolsillo", async () => {
  const documento = await compra(25);
  const pago = await pagar([{ documento_cxp_id: documento.documento_cxp_id, monto: 25 }], 25);
  const saldoAntes = motor.saldo(banco.id, bolsilloId);
  const response = await post(`/api/compras/pagos/${pago.pago_cxp_id}/reversiones`, {}, "reversion-completa");
  assert.equal(response.status, 200);
  const resultado = await response.json();

  assert.equal(db.prepare("SELECT estado FROM fin_pagos_cxp WHERE id=?").get(pago.pago_cxp_id).estado, "revertido");
  assert.deepEqual(db.prepare("SELECT estado FROM fin_aplicaciones_cxp WHERE pago_cxp_id=?").all(pago.pago_cxp_id), [{ estado: "revertida" }]);
  assert.equal(db.prepare("SELECT estado FROM fin_documentos_cxp WHERE id=?").get(documento.documento_cxp_id).estado, "abierta");
  const reversion = db.prepare("SELECT tipo,reversion_de_id FROM fin_eventos_financieros WHERE id=?").get(resultado.reversion_evento_id);
  assert.deepEqual(reversion, { tipo: "reversion", reversion_de_id: pago.evento_financiero_id });
  const lineasOriginales = db.prepare("SELECT cuenta_contable_id,cuenta_financiera_id,debe_minor,haber_minor FROM fin_lineas_asiento l JOIN fin_asientos_contables a ON a.id=l.asiento_id WHERE a.evento_id=? ORDER BY l.id").all(pago.evento_financiero_id);
  const lineasReversion = db.prepare("SELECT cuenta_contable_id,cuenta_financiera_id,debe_minor,haber_minor FROM fin_lineas_asiento l JOIN fin_asientos_contables a ON a.id=l.asiento_id WHERE a.evento_id=? ORDER BY l.id").all(resultado.reversion_evento_id);
  assert.deepEqual(lineasReversion, lineasOriginales.map((linea) => ({ ...linea, debe_minor: linea.haber_minor, haber_minor: linea.debe_minor })));
  assert.equal(db.prepare("SELECT importe_minor FROM fin_movimientos_tesoreria WHERE evento_id=?").get(resultado.reversion_evento_id).importe_minor, 2500);
  assert.equal(motor.saldo(banco.id, bolsilloId).tes, saldoAntes.tes + 2500);
  assert.equal(motor.saldo(banco.id, bolsilloId).bol, saldoAntes.bol + 2500);
});

test("recalcula todos los documentos de un pago múltiple sin alterar otras aplicaciones", async () => {
  const primero = await compra(20);
  const segundo = await compra(30);
  const pagoPrevio = await pagar([{ documento_cxp_id: segundo.documento_cxp_id, monto: 5 }], 5);
  const multiple = await pagar([
    { documento_cxp_id: primero.documento_cxp_id, monto: 20 },
    { documento_cxp_id: segundo.documento_cxp_id, monto: 10 },
  ], 30);
  assert.equal((await post(`/api/compras/pagos/${multiple.pago_cxp_id}/reversiones`, {}, "reversion-multiple")).status, 200);
  assert.equal(db.prepare("SELECT estado FROM fin_documentos_cxp WHERE id=?").get(primero.documento_cxp_id).estado, "abierta");
  assert.equal(db.prepare("SELECT estado FROM fin_documentos_cxp WHERE id=?").get(segundo.documento_cxp_id).estado, "parcial");
  assert.equal(db.prepare("SELECT estado FROM fin_aplicaciones_cxp WHERE pago_cxp_id=?").get(pagoPrevio.pago_cxp_id).estado, "confirmada");
});

test("la reversión es idempotente con la misma clave y bloquea dobles reversiones", async () => {
  const documento = await compra(10);
  const pago = await pagar([{ documento_cxp_id: documento.documento_cxp_id, monto: 10 }], 10);
  const primero = await post(`/api/compras/pagos/${pago.pago_cxp_id}/reversiones`, {}, "reversion-idempotente");
  const resultado = await primero.json();
  const segundo = await post(`/api/compras/pagos/${pago.pago_cxp_id}/reversiones`, {}, "reversion-idempotente");
  assert.equal(primero.status, 200);
  assert.equal(segundo.status, 200);
  assert.deepEqual(await segundo.json(), resultado);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM fin_eventos_financieros WHERE reversion_de_id=?").get(pago.evento_financiero_id).n, 1);
  assert.equal((await post(`/api/compras/pagos/${pago.pago_cxp_id}/reversiones`, {}, "otra-clave")).status, 409);
  assert.equal((await post(`/api/compras/pagos/${pago.pago_cxp_id}/reversiones`)).status, 409);
});

test("rechaza pago inexistente, usuario sin acceso, rol no administrador y reversión genérica", async () => {
  assert.equal((await post("/api/compras/pagos/999999/reversiones", {}, "reversion-inexistente")).status, 404);
  const documento = await compra(10);
  const pago = await pagar([{ documento_cxp_id: documento.documento_cxp_id, monto: 10 }], 10);
  assert.equal((await post(`/api/compras/pagos/${pago.pago_cxp_id}/reversiones`, {}, "reversion-sin-acceso", otroAdmin)).status, 403);
  assert.equal((await post(`/api/compras/pagos/${pago.pago_cxp_id}/reversiones`, {}, "reversion-operador", operador, "operador")).status, 403);
  assert.throws(() => motor.revertir({ entidadId: entidad.id, eventoId: pago.evento_financiero_id, usuarioId: admin, clave: "reversion-generica-cxp" }), /flujo de dominio/);
});

test("período cerrado y fallo intermedio hacen rollback sin dejar reversión parcial", async () => {
  const documentoCerrado = await compra(10);
  const pagoCerrado = await pagar([{ documento_cxp_id: documentoCerrado.documento_cxp_id, monto: 10 }], 10);
  db.prepare("UPDATE fin_periodos SET estado='cerrado' WHERE entidad_id=?").run(entidad.id);
  assert.equal((await post(`/api/compras/pagos/${pagoCerrado.pago_cxp_id}/reversiones`, {}, "reversion-periodo-cerrado")).status, 409);
  assert.equal(db.prepare("SELECT estado FROM fin_pagos_cxp WHERE id=?").get(pagoCerrado.pago_cxp_id).estado, "confirmado");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM fin_eventos_financieros WHERE reversion_de_id=?").get(pagoCerrado.evento_financiero_id).n, 0);
  db.prepare("UPDATE fin_periodos SET estado='abierto' WHERE entidad_id=?").run(entidad.id);

  const documentoFallo = await compra(10);
  const pagoFallo = await pagar([{ documento_cxp_id: documentoFallo.documento_cxp_id, monto: 10 }], 10);
  db.exec("CREATE TRIGGER fallo_reversion_aplicacion BEFORE UPDATE OF estado ON fin_aplicaciones_cxp WHEN NEW.pago_cxp_id=" + pagoFallo.pago_cxp_id + " BEGIN SELECT RAISE(ABORT,'fallo inducido'); END");
  assert.equal((await post(`/api/compras/pagos/${pagoFallo.pago_cxp_id}/reversiones`, {}, "reversion-fallo-intermedio")).status, 400);
  db.exec("DROP TRIGGER fallo_reversion_aplicacion");
  assert.equal(db.prepare("SELECT estado FROM fin_pagos_cxp WHERE id=?").get(pagoFallo.pago_cxp_id).estado, "confirmado");
  assert.equal(db.prepare("SELECT estado FROM fin_aplicaciones_cxp WHERE pago_cxp_id=?").get(pagoFallo.pago_cxp_id).estado, "confirmada");
  assert.equal(db.prepare("SELECT estado FROM fin_documentos_cxp WHERE id=?").get(documentoFallo.documento_cxp_id).estado, "pagada");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM fin_eventos_financieros WHERE reversion_de_id=?").get(pagoFallo.evento_financiero_id).n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM correcciones_cxp_claves_idempotencia WHERE clave='reversion-fallo-intermedio'").get().n, 0);
});
