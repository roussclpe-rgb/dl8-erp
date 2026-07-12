const test = require('node:test');
const assert = require('node:assert/strict');
process.env.DB_PATH = ':memory:';
const { db } = require('../src/db');
const cat = require('../src/services/finanzas/catalogos');
const motor = require('../src/services/finanzas/motor');
const mpf = require('../src/services/finanzas/politicas');
const escenarios = require('../src/services/finanzas/escenarios');
const admin = Number(db.prepare("INSERT INTO usuarios(nombre,email,password_hash,rol_id) VALUES('Escenarios','escenarios@test','x',1)").run().lastInsertRowid);

test('un escenario proyecta variaciones y reglas sin modificar datos financieros reales', () => {
  const entidad = cat.crearEntidadFundacion({ codigo: 'ESC', nombre: 'Escenarios', tipo: 'empresa', fechaInicial: '2026-07-01', usuarioId: admin }).entidad;
  const plan = db.prepare("SELECT id FROM fin_plan_cuentas WHERE entidad_id=? AND codigo='1101'").get(entidad.id).id;
  const cuenta = cat.crearCuentaFinanciera({ entidadId: entidad.id, cuentaContableId: plan, codigo: 'BCO', nombre: 'Banco', tipo: 'banco', usuarioId: admin });
  const sin = db.prepare("SELECT id FROM fin_bolsillos WHERE entidad_id=? AND tipo='sin_asignar'").get(entidad.id).id;
  const reserva = cat.crearBolsillo({ entidadId: entidad.id, codigo: 'RES', nombre: 'Reserva', tipo: 'reserva', usuarioId: admin });
  const politica = mpf.crear({ entidadId: entidad.id, nombre: 'Ventas', usuarioId: admin, activar: true, predeterminada: true, recuperaCosto: true, bolsilloCostoId: reserva.id, reglas: [{ nombre: 'Reserva', bolsillo_id: reserva.id, base: 'ingreso', tipo: 'porcentaje', valor_minor: 5000 }] });
  const evento = motor.inicial(entidad.id, admin, 'esc-base', { cuenta_financiera_id: cuenta.id, bolsillo_id: sin, importe_minor: 10000, fecha: new Date().toISOString().slice(0, 10) });
  mpf.aplicarACobro({ entidadId: entidad.id, eventoFinancieroId: evento.id, cuentaFinancieraId: cuenta.id, bolsilloOrigenId: sin, importeIngresoMinor: 10000, costoMinor: 2000 });
  const antes = db.prepare('SELECT COUNT(*) n FROM fin_asignaciones_bolsillo').get().n;
  const salida = escenarios.simular(entidad.id, { periodo_dias: 30, politica_id: politica.id, cambio_precio_pct: 20, cambio_volumen_pct: 10, cambio_costo_pct: 5, cobro_pct: 50, reglas: [{ nombre: 'Todo a reserva', bolsillo_id: reserva.id, porcentaje: 100 }] });
  assert.equal(salida.proyeccion.ingresos_minor, 6600);
  assert.ok(salida.proyeccion.distribucion[0].importe_minor > 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM fin_asignaciones_bolsillo').get().n, antes);
  const guardado = escenarios.guardar({ entidadId: entidad.id, nombre: 'Optimista', configuracion: salida.configuracion, usuarioId: admin });
  assert.equal(escenarios.duplicar({ entidadId: entidad.id, id: guardado.id, usuarioId: admin }).configuracion.periodo_dias, 30);
});
