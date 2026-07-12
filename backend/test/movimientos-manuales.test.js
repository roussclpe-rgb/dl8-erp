const test = require('node:test');
const assert = require('node:assert/strict');
process.env.DB_PATH = ':memory:';
const { db } = require('../src/db');
const cat = require('../src/services/finanzas/catalogos');
const motor = require('../src/services/finanzas/motor');
const { registrarMovimientoManual } = require('../src/services/finanzas/movimientos');

const admin = Number(db.prepare("INSERT INTO usuarios(nombre,email,password_hash,rol_id) VALUES('Manual','manual@test','x',1)").run().lastInsertRowid);
function base(codigo) {
  const entidad = cat.crearEntidadFundacion({ codigo, nombre: codigo, tipo: 'empresa', fechaInicial: '2026-07-01', usuarioId: admin }).entidad;
  const cuentaPlan = db.prepare("SELECT id FROM fin_plan_cuentas WHERE entidad_id=? AND codigo='1102'").get(entidad.id).id;
  const cuenta = cat.crearCuentaFinanciera({ entidadId: entidad.id, cuentaContableId: cuentaPlan, codigo: `B-${codigo}`, nombre: 'Banco', tipo: 'banco', usuarioId: admin });
  const bolsillo = db.prepare("SELECT id FROM fin_bolsillos WHERE entidad_id=? AND tipo='sin_asignar'").get(entidad.id).id;
  return { entidad, cuenta, bolsillo };
}
function movimiento(x, cambios = {}) { return { entidadId: x.entidad.id, usuarioId: admin, tipo: 'ingreso', cuentaFinancieraId: x.cuenta.id, bolsilloId: x.bolsillo, monto: '100.50', motivo: 'Prueba', fecha: '2026-07-01', claveIdempotencia: `manual-${x.entidad.id}`, ...cambios }; }

test('ingreso y egreso manuales afectan tesorería, bolsillo y cuentas operativas', () => {
  const x = base('MM1');
  const ingreso = registrarMovimientoManual(movimiento(x));
  assert.equal(motor.saldo(x.cuenta.id, x.bolsillo).tes, 10050);
  assert.equal(motor.saldo(x.cuenta.id, x.bolsillo).bol, 10050);
  assert.equal(db.prepare("SELECT tipo FROM fin_eventos_financieros WHERE id=?").get(ingreso.evento_financiero_id).tipo, 'ingreso_manual');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM fin_lineas_asiento l JOIN fin_asientos_contables a ON a.id=l.asiento_id JOIN fin_plan_cuentas p ON p.id=l.cuenta_contable_id WHERE a.evento_id=? AND p.codigo='4101'").get(ingreso.evento_financiero_id).n, 1);
  const egreso = registrarMovimientoManual(movimiento(x, { tipo: 'egreso', monto: '20.50', claveIdempotencia: `egreso-${x.entidad.id}` }));
  assert.equal(motor.saldo(x.cuenta.id, x.bolsillo).tes, 8000);
  assert.equal(motor.saldo(x.cuenta.id, x.bolsillo).bol, 8000);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM fin_lineas_asiento l JOIN fin_asientos_contables a ON a.id=l.asiento_id JOIN fin_plan_cuentas p ON p.id=l.cuenta_contable_id WHERE a.evento_id=? AND p.codigo='5201'").get(egreso.evento_financiero_id).n, 1);
});

test('idempotencia no duplica, reutiliza payload y rechaza clave con payload distinto', () => {
  const x = base('MM2'); const primero = registrarMovimientoManual(movimiento(x));
  assert.equal(registrarMovimientoManual(movimiento(x)).evento_financiero_id, primero.evento_financiero_id);
  assert.equal(registrarMovimientoManual(movimiento(x, { claveIdempotencia: 'manual-otra' })).evento_financiero_id, primero.evento_financiero_id);
  assert.throws(() => registrarMovimientoManual(movimiento(x, { monto: '101' })), (e) => e.status === 409);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM fin_eventos_financieros WHERE entidad_id=? AND tipo='ingreso_manual'").get(x.entidad.id).n, 1);
});

test('rechaza referencias de otra entidad y período cerrado', () => {
  const x = base('MM3'); const y = base('MM4');
  assert.throws(() => registrarMovimientoManual(movimiento(x, { cuentaFinancieraId: y.cuenta.id })), (e) => e.status === 404);
  assert.throws(() => registrarMovimientoManual(movimiento(x, { bolsilloId: y.bolsillo })), (e) => e.status === 404);
  db.prepare("UPDATE fin_periodos SET estado='cerrado' WHERE entidad_id=? AND anio=2026 AND mes=7").run(x.entidad.id);
  assert.throws(() => registrarMovimientoManual(movimiento(x, { claveIdempotencia: 'cerrado' })), (e) => e.status === 409 && /período/.test(e.message));
});

test('rollback no deja eventos ni líneas si falla una asignación', () => {
  const x = base('MM5'); db.exec("CREATE TRIGGER fallo_manual BEFORE INSERT ON fin_asignaciones_bolsillo BEGIN SELECT RAISE(ABORT,'fallo manual'); END");
  assert.throws(() => registrarMovimientoManual(movimiento(x)), /fallo manual/);
  db.exec('DROP TRIGGER fallo_manual');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM fin_eventos_financieros WHERE entidad_id=? AND tipo='ingreso_manual'").get(x.entidad.id).n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM fin_lineas_asiento l JOIN fin_asientos_contables a ON a.id=l.asiento_id WHERE a.entidad_id=?').get(x.entidad.id).n, 0);
});
