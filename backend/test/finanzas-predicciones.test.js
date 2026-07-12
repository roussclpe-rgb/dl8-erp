const test = require('node:test');
const assert = require('node:assert/strict');
process.env.DB_PATH = ':memory:';
const { db } = require('../src/db');
const cat = require('../src/services/finanzas/catalogos');
const motor = require('../src/services/finanzas/motor');
const { predicciones } = require('../src/services/finanzas/predicciones');

const admin = Number(db.prepare("INSERT INTO usuarios(nombre,email,password_hash,rol_id) VALUES('Predicciones','predicciones@test','x',1)").run().lastInsertRowid);

test('las predicciones usan datos financieros históricos sin escribir movimientos', () => {
  const entidad = cat.crearEntidadFundacion({ codigo: 'PRED', nombre: 'Predicciones', tipo: 'empresa', fechaInicial: new Date().toISOString().slice(0, 10), usuarioId: admin }).entidad;
  const plan = db.prepare("SELECT id FROM fin_plan_cuentas WHERE entidad_id=? AND codigo='1101'").get(entidad.id).id;
  const cuenta = cat.crearCuentaFinanciera({ entidadId: entidad.id, cuentaContableId: plan, codigo: 'BAN', nombre: 'Banco', tipo: 'banco', usuarioId: admin });
  const libre = db.prepare("SELECT id FROM fin_bolsillos WHERE entidad_id=? AND tipo='sin_asignar'").get(entidad.id).id;
  const impuestos = cat.crearBolsillo({ entidadId: entidad.id, codigo: 'IMP', nombre: 'Impuestos', tipo: 'impuestos', usuarioId: admin });
  motor.inicial(entidad.id, admin, 'pred-inicial', { cuenta_financiera_id: cuenta.id, bolsillo_id: libre, importe_minor: 100000, fecha: new Date().toISOString().slice(0, 10) });
  db.prepare('INSERT INTO mpf_metas_bolsillo(entidad_id,bolsillo_id,meta_minor,actualizado_por) VALUES(?,?,?,?)').run(entidad.id, impuestos.id, 50000, admin);
  const antes = db.prepare('SELECT COUNT(*) n FROM fin_eventos_financieros').get().n;
  const salida = predicciones(entidad.id, { horizonte: 30 });
  assert.equal(salida.estado, 'ok');
  assert.equal(salida.flujo_caja.length, 3);
  assert.equal(salida.flujo_caja[0].dias, 30);
  assert.ok(salida.confianza_pct >= 45);
  assert.ok(salida.datos_utilizados.dias_con_movimiento >= 1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM fin_eventos_financieros').get().n, antes);
});

test('las predicciones devuelven estado vacío cuando no existe historial', () => {
  const entidad = cat.crearEntidadFundacion({ codigo: 'VAC', nombre: 'Vacía', tipo: 'empresa', fechaInicial: new Date().toISOString().slice(0, 10), usuarioId: admin }).entidad;
  assert.equal(predicciones(entidad.id, { horizonte: 90 }).estado, 'sin_datos');
});
