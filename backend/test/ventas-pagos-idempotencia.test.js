const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

process.env.NODE_ENV = 'development';
process.env.DB_PATH = ':memory:';
const { db, obtenerOCrearPeriodo } = require('../src/db');
const { generarToken } = require('../src/auth');
const catalogos = require('../src/services/finanzas/catalogos');
const caja = require('../src/services/caja');

const admin = Number(db.prepare("INSERT INTO usuarios(nombre,email,password_hash,rol_id)VALUES('Ventas','ventas-idem@test','x',1)").run().lastInsertRowid);
const token = generarToken({ id: admin, nombre: 'Ventas', rol_nombre: 'admin' });
const entidad = catalogos.crearEntidadFundacion({ codigo: 'VENTAS_HTTP', nombre: 'Ventas HTTP', tipo: 'empresa', fechaInicial: '2026-07-01', usuarioId: admin }).entidad;
const planCaja = db.prepare("SELECT id FROM fin_plan_cuentas WHERE entidad_id=? AND codigo='1101'").get(entidad.id).id;
const cuentaCaja = catalogos.crearCuentaFinanciera({ entidadId: entidad.id, cuentaContableId: planCaja, codigo: 'CAJA_HTTP', nombre: 'Caja HTTP', tipo: 'caja', usuarioId: admin });
const cuentaBanco = catalogos.crearCuentaFinanciera({ entidadId: entidad.id, cuentaContableId: planCaja, codigo: 'BANCO_HTTP', nombre: 'Banco HTTP', tipo: 'banco', usuarioId: admin });
const cajaId = Number(db.prepare('INSERT INTO cajas(nombre,entidad_id,cuenta_financiera_id) VALUES(?,?,?)').run('Caja HTTP', entidad.id, cuentaCaja.id).lastInsertRowid);
const turnoId = caja.abrirTurno({ cajaId, usuarioId: admin });
const clienteId = Number(db.prepare("INSERT INTO clientes(nombre,tipo,usuario_id) VALUES('Cliente HTTP','minorista',?)").run(admin).lastInsertRowid);
const periodo = obtenerOCrearPeriodo('2026-07-01');
const crearVenta = (folio) => Number(db.prepare('INSERT INTO ventas(folio,fecha,cliente_id,periodo_id,subtotal,total,usuario_id) VALUES(?,?,?,?,?,?,?)').run(folio, '2026-07-01', clienteId, periodo.id, 50, 50, admin).lastInsertRowid);

const app = express();
app.use(express.json());
app.use('/api/caja', require('../src/routes/caja'));
app.use('/api/ventas', require('../src/routes/ventas.routes.v2'));
let server, baseUrl;
test.before(async () => { server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); }); baseUrl = `http://127.0.0.1:${server.address().port}`; });
test.after(async () => new Promise((resolve) => server.close(resolve)));
const pedir = (path, method, body, key) => fetch(`${baseUrl}${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) }, body: body && JSON.stringify(body) });

test('configura una caja histórica y los pagos HTTP son idempotentes y atómicos', async () => {
  const pendiente = Number(db.prepare('INSERT INTO cajas(nombre) VALUES(?)').run('Caja histórica').lastInsertRowid);
  let response = await pedir(`/api/caja/${pendiente}/configuracion-financiera`, 'PATCH', { entidad_id: entidad.id, cuenta_financiera_id: cuentaBanco.id });
  assert.equal(response.status, 404, 'rechaza una cuenta que no es caja');
  response = await pedir(`/api/caja/${pendiente}/configuracion-financiera`, 'PATCH', { entidad_id: entidad.id + 999, cuenta_financiera_id: cuentaCaja.id });
  assert.equal(response.status, 403, 'rechaza entidad sin acceso');
  const otraEntidad = catalogos.crearEntidadFundacion({ codigo: 'OTRA_HTTP', nombre: 'Otra HTTP', tipo: 'empresa', fechaInicial: '2026-07-01', usuarioId: admin }).entidad;
  response = await pedir(`/api/caja/${pendiente}/configuracion-financiera`, 'PATCH', { entidad_id: otraEntidad.id, cuenta_financiera_id: cuentaCaja.id });
  assert.equal(response.status, 404, 'rechaza una cuenta de otra entidad');
  response = await pedir(`/api/caja/${pendiente}/configuracion-financiera`, 'PATCH', { entidad_id: entidad.id, cuenta_financiera_id: cuentaCaja.id });
  assert.equal(response.status, 409, 'no permite reutilizar la cuenta de otra caja activa');
  const cuentaHistorica = catalogos.crearCuentaFinanciera({ entidadId: entidad.id, cuentaContableId: planCaja, codigo: 'CAJA_HIST', nombre: 'Caja histórica', tipo: 'caja', usuarioId: admin });
  response = await pedir(`/api/caja/${pendiente}/configuracion-financiera`, 'PATCH', { entidad_id: entidad.id, cuenta_financiera_id: cuentaHistorica.id });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).cuenta_financiera_id, cuentaHistorica.id);

  const ventaId = crearVenta(1);
  const payload = { pagos: [{ monto: 12, metodoPago: 'Efectivo' }], turno_caja_id: turnoId };
  response = await pedir(`/api/ventas/${ventaId}/pagos`, 'POST', payload, 'pago-http-1');
  assert.equal(response.status, 200);
  const primero = await response.json();
  response = await pedir(`/api/ventas/${ventaId}/pagos`, 'POST', payload, 'pago-http-1');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), primero);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM pagos WHERE venta_id=?').get(ventaId).n, 1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM fin_eventos_financieros WHERE tipo='cobro_venta'").get().n, 1);
  response = await pedir(`/api/ventas/${ventaId}/pagos`, 'POST', { ...payload, pagos: [{ monto: 13, metodoPago: 'Efectivo' }] }, 'pago-http-1');
  assert.equal(response.status, 409);

  const ventaConFallo = crearVenta(2);
  db.exec("CREATE TRIGGER fallo_cobro BEFORE INSERT ON fin_asignaciones_bolsillo BEGIN SELECT RAISE(ABORT,'fallo financiero'); END");
  response = await pedir(`/api/ventas/${ventaConFallo}/pagos`, 'POST', payload, 'pago-http-fallo');
  assert.equal(response.status, 400);
  db.exec('DROP TRIGGER fallo_cobro');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM pagos WHERE venta_id=?').get(ventaConFallo).n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM fin_eventos_financieros WHERE tipo='cobro_venta'").get().n, 1);
});
