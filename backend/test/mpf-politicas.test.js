const test = require('node:test');
const assert = require('node:assert/strict');
process.env.DB_PATH = ':memory:';
const { db } = require('../src/db');
const cat = require('../src/services/finanzas/catalogos');
const motor = require('../src/services/finanzas/motor');
const mpf = require('../src/services/finanzas/politicas');

const admin = Number(db.prepare("INSERT INTO usuarios(nombre,email,password_hash,rol_id)VALUES('MPF','mpf@test','x',1)").run().lastInsertRowid);
function base(codigo = 'MPF') {
  const entidad = cat.crearEntidadFundacion({ codigo, nombre: codigo, tipo: 'empresa', fechaInicial: '2026-07-01', usuarioId: admin }).entidad;
  const cuentaPlan = db.prepare("SELECT id FROM fin_plan_cuentas WHERE entidad_id=? AND codigo='1101'").get(entidad.id).id;
  const cuenta = cat.crearCuentaFinanciera({ entidadId: entidad.id, cuentaContableId: cuentaPlan, codigo: 'YAPE', nombre: 'Yape', tipo: 'billetera', usuarioId: admin });
  const sinAsignar = db.prepare("SELECT id FROM fin_bolsillos WHERE entidad_id=? AND tipo='sin_asignar'").get(entidad.id).id;
  const marketing = cat.crearBolsillo({ entidadId: entidad.id, codigo: 'MKT', nombre: 'Marketing', tipo: 'operacion', usuarioId: admin });
  const utilidad = cat.crearBolsillo({ entidadId: entidad.id, codigo: 'UTI', nombre: 'Utilidad', tipo: 'operacion', usuarioId: admin });
  return { entidad, cuenta, sinAsignar, marketing, utilidad };
}

test('MPF simula y reclasifica un cobro sin alterar tesorería ni contabilidad', () => {
  const x = base();
  const politica = mpf.crear({ entidadId: x.entidad.id, nombre: 'Ventas DL8', usuarioId: admin, activar: true, predeterminada: true, reglas: [
    { nombre: 'Marketing', base: 'ingreso', tipo: 'porcentaje', valor_minor: 2000, bolsillo_id: x.marketing.id },
    { nombre: 'Utilidad', base: 'remanente', tipo: 'porcentaje', valor_minor: 5000, bolsillo_id: x.utilidad.id },
  ] });
  const simulacion = mpf.simular({ entidadId: x.entidad.id, politicaId: politica.id, importeIngresoMinor: 10000 });
  assert.deepEqual(simulacion.detalles.map((d) => d.importe_minor), [2000, 4000]);
  assert.equal(simulacion.disponible_minor, 4000);

  const evento = motor.inicial(x.entidad.id, admin, 'mpf-cobro', { cuenta_financiera_id: x.cuenta.id, bolsillo_id: x.sinAsignar, importe_minor: 10000, fecha: '2026-07-01' });
  const aplicado = mpf.aplicarACobro({ entidadId: x.entidad.id, eventoFinancieroId: evento.id, cuentaFinancieraId: x.cuenta.id, bolsilloOrigenId: x.sinAsignar, importeIngresoMinor: 10000 });
  assert.equal(aplicado.distribuido_minor, 6000);
  assert.equal(motor.saldo(x.cuenta.id, x.sinAsignar).tes, 10000);
  assert.equal(motor.saldo(x.cuenta.id, x.sinAsignar).bol, 4000);
  assert.equal(motor.saldo(x.cuenta.id, x.marketing.id).bol, 2000);
  assert.equal(motor.saldo(x.cuenta.id, x.utilidad.id).bol, 4000);
  assert.equal(mpf.historialEvento(x.entidad.id, evento.id).politica, 'Ventas DL8');
});

test('plantilla de panadería crea bolsillos y una política borrador reutilizable', () => {
  const x = base('MPF2');
  const primera = mpf.aplicarPlantilla({ entidadId: x.entidad.id, codigo: 'panaderia', usuarioId: admin });
  assert.equal(primera.existente, false);
  assert.equal(primera.politica.estado, 'borrador');
  assert.equal(mpf.simular({ entidadId: x.entidad.id, politicaId: primera.politica.id, importeIngresoMinor: 10000 }).distribuido_minor, 10000);
  const segunda = mpf.aplicarPlantilla({ entidadId: x.entidad.id, codigo: 'panaderia', usuarioId: admin });
  assert.equal(segunda.existente, true);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM fin_bolsillos WHERE entidad_id=? AND codigo='MARKETING'").get(x.entidad.id).n, 1);
});

test('MPF recupera el costo antes de calcular los porcentajes sobre la utilidad', () => {
  const x = base('MPF3');
  const politica = mpf.crear({ entidadId: x.entidad.id, nombre: 'Con costo', usuarioId: admin, activar: true, predeterminada: true, recuperaCosto: true, bolsilloCostoId: x.marketing.id, reglas: [
    { nombre: 'Utilidad', base: 'ingreso', tipo: 'porcentaje', valor_minor: 10000, bolsillo_id: x.utilidad.id },
  ] });
  const evento = motor.inicial(x.entidad.id, admin, 'mpf-costo', { cuenta_financiera_id: x.cuenta.id, bolsillo_id: x.sinAsignar, importe_minor: 10000, fecha: '2026-07-01' });
  const aplicado = mpf.aplicarACobro({ entidadId: x.entidad.id, eventoFinancieroId: evento.id, cuentaFinancieraId: x.cuenta.id, bolsilloOrigenId: x.sinAsignar, importeIngresoMinor: 10000, costoMinor: 3500 });
  assert.equal(aplicado.costo_recuperado_minor, 3500);
  assert.equal(motor.saldo(x.cuenta.id, x.marketing.id).bol, 3500);
  assert.equal(motor.saldo(x.cuenta.id, x.utilidad.id).bol, 6500);
});

test('resumen MPF informa ingreso, costo recuperado y disponible', () => {
  const x = base('MPF4');
  mpf.crear({ entidadId: x.entidad.id, nombre: 'Resumen', usuarioId: admin, activar: true, predeterminada: true, recuperaCosto: true, bolsilloCostoId: x.marketing.id, reglas: [
    { nombre: 'Utilidad', base: 'ingreso', tipo: 'porcentaje', valor_minor: 5000, bolsillo_id: x.utilidad.id },
  ] });
  const evento = motor.inicial(x.entidad.id, admin, 'mpf-resumen', { cuenta_financiera_id: x.cuenta.id, bolsillo_id: x.sinAsignar, importe_minor: 10000, fecha: '2026-07-01' });
  mpf.aplicarACobro({ entidadId: x.entidad.id, eventoFinancieroId: evento.id, cuentaFinancieraId: x.cuenta.id, bolsilloOrigenId: x.sinAsignar, importeIngresoMinor: 10000, costoMinor: 2000 });
  const resumen = mpf.resumen(x.entidad.id);
  assert.equal(resumen.recibido_minor, 10000);
  assert.equal(resumen.costo_recuperado_minor, 2000);
  assert.equal(resumen.disponible_minor, 4000);
});

test('editar una política crea una nueva versión sin cambiar la anterior', () => {
  const x = base('MPF5');
  const original = mpf.crear({ entidadId: x.entidad.id, nombre: 'Versionable', usuarioId: admin, reglas: [{ nombre: 'Utilidad', base: 'ingreso', tipo: 'porcentaje', valor_minor: 5000, bolsillo_id: x.utilidad.id }] });
  const nueva = mpf.crearVersion({ entidadId: x.entidad.id, politicaId: original.id, usuarioId: admin, reglas: [{ nombre: 'Marketing', base: 'ingreso', tipo: 'porcentaje', valor_minor: 2000, bolsillo_id: x.marketing.id }] });
  assert.equal(original.version, 1);
  assert.equal(nueva.version, 2);
  assert.equal(mpf.simular({ entidadId: x.entidad.id, politicaId: original.id, importeIngresoMinor: 10000 }).distribuido_minor, 5000);
  assert.equal(mpf.simular({ entidadId: x.entidad.id, politicaId: nueva.id, importeIngresoMinor: 10000 }).distribuido_minor, 2000);
});

test('dashboard ejecutivo entrega política activa, totales y eventos MPF', () => {
  const x = base('MPF6');
  const p = mpf.crear({ entidadId: x.entidad.id, nombre: 'Dashboard', usuarioId: admin, activar: true, predeterminada: true, reglas: [{ nombre: 'Utilidad', base: 'ingreso', tipo: 'porcentaje', valor_minor: 5000, bolsillo_id: x.utilidad.id }] });
  const evento = motor.inicial(x.entidad.id, admin, 'mpf-dashboard', { cuenta_financiera_id: x.cuenta.id, bolsillo_id: x.sinAsignar, importe_minor: 10000, fecha: '2026-07-01' });
  mpf.aplicarACobro({ entidadId: x.entidad.id, eventoFinancieroId: evento.id, cuentaFinancieraId: x.cuenta.id, bolsilloOrigenId: x.sinAsignar, importeIngresoMinor: 10000 });
  const dashboard = mpf.dashboardEjecutivo(x.entidad.id);
  assert.equal(dashboard.politica_activa.id, p.id);
  assert.equal(dashboard.recibido_minor, 10000);
  assert.equal(dashboard.reservado_minor, 5000);
  assert.equal(dashboard.eventos_recientes.length, 1);
});

test('metas financieras usan el saldo del bolsillo sin duplicar dinero y versionan el vínculo de regla', () => {
  const x = base('MPF7');
  const meta = mpf.crearMetaFinanciera({ entidadId: x.entidad.id, nombre: 'Horno nuevo', bolsilloId: x.marketing.id, montoObjetivoMinor: 10000, fechaObjetivo: '2026-12-31', usuarioId: admin });
  const politica = mpf.crear({ entidadId: x.entidad.id, nombre: 'Meta vinculada', usuarioId: admin, reglas: [{ nombre: 'Horno', base: 'ingreso', tipo: 'porcentaje', valor_minor: 2500, bolsillo_id: x.marketing.id, meta_id: meta.id }] });
  assert.equal(mpf.detallePolitica(x.entidad.id, politica.id).reglas[0].meta_id, meta.id);
  const evento = motor.inicial(x.entidad.id, admin, 'meta-saldo', { cuenta_financiera_id: x.cuenta.id, bolsillo_id: x.sinAsignar, importe_minor: 10000, fecha: '2026-07-01' });
  mpf.activar({ entidadId: x.entidad.id, politicaId: politica.id, predeterminada: true });
  mpf.aplicarACobro({ entidadId: x.entidad.id, eventoFinancieroId: evento.id, cuentaFinancieraId: x.cuenta.id, bolsilloOrigenId: x.sinAsignar, importeIngresoMinor: 10000 });
  const actualizada = mpf.listarMetasFinancieras(x.entidad.id)[0];
  assert.equal(actualizada.saldo_acumulado_minor, 2500);
  assert.equal(actualizada.porcentaje_avance_minor, 2500);
  mpf.cambiarEstadoMetaFinanciera({ entidadId: x.entidad.id, metaId: meta.id, estado: 'pausada', usuarioId: admin });
  assert.equal(mpf.listarMetasFinancieras(x.entidad.id)[0].estado, 'pausada');
});

test('reglas condicionales se evalúan en simulación y permiten omitir o enviar el resto', () => {
  const x = base('MPF8');
  const p = mpf.crear({ entidadId: x.entidad.id, nombre: 'Condicional', usuarioId: admin, reglas: [
    { nombre: 'Solo Yape', base: 'ingreso', tipo: 'porcentaje', valor_minor: 2000, bolsillo_id: x.marketing.id, condicion: { canal: 'Yape' } },
    { nombre: 'Resto', base: 'remanente', tipo: 'importe_fijo', valor_minor: 0, bolsillo_id: x.utilidad.id, accion: 'resto' },
  ] });
  const yape = mpf.simular({ entidadId: x.entidad.id, politicaId: p.id, importeIngresoMinor: 10000, contexto: { canal: 'Yape' } });
  assert.deepEqual(yape.detalles.map((d) => d.importe_minor), [2000, 8000]);
  const efectivo = mpf.simular({ entidadId: x.entidad.id, politicaId: p.id, importeIngresoMinor: 10000, contexto: { canal: 'Efectivo' } });
  assert.deepEqual(efectivo.detalles.map((d) => d.importe_minor), [0, 10000]);
});

test('una versión conserva condiciones, omisiones, resto y destinos alternativos', () => {
  const x = base('MPF9');
  const destino = cat.crearBolsillo({ entidadId: x.entidad.id, codigo: 'DEST', nombre: 'Destino', tipo: 'reserva', usuarioId: admin });
  const original = mpf.crear({ entidadId: x.entidad.id, nombre: 'Compatible', usuarioId: admin, reglas: [
    { nombre: 'Condicional', base: 'ingreso', tipo: 'porcentaje', valor_minor: 1000, bolsillo_id: x.marketing.id, bolsillo_destino_id: destino.id, condicion: { canal: 'web' } },
    { nombre: 'Omitida', base: 'ingreso', tipo: 'importe_fijo', valor_minor: 500, bolsillo_id: x.utilidad.id, accion: 'omitir' },
    { nombre: 'Resto', base: 'remanente', tipo: 'importe_fijo', valor_minor: 0, bolsillo_id: x.utilidad.id, accion: 'resto' },
  ] });
  const version = mpf.crearVersion({ entidadId: x.entidad.id, politicaId: original.id, usuarioId: admin });
  const reglas = mpf.detallePolitica(x.entidad.id, version.id).reglas;
  assert.equal(reglas[0].bolsillo_destino_id, destino.id);
  assert.equal(JSON.parse(reglas[0].condicion_json).canal, 'web');
  assert.equal(reglas[1].accion, 'omitir');
  assert.equal(reglas[2].accion, 'resto');
  assert.deepEqual(mpf.simular({ entidadId: x.entidad.id, politicaId: version.id, importeIngresoMinor: 10000, contexto: { canal: 'web' } }).detalles.map((d) => d.importe_minor), [1000, 0, 9000]);
});
