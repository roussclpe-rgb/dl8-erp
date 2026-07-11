const test=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');

process.env.NODE_ENV='development';
process.env.DB_PATH=':memory:';
const {db}=require('../src/db');
const {generarToken}=require('../src/auth');
const cat=require('../src/services/finanzas/catalogos');
const motor=require('../src/services/finanzas/motor');

const admin=Number(db.prepare("INSERT INTO usuarios(nombre,email,password_hash,rol_id)VALUES('Admin','admin-respaldo@test','x',1)").run().lastInsertRowid);
const sinAcceso=Number(db.prepare("INSERT INTO usuarios(nombre,email,password_hash,rol_id)VALUES('Sin acceso','sin-acceso-respaldo@test','x',1)").run().lastInsertRowid);
function token(id,nombre){return generarToken({id,nombre,rol_nombre:'admin'})}
function crearEntidad(codigo,usuarioId=admin){const entidad=cat.crearEntidadFundacion({codigo,nombre:codigo,tipo:'empresa',fechaInicial:'2026-07-01',usuarioId}).entidad;const plan=db.prepare("SELECT id FROM fin_plan_cuentas WHERE entidad_id=? AND codigo='1101'").get(entidad.id);const cuenta=cat.crearCuentaFinanciera({entidadId:entidad.id,cuentaContableId:plan.id,codigo:`C_${codigo}`,nombre:`Caja ${codigo}`,tipo:'caja',usuarioId});const bolsillo=db.prepare("SELECT id FROM fin_bolsillos WHERE entidad_id=? AND tipo='sin_asignar'").get(entidad.id);motor.inicial(entidad.id,usuarioId,`inicial-${codigo}`,{cuenta_financiera_id:cuenta.id,bolsillo_id:bolsillo.id,importe_minor:1000,fecha:'2026-07-01'});return{entidad,cuenta,bolsillo}}
const propia=crearEntidad('HTTP_A');
const ajena=crearEntidad('HTTP_B');
const app=express();app.use('/api/finanzas',require('../src/routes/finanzas'));
let server,baseUrl;
test.before(async()=>{server=await new Promise(resolve=>{const s=app.listen(0,()=>resolve(s))});baseUrl=`http://127.0.0.1:${server.address().port}`});
test.after(async()=>new Promise(resolve=>server.close(resolve)));
const pedir=(path,auth)=>fetch(`${baseUrl}${path}`,{headers:auth?{Authorization:`Bearer ${auth}`}:{}});

test('respaldo cuenta-bolsillo exige token y acceso a la entidad',async()=>{
  assert.equal((await pedir(`/api/finanzas/entidades/${propia.entidad.id}/saldos/respaldo-cuenta-bolsillo`)).status,401);
  assert.equal((await pedir(`/api/finanzas/entidades/${propia.entidad.id}/saldos/respaldo-cuenta-bolsillo`,token(sinAcceso,'Sin acceso'))).status,403);
});
test('respaldo cuenta-bolsillo rechaza IDs de otra entidad sin revelarlos',async()=>{
  const auth=token(admin,'Admin');
  assert.equal((await pedir(`/api/finanzas/entidades/${propia.entidad.id}/saldos/respaldo-cuenta-bolsillo?cuenta_financiera_id=${ajena.cuenta.id}`,auth)).status,404);
  assert.equal((await pedir(`/api/finanzas/entidades/${propia.entidad.id}/saldos/respaldo-cuenta-bolsillo?bolsillo_id=${ajena.bolsillo.id}`,auth)).status,404);
});
test('respaldo cuenta-bolsillo autorizado solo devuelve saldos de su entidad',async()=>{
  const response=await pedir(`/api/finanzas/entidades/${propia.entidad.id}/saldos/respaldo-cuenta-bolsillo`,token(admin,'Admin'));
  assert.equal(response.status,200);const saldos=await response.json();assert.deepEqual(saldos,[{cuenta_financiera_id:propia.cuenta.id,bolsillo_id:propia.bolsillo.id,saldo_minor:1000}]);
});
