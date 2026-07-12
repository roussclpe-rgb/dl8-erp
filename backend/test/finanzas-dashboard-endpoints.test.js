const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");

process.env.DB_PATH = ":memory:";
process.env.NODE_ENV = "development";
const { db } = require("../src/db");
const { generarToken } = require("../src/auth");
const catalogos = require("../src/services/finanzas/catalogos");
const motor = require("../src/services/finanzas/motor");

const hoy = new Date().toISOString().slice(0, 10);
const admin = Number(db.prepare("INSERT INTO usuarios(nombre,email,password_hash,rol_id)VALUES('Dashboard HTTP','dashboard-http@test','x',1)").run().lastInsertRowid);
const sinAcceso = Number(db.prepare("INSERT INTO usuarios(nombre,email,password_hash,rol_id)VALUES('Sin acceso dashboard','sin-dashboard@test','x',1)").run().lastInsertRowid);
const token = (id) => generarToken({ id, nombre: `Usuario ${id}`, rol_nombre: "admin" });

function crearEntidad(codigo) {
  const entidad = catalogos.crearEntidadFundacion({ codigo, nombre: codigo, tipo: "empresa", fechaInicial: hoy, usuarioId: admin }).entidad;
  const bolsillo = db.prepare("SELECT id FROM fin_bolsillos WHERE entidad_id=? AND tipo='sin_asignar'").get(entidad.id);
  const cuenta = (plan, codigoCuenta, tipo, proveedor) => catalogos.crearCuentaFinanciera({
    entidadId: entidad.id,
    cuentaContableId: db.prepare("SELECT id FROM fin_plan_cuentas WHERE entidad_id=? AND codigo=?").get(entidad.id, plan).id,
    codigo: codigoCuenta, nombre: codigoCuenta, tipo, proveedor, usuarioId: admin,
  });
  return { entidad, bolsillo, caja: cuenta("1101", `${codigo}_CAJA`, "caja", "efectivo"), yape: cuenta("1103", `${codigo}_YAPE`, "billetera", "yape") };
}

const a = crearEntidad("DASH_A"); const b = crearEntidad("DASH_B"); const vacia = crearEntidad("DASH_VACIA");

function plan(entidadId, codigo) { return db.prepare("SELECT id FROM fin_plan_cuentas WHERE entidad_id=? AND codigo=?").get(entidadId, codigo).id; }
function eventoResultado({ contexto, tipo, importe, contrapartida, entrada }) {
  const cuenta = contexto.caja; const bolsillo = contexto.bolsillo.id;
  return motor.ejecutar({
    entidadId: contexto.entidad.id, tipo, fecha: hoy, descripcion: `${tipo} dashboard`, usuarioId: admin, clave: `${contexto.entidad.id}-${tipo}-${importe}-${contrapartida}`,
    payload: { importe },
    lineas: entrada
      ? [{ cuenta_contable_id: cuenta.cuenta_contable_id, cuenta_financiera_id: cuenta.id, debe_minor: importe, haber_minor: 0 }, { cuenta_contable_id: plan(contexto.entidad.id, contrapartida), debe_minor: 0, haber_minor: importe }]
      : [{ cuenta_contable_id: plan(contexto.entidad.id, contrapartida), debe_minor: importe, haber_minor: 0 }, { cuenta_contable_id: cuenta.cuenta_contable_id, cuenta_financiera_id: cuenta.id, debe_minor: 0, haber_minor: importe }],
    asigs: entrada ? [{ cuenta_destino_id: cuenta.id, bolsillo_destino_id: bolsillo, importe_minor: importe }] : [{ cuenta_origen_id: cuenta.id, bolsillo_origen_id: bolsillo, importe_minor: importe }],
  });
}

motor.inicial(a.entidad.id, admin, "dash-a-caja", { cuenta_financiera_id: a.caja.id, bolsillo_id: a.bolsillo.id, importe_minor: 10000, fecha: hoy });
motor.inicial(a.entidad.id, admin, "dash-a-yape", { cuenta_financiera_id: a.yape.id, bolsillo_id: a.bolsillo.id, importe_minor: 3000, fecha: hoy });
eventoResultado({ contexto: a, tipo: "ingreso_manual", importe: 5000, contrapartida: "4101", entrada: true });
eventoResultado({ contexto: a, tipo: "egreso_manual", importe: 1000, contrapartida: "5101", entrada: false });
eventoResultado({ contexto: a, tipo: "egreso_manual", importe: 500, contrapartida: "5201", entrada: false });
const temporal = motor.inicial(a.entidad.id, admin, "dash-a-revertible", { cuenta_financiera_id: a.caja.id, bolsillo_id: a.bolsillo.id, importe_minor: 2000, fecha: hoy });
motor.revertir({ entidadId: a.entidad.id, eventoId: temporal.id, usuarioId: admin, clave: "dash-a-reversion" });
motor.inicial(b.entidad.id, admin, "dash-b-caja", { cuenta_financiera_id: b.caja.id, bolsillo_id: b.bolsillo.id, importe_minor: 9999, fecha: hoy });
eventoResultado({ contexto: b, tipo: "ingreso_manual", importe: 20000, contrapartida: "4101", entrada: true });

const app = express(); app.use(express.json()); app.use("/api/finanzas", require("../src/routes/finanzas"));
let server; let baseUrl;
test.before(async () => { server = await new Promise((resolve) => { const instance = app.listen(0, () => resolve(instance)); }); baseUrl = `http://127.0.0.1:${server.address().port}`; });
test.after(async () => new Promise((resolve) => server.close(resolve)));
const get = (ruta, usuario = admin) => fetch(`${baseUrl}${ruta}`, { headers: usuario == null ? {} : { Authorization: `Bearer ${token(usuario)}` } });

test("GET saldos/caja calcula, aísla entidades y rechaza usuarios sin acceso", async () => {
  assert.equal((await get(`/api/finanzas/entidades/${a.entidad.id}/saldos/caja`, null)).status, 401);
  const propia = await get(`/api/finanzas/entidades/${a.entidad.id}/saldos/caja`); assert.equal(propia.status, 200); assert.equal((await propia.json()).saldo_minor, 13500);
  const ajena = await get(`/api/finanzas/entidades/${b.entidad.id}/saldos/caja`); assert.equal((await ajena.json()).saldo_minor, 29999);
  assert.equal((await get(`/api/finanzas/entidades/${a.entidad.id}/saldos/caja`, sinAcceso)).status, 403);
  const sumaEventos = db.prepare("SELECT SUM(m.importe_minor) saldo FROM fin_movimientos_tesoreria m JOIN fin_cuentas_financieras c ON c.id=m.cuenta_financiera_id WHERE c.entidad_id=? AND c.tipo='caja'").get(a.entidad.id).saldo;
  assert.equal(sumaEventos, 13500);
});

test("GET saldo por cuenta calcula, aísla entidades y rechaza usuarios sin acceso", async () => {
  const propia = await get(`/api/finanzas/entidades/${a.entidad.id}/saldos/cuentas-financieras/${a.yape.id}`); const data = await propia.json();
  assert.equal(propia.status, 200); assert.equal(data.saldo_minor, 3000); assert.equal(data.proveedor, "yape");
  assert.equal((await get(`/api/finanzas/entidades/${a.entidad.id}/saldos/cuentas-financieras/${b.caja.id}`)).status, 404);
  assert.equal((await get(`/api/finanzas/entidades/${a.entidad.id}/saldos/cuentas-financieras/999999`)).status, 404);
  assert.equal((await get(`/api/finanzas/entidades/${a.entidad.id}/saldos/cuentas-financieras/${a.yape.id}`, sinAcceso)).status, 403);
  assert.equal(db.prepare("SELECT SUM(importe_minor) saldo FROM fin_movimientos_tesoreria WHERE cuenta_financiera_id=?").get(a.yape.id).saldo, data.saldo_minor);
});

test("GET utilidad actual calcula, aísla entidades y rechaza usuarios sin acceso", async () => {
  const propia = await get(`/api/finanzas/entidades/${a.entidad.id}/utilidad/periodo-actual`); const utilidadA = await propia.json();
  assert.equal(propia.status, 200); assert.deepEqual({ ingresos: utilidadA.ingresos_minor, costos: utilidadA.costos_minor, gastos: utilidadA.gastos_minor, utilidad: utilidadA.utilidad_minor }, { ingresos: 5000, costos: 1000, gastos: 500, utilidad: 3500 });
  const utilidadB = await (await get(`/api/finanzas/entidades/${b.entidad.id}/utilidad/periodo-actual`)).json(); assert.equal(utilidadB.utilidad_minor, 20000);
  const sinActividad = await (await get(`/api/finanzas/entidades/${vacia.entidad.id}/utilidad/periodo-actual`)).json(); assert.equal(sinActividad.utilidad_minor, 0);
  assert.equal((await get(`/api/finanzas/entidades/${a.entidad.id}/utilidad/periodo-actual`, sinAcceso)).status, 403);
  assert.equal(utilidadA.utilidad_minor, utilidadA.ingresos_minor - utilidadA.costos_minor - utilidadA.gastos_minor);
});
