const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");

process.env.NODE_ENV = "development";
process.env.DB_PATH = ":memory:";
const { db } = require("../src/db");
const { generarToken } = require("../src/auth");
const catalogos = require("../src/services/finanzas/catalogos");
const motor = require("../src/services/finanzas/motor");

const admin = Number(db.prepare("INSERT INTO usuarios(nombre,email,password_hash,rol_id) VALUES('Pagos CxP','pagos-cxp@test','x',1)").run().lastInsertRowid);
const sinAcceso = Number(db.prepare("INSERT INTO usuarios(nombre,email,password_hash,rol_id) VALUES('Sin acceso','pagos-cxp-sin@test','x',1)").run().lastInsertRowid);
const entidad = catalogos.crearEntidadFundacion({ codigo: "PAGOS_CXP", nombre: "Pagos CxP", tipo: "empresa", fechaInicial: "2026-07-01", usuarioId: admin }).entidad;
const proveedorId = Number(db.prepare("INSERT INTO proveedores(nombre) VALUES('Proveedor pagos')").run().lastInsertRowid);
const proveedorAjenoId = Number(db.prepare("INSERT INTO proveedores(nombre) VALUES('Proveedor ajeno')").run().lastInsertRowid);
const ingredienteId = Number(db.prepare("INSERT INTO ingredientes(nombre,unidad_base) VALUES('Ingrediente pagos','kg')").run().lastInsertRowid);
const cuentaPlanBanco = db.prepare("SELECT id FROM fin_plan_cuentas WHERE entidad_id=? AND codigo='1102'").get(entidad.id).id;
const banco = catalogos.crearCuentaFinanciera({ entidadId: entidad.id, cuentaContableId: cuentaPlanBanco, codigo: "BANCO_CXP", nombre: "Banco CxP", tipo: "banco", usuarioId: admin });
const bolsilloId = db.prepare("SELECT id FROM fin_bolsillos WHERE entidad_id=? AND tipo='sin_asignar'").get(entidad.id).id;
motor.inicial(entidad.id, admin, "saldo-inicial-cxp", { cuenta_financiera_id: banco.id, bolsillo_id: bolsilloId, importe_minor: 10000, fecha: "2026-07-01" });

const app = express();
app.use(express.json());
app.use("/api/compras", require("../src/routes/compras"));
let server, baseUrl;
test.before(async () => { server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); }); baseUrl = `http://127.0.0.1:${server.address().port}`; });
test.after(async () => new Promise((resolve) => server.close(resolve)));
const token = (id = admin) => generarToken({ id, nombre: "Pagos CxP", rol_nombre: "admin" });
const post = (path, body, key, usuario = admin) => fetch(`${baseUrl}${path}`, { method: "POST", headers: { Authorization: `Bearer ${token(usuario)}`, "Content-Type": "application/json", ...(key ? { "Idempotency-Key": key } : {}) }, body: JSON.stringify(body) });

async function compra(total, proveedor = proveedorId, key = `compra-${Math.random()}`) {
  const response = await post("/api/compras", { entidad_id: entidad.id, proveedor_id: proveedor, ingrediente_id: ingredienteId, fecha_compra: "2026-07-01", cantidad_comprada: 1, unidad_compra: "kg", contenido_por_presentacion: 1, costo_total: total }, key);
  assert.equal(response.status, 201);
  return response.json();
}

function pago(aplicaciones, monto, extras = {}) {
  return {
    entidad_id: entidad.id, proveedor_id: proveedorId, cuenta_financiera_id: banco.id, bolsillo_id: bolsilloId,
    metodo_pago: "Transferencia", fecha: "2026-07-01", monto, aplicaciones, ...extras,
  };
}

test("un pago puede aplicar varias CxP y deja estados pagada/parcial con asiento, tesorería y bolsillo", async () => {
  const primera = await compra(10, proveedorId, "compra-pago-1");
  const segunda = await compra(20, proveedorId, "compra-pago-2");
  const response = await post("/api/compras/pagos", pago([{ documento_cxp_id: primera.documento_cxp_id, monto: 10 }, { documento_cxp_id: segunda.documento_cxp_id, monto: 15 }], 25), "pago-cxp-multiple");
  assert.equal(response.status, 201);
  const resultado = await response.json();
  const pagoDb = db.prepare("SELECT * FROM fin_pagos_cxp WHERE id=?").get(resultado.pago_cxp_id);
  assert.equal(pagoDb.estado, "confirmado");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM fin_aplicaciones_cxp WHERE pago_cxp_id=?").get(pagoDb.id).n, 2);
  assert.equal(db.prepare("SELECT estado FROM fin_documentos_cxp WHERE id=?").get(primera.documento_cxp_id).estado, "pagada");
  assert.equal(db.prepare("SELECT estado FROM fin_documentos_cxp WHERE id=?").get(segunda.documento_cxp_id).estado, "parcial");
  const lineas = db.prepare("SELECT pc.codigo,l.debe_minor,l.haber_minor FROM fin_lineas_asiento l JOIN fin_asientos_contables a ON a.id=l.asiento_id JOIN fin_plan_cuentas pc ON pc.id=l.cuenta_contable_id WHERE a.evento_id=? ORDER BY pc.codigo").all(resultado.evento_financiero_id);
  assert.deepEqual(lineas, [{ codigo: "1102", debe_minor: 0, haber_minor: 2500 }, { codigo: "2101", debe_minor: 2500, haber_minor: 0 }]);
  assert.equal(db.prepare("SELECT importe_minor FROM fin_movimientos_tesoreria WHERE evento_id=?").get(resultado.evento_financiero_id).importe_minor, -2500);
  assert.equal(db.prepare("SELECT importe_minor FROM fin_asignaciones_bolsillo WHERE evento_id=?").get(resultado.evento_financiero_id).importe_minor, 2500);
  assert.equal(motor.saldo(banco.id, bolsilloId).bol, 7500);
});

test("pago parcial posterior completa la CxP e idempotencia no duplica", async () => {
  const segunda = db.prepare("SELECT id FROM fin_documentos_cxp WHERE importe_original_minor=2000 ORDER BY id LIMIT 1").get();
  const body = pago([{ documento_cxp_id: segunda.id, monto: 5 }], 5);
  const primero = await post("/api/compras/pagos", body, "pago-cxp-final");
  assert.equal(primero.status, 201);
  const resultado = await primero.json();
  const segundo = await post("/api/compras/pagos", body, "pago-cxp-final");
  assert.equal(segundo.status, 201);
  assert.deepEqual(await segundo.json(), resultado);
  assert.equal(db.prepare("SELECT estado FROM fin_documentos_cxp WHERE id=?").get(segunda.id).estado, "pagada");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM fin_pagos_cxp WHERE id=?").get(resultado.pago_cxp_id).n, 1);
  assert.equal((await post("/api/compras/pagos", pago([{ documento_cxp_id: segunda.id, monto: 4 }], 4), "pago-cxp-final")).status, 409);
});

test("rechaza entidad, proveedor, saldo, aplicaciones y período inválidos", async () => {
  const propia = await compra(10, proveedorId, "compra-validaciones-propia");
  const ajena = await compra(10, proveedorAjenoId, "compra-validaciones-ajena");
  const sinSaldo = await compra(80, proveedorId, "compra-validaciones-sin-saldo");
  assert.equal((await post("/api/compras/pagos", pago([{ documento_cxp_id: ajena.documento_cxp_id, monto: 10 }], 10), "proveedor-cruzado")).status, 409);
  assert.equal((await post("/api/compras/pagos", pago([{ documento_cxp_id: propia.documento_cxp_id, monto: 11 }], 11), "sobreaplicacion")).status, 409);
  assert.equal((await post("/api/compras/pagos", pago([{ documento_cxp_id: propia.documento_cxp_id, monto: 10 }], 10, { entidad_id: 999999 }), "entidad-ajena")).status, 403);
  assert.equal((await post("/api/compras/pagos", pago([{ documento_cxp_id: propia.documento_cxp_id, monto: 10 }], 10, { cuenta_financiera_id: 999999 }), "cuenta-ajena")).status, 409);
  assert.equal((await post("/api/compras/pagos", pago([{ documento_cxp_id: propia.documento_cxp_id, monto: 10 }], 10), "sin-acceso", sinAcceso)).status, 403);
  assert.equal((await post("/api/compras/pagos", pago([{ documento_cxp_id: sinSaldo.documento_cxp_id, monto: 80 }], 80), "sin-saldo")).status, 409);
  db.prepare("UPDATE fin_periodos SET estado='cerrado' WHERE entidad_id=?").run(entidad.id);
  assert.equal((await post("/api/compras/pagos", pago([{ documento_cxp_id: propia.documento_cxp_id, monto: 10 }], 10), "periodo-cerrado")).status, 409);
  db.prepare("UPDATE fin_periodos SET estado='abierto' WHERE entidad_id=?").run(entidad.id);
});

test("rollback e integridad SQL no permiten pagos o aplicaciones incompletos ni mutables", async () => {
  const compraFallo = await compra(10, proveedorId, "compra-rollback-pago");
  const antesPagos = db.prepare("SELECT COUNT(*) n FROM fin_pagos_cxp").get().n;
  const antesEventos = db.prepare("SELECT COUNT(*) n FROM fin_eventos_financieros WHERE tipo='pago_compra'").get().n;
  db.exec("CREATE TRIGGER fallo_pago_cxp BEFORE INSERT ON fin_aplicaciones_cxp BEGIN SELECT RAISE(ABORT,'fallo inducido'); END");
  assert.equal((await post("/api/compras/pagos", pago([{ documento_cxp_id: compraFallo.documento_cxp_id, monto: 10 }], 10), "fallo-pago-cxp")).status, 400);
  db.exec("DROP TRIGGER fallo_pago_cxp");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM fin_pagos_cxp").get().n, antesPagos);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM fin_eventos_financieros WHERE tipo='pago_compra'").get().n, antesEventos);
  const pagoConfirmado = db.prepare("SELECT * FROM fin_pagos_cxp WHERE estado='confirmado' LIMIT 1").get();
  const aplicacion = db.prepare("SELECT * FROM fin_aplicaciones_cxp WHERE pago_cxp_id=? LIMIT 1").get(pagoConfirmado.id);
  assert.throws(() => db.prepare("UPDATE fin_pagos_cxp SET importe_minor=1 WHERE id=?").run(pagoConfirmado.id), /inmutables/);
  assert.throws(() => db.prepare("DELETE FROM fin_aplicaciones_cxp WHERE id=?").run(aplicacion.id), /no se eliminan/);
  assert.throws(() => db.prepare("INSERT INTO fin_aplicaciones_cxp(documento_cxp_id,pago_cxp_id,evento_financiero_id,importe_minor,fecha_aplicacion,creado_por) VALUES(?,?,?,?,?,?)").run(compraFallo.documento_cxp_id, pagoConfirmado.id, pagoConfirmado.evento_financiero_id, 1, "2026-07-01", admin), /aplicación no coincide/);
});

test("sin Idempotency-Key los pagos independientes no reutilizan el evento", async () => {
  const documento = await compra(10, proveedorId, "compra-sin-clave");
  const body = pago([{ documento_cxp_id: documento.documento_cxp_id, monto: 5 }], 5);
  const primero = await post("/api/compras/pagos", body);
  const segundo = await post("/api/compras/pagos", body);
  assert.equal(primero.status, 201);
  assert.equal(segundo.status, 201);
  assert.notEqual((await primero.json()).evento_financiero_id, (await segundo.json()).evento_financiero_id);
  assert.equal(db.prepare("SELECT estado FROM fin_documentos_cxp WHERE id=?").get(documento.documento_cxp_id).estado, "pagada");
});
