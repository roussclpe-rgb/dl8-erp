const test = require('node:test');
const assert = require('node:assert/strict');
process.env.DB_PATH=':memory:';
const {db}=require('../src/db');
const cat=require('../src/services/finanzas/catalogos');
const motor=require('../src/services/finanzas/motor');
const admin=Number(db.prepare("INSERT INTO usuarios(nombre,email,password_hash,rol_id)VALUES('Motor','motor@test','x',1)").run().lastInsertRowid);
function base(codigo){const e=cat.crearEntidadFundacion({codigo,nombre:codigo,tipo:'empresa',fechaInicial:'2026-07-01',usuarioId:admin}).entidad;const pc=db.prepare("SELECT id FROM fin_plan_cuentas WHERE entidad_id=? AND codigo='1101'").get(e.id).id;const c1=cat.crearCuentaFinanciera({entidadId:e.id,cuentaContableId:pc,codigo:'C1',nombre:'Caja',tipo:'caja',usuarioId:admin});const c2=cat.crearCuentaFinanciera({entidadId:e.id,cuentaContableId:pc,codigo:'C2',nombre:'Banco',tipo:'banco',usuarioId:admin});const b=db.prepare("SELECT id FROM fin_bolsillos WHERE entidad_id=? AND tipo='sin_asignar'").get(e.id).id;const b2=cat.crearBolsillo({entidadId:e.id,codigo:'OP',nombre:'Operacion',tipo:'operacion',usuarioId:admin});return{e,c1,c2,b,b2}}
test('saldo inicial crea asiento, tesorería y respaldo',()=>{const x=base('M1');const r=motor.inicial(x.e.id,admin,'i1',{cuenta_financiera_id:x.c1.id,bolsillo_id:x.b,importe_minor:50000,fecha:'2026-07-01'});assert.equal(motor.saldo(x.c1.id,x.b).tes,50000);assert.equal(motor.saldo(x.c1.id,x.b).bol,50000);assert.equal(db.prepare('SELECT COUNT(*) n FROM fin_lineas_asiento WHERE asiento_id IN(SELECT id FROM fin_asientos_contables WHERE evento_id=?)').get(r.id).n,2)});
test('transferencia conserva total y mueve respaldo',()=>{const x=base('M2');motor.inicial(x.e.id,admin,'i2',{cuenta_financiera_id:x.c1.id,bolsillo_id:x.b,importe_minor:50000,fecha:'2026-07-01'});motor.transferencia(x.e.id,admin,'t2',{cuenta_origen_id:x.c1.id,cuenta_destino_id:x.c2.id,bolsillo_origen_id:x.b,importe_minor:20000,fecha:'2026-07-01'});assert.equal(motor.saldo(x.c1.id,x.b).tes,30000);assert.equal(motor.saldo(x.c2.id,x.b).tes,20000);assert.equal(motor.saldo(x.c2.id,x.b).bol,20000)});
test('reasignación no afecta tesorería',()=>{const x=base('M3');motor.inicial(x.e.id,admin,'i3',{cuenta_financiera_id:x.c1.id,bolsillo_id:x.b,importe_minor:50000,fecha:'2026-07-01'});motor.reasignar(x.e.id,admin,'r3',{cuenta_financiera_id:x.c1.id,bolsillo_origen_id:x.b,bolsillo_destino_id:x.b2.id,importe_minor:10000,fecha:'2026-07-01'});assert.equal(motor.saldo(x.c1.id,x.b).tes,50000);assert.equal(motor.saldo(x.c1.id,x.b).bol,40000);assert.equal(motor.saldo(x.c1.id,x.b2.id).bol,10000)});
test('reversión deja efecto neto cero y no permite doble reversión',()=>{const x=base('M4');const a=motor.inicial(x.e.id,admin,'i4',{cuenta_financiera_id:x.c1.id,bolsillo_id:x.b,importe_minor:50000,fecha:'2026-07-01'});motor.revertir({entidadId:x.e.id,eventoId:a.id,usuarioId:admin,clave:'v4'});assert.equal(motor.saldo(x.c1.id,x.b).tes,0);assert.equal(motor.saldo(x.c1.id,x.b).bol,0);assert.throws(()=>motor.revertir({entidadId:x.e.id,eventoId:a.id,usuarioId:admin,clave:'v4b'}),/revertido/)});
test('idempotencia no duplica y rechaza payload distinto',()=>{const x=base('M5');const p={cuenta_financiera_id:x.c1.id,bolsillo_id:x.b,importe_minor:10000,fecha:'2026-07-01'};const a=motor.inicial(x.e.id,admin,'idem',p),b=motor.inicial(x.e.id,admin,'idem',p);assert.equal(a.id,b.id);assert.equal(motor.saldo(x.c1.id,x.b).tes,10000);assert.throws(()=>motor.inicial(x.e.id,admin,'idem',{...p,importe_minor:2}),e=>e.status===409)});
test('rechaza saldo negativo y referencias de otra entidad',()=>{const x=base('M6'),y=base('M7');assert.throws(()=>motor.transferencia(x.e.id,admin,'neg',{cuenta_origen_id:x.c1.id,cuenta_destino_id:x.c2.id,bolsillo_origen_id:x.b,importe_minor:1,fecha:'2026-07-01'}),/insuficiente/);assert.throws(()=>motor.inicial(x.e.id,admin,'cross',{cuenta_financiera_id:y.c1.id,bolsillo_id:x.b,importe_minor:1,fecha:'2026-07-01'}),/no pertenece/);assert.throws(()=>motor.inicial(x.e.id,admin,'crossb',{cuenta_financiera_id:x.c1.id,bolsillo_id:y.b,importe_minor:1,fecha:'2026-07-01'}),/no pertenece/)});
test('rollback no deja evento ante fallo inducido',()=>{const x=base('M8');db.exec("CREATE TRIGGER fallo_motor BEFORE INSERT ON fin_asignaciones_bolsillo BEGIN SELECT RAISE(ABORT,'fallo'); END");assert.throws(()=>motor.inicial(x.e.id,admin,'fallo',{cuenta_financiera_id:x.c1.id,bolsillo_id:x.b,importe_minor:1,fecha:'2026-07-01'}),/fallo/);db.exec('DROP TRIGGER fallo_motor');assert.equal(motor.eventos(x.e.id).length,0)});

test('la reversión referencia al original sin actualizar eventos confirmados',()=>{
  const x=base('M9');
  const original=motor.inicial(x.e.id,admin,'i9',{cuenta_financiera_id:x.c1.id,bolsillo_id:x.b,importe_minor:50000,fecha:'2026-07-01'});
  const reversion=motor.revertir({entidadId:x.e.id,eventoId:original.id,usuarioId:admin,clave:'v9'});
  assert.deepEqual(db.prepare('SELECT estado,reversion_de_id FROM fin_eventos_financieros WHERE id=?').get(original.id),{estado:'confirmado',reversion_de_id:null});
  assert.deepEqual(db.prepare('SELECT estado,reversion_de_id FROM fin_eventos_financieros WHERE id=?').get(reversion.id),{estado:'confirmado',reversion_de_id:original.id});
  assert.equal(motor.eventos(x.e.id).find(e=>e.id===original.id).estado,'revertido');
  assert.throws(()=>db.prepare("UPDATE fin_eventos_financieros SET descripcion='cambio' WHERE id=?").run(original.id),/inmutables/);
});

test('aporte y préstamo recibido no se registran como utilidad operativa',()=>{
  const x=base('M10');
  const aporte=motor.aporteSocio(x.e.id,admin,'ap1',{cuenta_financiera_id:x.c1.id,bolsillo_id:x.b,importe_minor:10000,fecha:'2026-07-01'});
  const prestamo=motor.prestamoRecibido(x.e.id,admin,'pr1',{cuenta_financiera_id:x.c1.id,bolsillo_id:x.b,importe_minor:5000,fecha:'2026-07-01'});
  assert.equal(db.prepare('SELECT tipo FROM fin_eventos_financieros WHERE id=?').get(aporte.id).tipo,'aporte_socio');
  assert.equal(db.prepare('SELECT tipo FROM fin_eventos_financieros WHERE id=?').get(prestamo.id).tipo,'prestamo_recibido');
  assert.equal(motor.saldo(x.c1.id,x.b).tes,15000);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM fin_lineas_asiento l JOIN fin_asientos_contables a ON a.id=l.asiento_id JOIN fin_plan_cuentas p ON p.id=l.cuenta_contable_id WHERE a.evento_id IN(?,?) AND p.codigo='4101'").get(aporte.id,prestamo.id).n,0);
});

test('dónde está mi dinero concilia ubicación, bolsillos y dinero sin asignar',()=>{
  const x=base('M11');
  motor.inicial(x.e.id,admin,'m11',{cuenta_financiera_id:x.c1.id,bolsillo_id:x.b,importe_minor:10000,fecha:'2026-07-01'});
  motor.reasignar(x.e.id,admin,'m11-r',{cuenta_financiera_id:x.c1.id,bolsillo_origen_id:x.b,bolsillo_destino_id:x.b2.id,importe_minor:4000,fecha:'2026-07-01'});
  const vista=motor.dondeEstaDinero(x.e.id);
  assert.equal(vista.conciliacion.saldo_fisico_minor,10000);
  assert.equal(vista.conciliacion.asignado_minor,10000);
  assert.equal(vista.conciliacion.diferencia_minor,0);
  assert.equal(vista.finalidades.find(x=>x.nombre==='sin_asignar').saldo_minor,6000);
  assert.ok(vista.alertas.some(x=>x.tipo==='sin_asignar'));
});
