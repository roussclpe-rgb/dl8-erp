const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");

process.env.NODE_ENV = "development";
process.env.DB_PATH = ":memory:";
const { db } = require("../src/db");
const { generarToken } = require("../src/auth");
const catalogos = require("../src/services/finanzas/catalogos");
const caja = require("../src/services/caja");
const politicas = require("../src/services/finanzas/politicas");
const motor = require("../src/services/finanzas/motor");

const admin = Number(db.prepare("INSERT INTO usuarios(nombre,email,password_hash,rol_id)VALUES('Cobros','cobros@test','x',1)").run().lastInsertRowid);
const auth = generarToken({ id: admin, nombre: "Cobros", rol_nombre: "admin" });
const entidad = catalogos.crearEntidadFundacion({ codigo: "COBROS_CXC", nombre: "Cobros CxC", tipo: "empresa", fechaInicial: "2026-07-01", usuarioId: admin }).entidad;
const cuenta = (codigoPlan, codigo, nombre, tipo, proveedor) => {
  const plan = db.prepare("SELECT id FROM fin_plan_cuentas WHERE entidad_id=? AND codigo=?").get(entidad.id, codigoPlan);
  return catalogos.crearCuentaFinanciera({ entidadId: entidad.id, cuentaContableId: plan.id, codigo, nombre, tipo, proveedor, usuarioId: admin });
};
const cuentaCaja = cuenta("1101", "CAJA_CXC", "Caja CxC", "caja");
const billetera = cuenta("1103", "WALLET_CXC", "Billetera CxC", "billetera", "yape");
const plin = cuenta("1103", "PLIN_CXC", "Plin CxC", "billetera", "plin");
const banco = cuenta("1102", "BANCO_CXC", "Banco CxC", "banco");
const procesador = cuenta("1105", "PROC_CXC", "Procesador CxC", "procesador");
const cajaId = Number(db.prepare("INSERT INTO cajas(nombre,entidad_id,cuenta_financiera_id)VALUES('Caja CxC',?,?)").run(entidad.id, cuentaCaja.id).lastInsertRowid);
const turnoId = caja.abrirTurno({ cajaId, usuarioId: admin });
const clienteId = Number(db.prepare("INSERT INTO clientes(nombre,tipo,usuario_id)VALUES('Cliente Cobros','minorista',?)").run(admin).lastInsertRowid);
const grupoId = 9101;
db.prepare("INSERT INTO productos_venta(receta_grupo_id,precio_normal,precio_mayorista,usuario_id)VALUES(?,100,90,?)").run(grupoId, admin);
db.prepare("INSERT INTO recetas(grupo_id,version,nombre_producto,rendimiento,vigente,activo,usuario_id)VALUES(?,1,'Pan cobros',1,1,1,?)").run(grupoId, admin);
const recetaId = db.prepare("SELECT id FROM recetas WHERE grupo_id=?").get(grupoId).id;
const periodoId = Number(db.prepare("INSERT INTO periodos(anio,mes,estado)VALUES(2026,7,'abierto')").run().lastInsertRowid);
db.prepare("INSERT INTO producciones(receta_id,periodo_id,tandas,unidades_producidas,costo_materia_prima,costo_mano_obra,costo_indirectos,costo_total,costo_unidad,fecha,usuario_id)VALUES(?,?,1,100,0,0,0,0,0,'2026-07-01',?)").run(recetaId, periodoId, admin);

const app = express();
app.use(express.json());
app.use("/api/ventas", require("../src/routes/ventas.routes.v2"));
let server, baseUrl;
test.before(async () => { server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); }); baseUrl = `http://127.0.0.1:${server.address().port}`; });
test.after(async () => new Promise((resolve) => server.close(resolve)));
const pedir = (ruta, body, key) => fetch(`${baseUrl}${ruta}`, { method: "POST", headers: { Authorization: `Bearer ${auth}`, "Content-Type": "application/json", ...(key ? { "Idempotency-Key": key } : {}) }, body: JSON.stringify(body) });
let secuencia = 0;
const nuevaVenta = async (pagos = [], turno = undefined, key = `venta-cobro-${++secuencia}`) => {
  const body = { entidad_id: entidad.id, cliente_id: clienteId, fecha: "2026-07-01", items: [{ receta_grupo_id: grupoId, cantidad: 1 }], pagos, turno_caja_id: turno };
  const response = await pedir("/api/ventas", body, key);
  return { response, body, data: await response.json() };
};

test("contado efectivo aplica CxC, mueve tesorería una vez y no usa 2199", async () => {
  const x = await nuevaVenta([{ monto: 100, metodoPago: "Efectivo" }], turnoId, "contado-efectivo");
  assert.equal(x.response.status, 201);
  const doc = db.prepare("SELECT * FROM fin_documentos_cxc WHERE venta_id=?").get(x.data.id);
  assert.equal(doc.estado, "pagada");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM fin_aplicaciones_cxc WHERE documento_cxc_id=?").get(doc.id).n, 1);
  assert.equal(db.prepare("SELECT SUM(importe_minor) n FROM fin_aplicaciones_cxc WHERE documento_cxc_id=?").get(doc.id).n, 10000);
  const cobro = db.prepare("SELECT * FROM fin_cobros WHERE documento_cxc_id=?").get(doc.id);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM fin_movimientos_tesoreria WHERE evento_id=?").get(cobro.evento_financiero_id).n, 1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM fin_lineas_asiento l JOIN fin_plan_cuentas p ON p.id=l.cuenta_contable_id JOIN fin_asientos_contables a ON a.id=l.asiento_id WHERE a.evento_id=? AND p.codigo='2199'").get(cobro.evento_financiero_id).n, 0);
  const repetida = await pedir("/api/ventas", x.body, "contado-efectivo");
  assert.equal(repetida.status, 201);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM fin_cobros WHERE documento_cxc_id=?").get(doc.id).n, 1);
});

test("crédito queda abierto y pago parcial deja saldo correcto", async () => {
  const x = await nuevaVenta();
  const doc = db.prepare("SELECT * FROM fin_documentos_cxc WHERE venta_id=?").get(x.data.id);
  assert.equal(doc.estado, "abierta");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM fin_movimientos_tesoreria WHERE evento_id=?").get(doc.evento_emision_id).n, 0);
  const pago = await pedir(`/api/ventas/${x.data.id}/pagos`, { pagos: [{ monto: 40, metodoPago: "Efectivo" }], turno_caja_id: turnoId }, "parcial-cxc");
  assert.equal(pago.status, 200);
  assert.deepEqual(Object.assign({}, await pago.json(), { cobros: [] }), { saldo: 60, saldo_minor: 6000, estado_cxc: "parcial", cobros: [] });
  assert.equal(db.prepare("SELECT estado FROM fin_documentos_cxc WHERE id=?").get(doc.id).estado, "parcial");
});

test("pago mixto dirige cada medio a su cuenta y aplica la suma exacta", async () => {
  const x = await nuevaVenta();
  const pagos = [
    { monto: 20, metodoPago: "Yape", cuenta_financiera_id: billetera.id },
    { monto: 30, metodoPago: "Transferencia", cuenta_financiera_id: banco.id },
    { monto: 50, metodoPago: "Tarjeta", cuenta_financiera_id: procesador.id },
  ];
  const response = await pedir(`/api/ventas/${x.data.id}/pagos`, { pagos }, "mixto-cxc");
  assert.equal(response.status, 200);
  const doc = db.prepare("SELECT * FROM fin_documentos_cxc WHERE venta_id=?").get(x.data.id);
  assert.equal(db.prepare("SELECT SUM(importe_minor) n FROM fin_aplicaciones_cxc WHERE documento_cxc_id=?").get(doc.id).n, 10000);
  assert.deepEqual(db.prepare("SELECT cuenta_financiera_id FROM fin_cobros WHERE documento_cxc_id=? ORDER BY id").all(doc.id).map((r) => r.cuenta_financiera_id), [billetera.id, banco.id, procesador.id]);
  const saldoYape = motor.saldos(entidad.id).tesoreria.find((item) => item.id === billetera.id);
  assert.equal(saldoYape.proveedor, "yape");
  assert.equal(saldoYape.saldo_minor, 2000);
  assert.equal(db.prepare("SELECT estado FROM fin_documentos_cxc WHERE id=?").get(doc.id).estado, "pagada");
});

test("un cobro Yape rechaza Plin y termina únicamente en la cuenta Yape", async () => {
  const venta = await nuevaVenta();
  const incorrecto = await pedir(`/api/ventas/${venta.data.id}/pagos`, { pagos: [{ monto: 10, metodoPago: "Yape", cuenta_financiera_id: plin.id }] }, `yape-plin-mal-${++secuencia}`);
  assert.equal(incorrecto.status, 409);
  const correcto = await pedir(`/api/ventas/${venta.data.id}/pagos`, { pagos: [{ monto: 10, metodoPago: "Yape", cuenta_financiera_id: billetera.id }] }, `yape-correcto-${++secuencia}`);
  assert.equal(correcto.status, 200);
  const cobro = db.prepare("SELECT cuenta_financiera_id FROM fin_cobros WHERE documento_cxc_id=? ORDER BY id DESC").get(venta.data.documento_cxc_id);
  assert.equal(cobro.cuenta_financiera_id, billetera.id);
});

test("rechaza sobrepago, cuenta ausente y efectivo sin turno", async () => {
  const a = await nuevaVenta();
  assert.equal((await pedir(`/api/ventas/${a.data.id}/pagos`, { pagos: [{ monto: 101, metodoPago: "Efectivo" }], turno_caja_id: turnoId }, "sobrepago")).status, 409);
  const b = await nuevaVenta();
  assert.equal((await pedir(`/api/ventas/${b.data.id}/pagos`, { pagos: [{ monto: 10, metodoPago: "Yape" }] }, "sin-cuenta")).status, 409);
  const c = await nuevaVenta();
  assert.equal((await pedir(`/api/ventas/${c.data.id}/pagos`, { pagos: [{ monto: 10, metodoPago: "Efectivo" }] }, "sin-turno")).status, 409);
});

test("pago posterior es idempotente y rollback no deja registros parciales", async () => {
  const x = await nuevaVenta();
  const body = { pagos: [{ monto: 10, metodoPago: "Yape", cuenta_financiera_id: billetera.id }] };
  const primero = await pedir(`/api/ventas/${x.data.id}/pagos`, body, "idem-pago-cxc");
  assert.equal(primero.status, 200);
  const segundo = await pedir(`/api/ventas/${x.data.id}/pagos`, body, "idem-pago-cxc");
  assert.equal(segundo.status, 200);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM pagos WHERE venta_id=?").get(x.data.id).n, 1);
  db.prepare("UPDATE fin_periodos SET estado='cerrado' WHERE entidad_id=?").run(entidad.id);
  const reordenado = { pagos: [{ cuenta_financiera_id: billetera.id, metodoPago: "Yape", monto: 10 }] };
  assert.equal((await pedir(`/api/ventas/${x.data.id}/pagos`, reordenado, "idem-pago-cxc")).status, 200, "el reintento debe sobrevivir al cierre de período y al orden de claves");
  db.prepare("UPDATE fin_periodos SET estado='abierto' WHERE entidad_id=?").run(entidad.id);
  assert.equal((await pedir(`/api/ventas/${x.data.id}/pagos`, { pagos: [{ ...body.pagos[0], monto: 11 }] }, "idem-pago-cxc")).status, 409);

  const y = await nuevaVenta();
  const antes = db.prepare("SELECT COUNT(*) n FROM pagos").get().n;
  db.exec("CREATE TRIGGER fallo_aplicacion BEFORE INSERT ON fin_aplicaciones_cxc BEGIN SELECT RAISE(ABORT,'fallo inducido'); END");
  assert.equal((await pedir(`/api/ventas/${y.data.id}/pagos`, body, "fallo-pago-cxc")).status, 400);
  db.exec("DROP TRIGGER fallo_aplicacion");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM pagos").get().n, antes);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM fin_cobros WHERE documento_cxc_id=(SELECT id FROM fin_documentos_cxc WHERE venta_id=?)").get(y.data.id).n, 0);
});

test("anulación revierte emisión, cobros y reservas de una venta cobrada", async () => {
  const libre = await nuevaVenta();
  const anulada = await pedir(`/api/ventas/${libre.data.id}/anular`, {}, "anular-libre");
  assert.equal(anulada.status, 200);
  assert.equal(db.prepare("SELECT estado FROM fin_documentos_cxc WHERE venta_id=?").get(libre.data.id).estado, "anulada");
  const reversionId = (await anulada.json()).reversion_evento_id;
  assert.ok(db.prepare("SELECT 1 FROM fin_eventos_financieros WHERE id=? AND tipo='reversion'").get(reversionId));

  const cobrada = await nuevaVenta([{ monto: 100, metodoPago: "Efectivo" }], turnoId);
  const cobradaAnulada = await pedir(`/api/ventas/${cobrada.data.id}/anular`, {}, "anular-cobrada");
  assert.equal(cobradaAnulada.status, 200);
  const resultado = await cobradaAnulada.json();
  assert.equal(resultado.reversiones_cobro.length, 1);
  assert.equal(db.prepare("SELECT estado FROM fin_documentos_cxc WHERE venta_id=?").get(cobrada.data.id).estado, "anulada");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM fin_eventos_financieros WHERE reversion_de_id IN(SELECT evento_financiero_id FROM fin_cobros WHERE documento_cxc_id=(SELECT id FROM fin_documentos_cxc WHERE venta_id=?))").get(cobrada.data.id).n, 1);
});

test("período financiero cerrado rechaza cobro", async () => {
  const x = await nuevaVenta();
  db.prepare("UPDATE fin_periodos SET estado='cerrado' WHERE entidad_id=?").run(entidad.id);
  const response = await pedir(`/api/ventas/${x.data.id}/pagos`, { pagos: [{ monto: 10, metodoPago: "Yape", cuenta_financiera_id: billetera.id }] }, "cerrado-cobro");
  assert.equal(response.status, 409);
  db.prepare("UPDATE fin_periodos SET estado='abierto' WHERE entidad_id=?").run(entidad.id);
});

test("flujo MPF se filtra por venta y conserva política, reglas y reversión auditables", async () => {
  const bolsillo = catalogos.crearBolsillo({ entidadId: entidad.id, codigo: "FLUJO_MPF", nombre: "Flujo MPF", tipo: "operacion", usuarioId: admin });
  politicas.crear({ entidadId: entidad.id, nombre: "Flujo auditable", usuarioId: admin, activar: true, predeterminada: true, reglas: [
    { nombre: "Reserva de flujo", base: "ingreso", tipo: "porcentaje", valor_minor: 2500, bolsillo_id: bolsillo.id },
  ] });
  const venta = await nuevaVenta([{ monto: 100, metodoPago: "Yape", cuenta_financiera_id: billetera.id }]);
  assert.equal(venta.response.status, 201);
  const cobro = db.prepare("SELECT * FROM fin_cobros WHERE documento_cxc_id=(SELECT id FROM fin_documentos_cxc WHERE venta_id=?)").get(venta.data.id);
  const filas = politicas.listarFlujosDinero(entidad.id, { ventaId: venta.data.id, cobroId: cobro.id, desde: "2026-07-01", hasta: "2026-07-01" });
  assert.equal(filas.length, 1);
  assert.equal(filas[0].importe_ingreso_minor, 10000);
  assert.equal(filas[0].estado, "confirmado");
  assert.equal(politicas.listarFlujosDinero(entidad.id, { ventaId: venta.data.id + 999 }).length, 0);
  const auditoria = politicas.auditoriaMpf(entidad.id, { ventaId: venta.data.id, politicaId: filas[0].politica_id, pagina: 1, porPagina: 1 });
  assert.equal(auditoria.paginacion.total, 1);
  assert.equal(auditoria.paginacion.por_pagina, 1);
  assert.equal(auditoria.resultados[0].importe_base_minor, 10000);
  assert.equal(auditoria.resultados[0].monto_minor, 2500);
  assert.equal(auditoria.resultados[0].bolsillo, "Flujo MPF");
  const detalle = politicas.flujoDineroEvento(entidad.id, cobro.evento_financiero_id);
  assert.equal(detalle.politica.version, 1);
  assert.equal(detalle.politica.reglas[0].valor_minor, 2500);
  assert.equal(detalle.distribuciones[0].importe_minor, 2500);
  const anulacion = await pedir(`/api/ventas/${venta.data.id}/anular`, {}, "anular-flujo-mpf");
  assert.equal(anulacion.status, 200);
  assert.equal(politicas.listarFlujosDinero(entidad.id, { cobroId: cobro.id })[0].estado, "revertido");
  assert.ok(politicas.flujoDineroEvento(entidad.id, cobro.evento_financiero_id).reversion);
  assert.equal(politicas.auditoriaMpf(entidad.id, { cobroId: cobro.id, tipoEvento: "reversion" }).resultados[0].estado, "revertido");
});

test("restricciones SQL protegen vínculos, inmutabilidad y reversión de dominio", async () => {
  const x = await nuevaVenta([{ monto: 100, metodoPago: "Efectivo" }], turnoId);
  const doc = db.prepare("SELECT * FROM fin_documentos_cxc WHERE venta_id=?").get(x.data.id);
  const cobro = db.prepare("SELECT * FROM fin_cobros WHERE documento_cxc_id=?").get(doc.id);
  const pago = db.prepare("SELECT * FROM pagos WHERE id=?").get(cobro.pago_id);
  assert.throws(() => db.prepare("UPDATE pagos SET monto=1 WHERE id=?").run(pago.id), /inmutables/);
  assert.throws(() => db.prepare("DELETE FROM pagos WHERE id=?").run(pago.id), /no se eliminan/);
  assert.throws(() => db.prepare(`INSERT INTO fin_cobros
    (entidad_id,pago_id,documento_cxc_id,evento_financiero_id,cuenta_financiera_id,bolsillo_id,turno_caja_id,metodo_pago,importe_minor,fecha,creado_por)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(entidad.id + 999, pago.id, doc.id, cobro.evento_financiero_id, cobro.cuenta_financiera_id, cobro.bolsillo_id, cobro.turno_caja_id, "Efectivo", cobro.importe_minor, cobro.fecha, admin), /no coincide|no pertenece/);
  assert.throws(() => db.prepare(`INSERT INTO fin_aplicaciones_cxc(documento_cxc_id,cobro_id,evento_financiero_id,importe_minor,fecha_aplicacion,creado_por)
    VALUES(?,?,?,?,?,?)`).run(doc.id, cobro.id, cobro.evento_financiero_id, cobro.importe_minor, "2026-07-01", admin), /supera el saldo/);
  const motor = require("../src/services/finanzas/motor");
  assert.throws(() => motor.revertir({ entidadId: entidad.id, eventoId: cobro.evento_financiero_id, usuarioId: admin, clave: "reversion-generica-cobro" }), /flujo de dominio/);
});

test("Caja atribuye cada cobro nuevo únicamente a su turno explícito", async () => {
  const primero = await nuevaVenta([{ monto: 100, metodoPago: "Efectivo" }], turnoId);
  db.prepare("UPDATE turnos_caja SET estado='cerrado',fecha_cierre=datetime('now') WHERE id=?").run(turnoId);
  const turnoDos = caja.abrirTurno({ cajaId, usuarioId: admin });
  const segundo = await nuevaVenta([{ monto: 100, metodoPago: "Efectivo" }], turnoDos);
  const eventoPrimero = db.prepare("SELECT evento_financiero_id FROM fin_cobros WHERE documento_cxc_id=(SELECT id FROM fin_documentos_cxc WHERE venta_id=?)").get(primero.data.id).evento_financiero_id;
  const eventoSegundo = db.prepare("SELECT evento_financiero_id FROM fin_cobros WHERE documento_cxc_id=(SELECT id FROM fin_documentos_cxc WHERE venta_id=?)").get(segundo.data.id).evento_financiero_id;
  const eventosTurnoUno = caja.movimientosTurno(turnoId).map((movimiento) => db.prepare("SELECT evento_id FROM fin_movimientos_tesoreria WHERE id=?").get(movimiento.id).evento_id);
  const eventosTurnoDos = caja.movimientosTurno(turnoDos).map((movimiento) => db.prepare("SELECT evento_id FROM fin_movimientos_tesoreria WHERE id=?").get(movimiento.id).evento_id);
  assert.ok(eventosTurnoUno.includes(eventoPrimero));
  assert.ok(!eventosTurnoUno.includes(eventoSegundo));
  assert.ok(eventosTurnoDos.includes(eventoSegundo));
  assert.ok(!eventosTurnoDos.includes(eventoPrimero));
});

test("reintento de venta devuelve el original aunque período y turno hayan cambiado", async () => {
  const turnoActual = db.prepare("SELECT id FROM turnos_caja WHERE caja_id=? AND estado='abierto'").get(cajaId).id;
  const key = "venta-reintento-estable";
  const x = await nuevaVenta([{ monto: 100, metodoPago: "Efectivo" }], turnoActual, key);
  db.prepare("UPDATE turnos_caja SET estado='cerrado',fecha_cierre=datetime('now') WHERE id=?").run(turnoActual);
  db.prepare("UPDATE fin_periodos SET estado='cerrado' WHERE entidad_id=?").run(entidad.id);
  const reordenado = {
    pagos: [{ metodoPago: "Efectivo", monto: 100 }],
    items: [{ cantidad: 1, receta_grupo_id: grupoId }],
    fecha: "2026-07-01",
    cliente_id: clienteId,
    entidad_id: entidad.id,
    turno_caja_id: turnoActual,
  };
  const retry = await pedir("/api/ventas", reordenado, key);
  assert.equal(retry.status, 201);
  assert.equal((await retry.json()).id, x.data.id);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM ventas_claves_idempotencia WHERE clave=?").get(key).n, 1);
  db.prepare("UPDATE fin_periodos SET estado='abierto' WHERE entidad_id=?").run(entidad.id);
});
