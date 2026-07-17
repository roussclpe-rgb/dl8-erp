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
  const cuenta = cat.crearCuentaFinanciera({ entidadId: entidad.id, cuentaContableId: cuentaPlan, codigo: 'YAPE', nombre: 'Yape', tipo: 'billetera', proveedor: 'yape', usuarioId: admin });
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

test('MPF aplica la única política activa aunque no esté marcada como predeterminada', () => {
  const x = base('MPF-ACTIVA-UNICA');
  const politica = mpf.crear({ entidadId: x.entidad.id, nombre: 'Ventas activas', usuarioId: admin, activar: true, reglas: [
    { nombre: 'Marketing', base: 'ingreso', tipo: 'porcentaje', valor_minor: 10000, bolsillo_id: x.marketing.id },
  ] });
  const evento = motor.inicial(x.entidad.id, admin, 'mpf-activa-unica', { cuenta_financiera_id: x.cuenta.id, bolsillo_id: x.sinAsignar, importe_minor: 1000, fecha: '2026-07-01' });
  const aplicado = mpf.aplicarACobro({ entidadId: x.entidad.id, eventoFinancieroId: evento.id, cuentaFinancieraId: x.cuenta.id, bolsilloOrigenId: x.sinAsignar, importeIngresoMinor: 1000 });
  assert.equal(aplicado.politica_id, politica.id);
  assert.equal(motor.saldo(x.cuenta.id, x.marketing.id).bol, 1000);
});

test('la fecha de activación no procesa históricos y bloquea el modo automático retroactivo', () => {
  const x = base('MPF-FECHA');
  const politica = mpf.crear({ entidadId: x.entidad.id, nombre: 'Desde hoy', usuarioId: admin, reglas: [{ nombre: 'Marketing', base: 'ingreso', tipo: 'porcentaje', valor_minor: 10000, bolsillo_id: x.marketing.id }] });
  mpf.activar({ entidadId: x.entidad.id, politicaId: politica.id, predeterminada: true, fechaActivacion: '2026-07-14' });
  const anterior = motor.inicial(x.entidad.id, admin, 'fecha-anterior', { cuenta_financiera_id: x.cuenta.id, bolsillo_id: x.sinAsignar, importe_minor: 1000, fecha: '2026-07-13' });
  assert.equal(mpf.aplicarACobro({ entidadId: x.entidad.id, eventoFinancieroId: anterior.id, cuentaFinancieraId: x.cuenta.id, bolsilloOrigenId: x.sinAsignar, importeIngresoMinor: 1000, contexto: { fecha: '2026-07-13' } }), null);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM mpf_aplicaciones WHERE evento_financiero_id=?').get(anterior.id).n, 0);
  assert.throws(() => mpf.procesarCobrosSinPolitica({ entidadId: x.entidad.id, politicaId: politica.id, modo: 'desde_fecha', fechaElegida: '2026-07-14', usuarioId: admin }), /selección manual/);
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

test('MPF soporta costo real, fijo por unidad y no recuperar costo con snapshots auditables', () => {
  const x = base('MPF-COSTOS');
  const crearEvento = (clave) => motor.inicial(x.entidad.id, admin, clave, { cuenta_financiera_id: x.cuenta.id, bolsillo_id: x.sinAsignar, importe_minor: 10000, fecha: '2026-07-01' });
  const real = mpf.crear({ entidadId: x.entidad.id, nombre: 'Real', usuarioId: admin, activar: true, predeterminada: true, modoRecuperacionCosto: 'real_calculado', bolsilloCostoId: x.marketing.id, reglas: [{ nombre: 'Utilidad', base: 'ingreso', tipo: 'porcentaje', valor_minor: 10000, bolsillo_id: x.utilidad.id }] });
  const eventoReal = crearEvento('mpf-real');
  const aplicadoReal = mpf.aplicarACobro({ entidadId: x.entidad.id, eventoFinancieroId: eventoReal.id, cuentaFinancieraId: x.cuenta.id, bolsilloOrigenId: x.sinAsignar, importeIngresoMinor: 10000, costoMinor: 2400, contexto: { costo_real_disponible: true, cantidad_cobro: 2, costo_pendiente_minor: 2400 } });
  assert.equal(aplicadoReal.costo_recuperado_minor, 2400);
  assert.equal(mpf.historialEvento(x.entidad.id, eventoReal.id).modo_recuperacion_costo, 'real_calculado');
  db.prepare("UPDATE mpf_politicas SET estado='inactiva',es_predeterminada=0 WHERE id=?").run(real.id);
  const fijo = mpf.crear({ entidadId: x.entidad.id, nombre: 'Fijo', usuarioId: admin, activar: true, predeterminada: true, modoRecuperacionCosto: 'fijo_unidad', costoFijoUnidadMinor: 300, monedaCostoFijo: 'PEN', bolsilloCostoId: x.marketing.id, reglas: [{ nombre: 'Utilidad', base: 'ingreso', tipo: 'porcentaje', valor_minor: 10000, bolsillo_id: x.utilidad.id }] });
  const eventoFijo = crearEvento('mpf-fijo');
  const aplicadoFijo = mpf.aplicarACobro({ entidadId: x.entidad.id, eventoFinancieroId: eventoFijo.id, cuentaFinancieraId: x.cuenta.id, bolsilloOrigenId: x.sinAsignar, importeIngresoMinor: 10000, contexto: { cantidad_cobro: 3, cantidad_total_venta: 3, costo_recuperado_venta_minor: 0 } });
  assert.equal(aplicadoFijo.costo_recuperado_minor, 900);
  assert.equal(db.prepare("SELECT costo_unidad_minor,cantidad_costo,origen_calculo_costo FROM mpf_aplicaciones WHERE id=?").get(aplicadoFijo.aplicacion_id).origen_calculo_costo, 'fijo_unidad');
  db.prepare("UPDATE mpf_politicas SET estado='inactiva',es_predeterminada=0 WHERE id=?").run(fijo.id);
  const sin = mpf.crear({ entidadId: x.entidad.id, nombre: 'Sin costo', usuarioId: admin, activar: true, predeterminada: true, modoRecuperacionCosto: 'no_recuperar', reglas: [{ nombre: 'Utilidad', base: 'ingreso', tipo: 'porcentaje', valor_minor: 10000, bolsillo_id: x.utilidad.id }] });
  const eventoSin = crearEvento('mpf-sin');
  assert.equal(mpf.aplicarACobro({ entidadId: x.entidad.id, eventoFinancieroId: eventoSin.id, cuentaFinancieraId: x.cuenta.id, bolsilloOrigenId: x.sinAsignar, importeIngresoMinor: 10000, costoMinor: 9000 }).costo_recuperado_minor, 0);
  assert.equal(sin.modo_recuperacion_costo, 'no_recuperar'); assert.equal(real.modo_recuperacion_costo, 'real_calculado'); assert.equal(fijo.modo_recuperacion_costo, 'fijo_unidad');
});

test('MPF recupera el costo fijo configurado para cada producto vendido', () => {
  const x = base('MPF-FIJO-PRODUCTO');
  db.prepare('INSERT INTO productos_venta(receta_grupo_id,precio_normal,precio_mayorista,usuario_id) VALUES(?,?,?,?)').run(101, 10, 9, admin);
  db.prepare('INSERT INTO productos_venta(receta_grupo_id,precio_normal,precio_mayorista,usuario_id) VALUES(?,?,?,?)').run(202, 10, 9, admin);
  const politica = mpf.crear({ entidadId: x.entidad.id, nombre: 'Fijo por producto', usuarioId: admin, activar: true, predeterminada: true, modoRecuperacionCosto: 'fijo_unidad', bolsilloCostoId: x.marketing.id,
    costosFijosProducto: [{ receta_grupo_id: 101, costo_unidad_minor: 125, moneda: 'PEN' }, { receta_grupo_id: 202, costo_unidad_minor: 350, moneda: 'PEN' }],
    reglas: [{ nombre: 'Utilidad', base: 'ingreso', tipo: 'porcentaje', valor_minor: 10000, bolsillo_id: x.utilidad.id }], });
  assert.deepEqual(mpf.detallePolitica(x.entidad.id, politica.id).costos_fijos_producto.map((c) => c.costo_unidad_minor), [125, 350]);
  const evento = motor.inicial(x.entidad.id, admin, 'mpf-fijo-producto', { cuenta_financiera_id: x.cuenta.id, bolsillo_id: x.sinAsignar, importe_minor: 5000, fecha: '2026-07-01' });
  const aplicado = mpf.aplicarACobro({ entidadId: x.entidad.id, eventoFinancieroId: evento.id, cuentaFinancieraId: x.cuenta.id, bolsilloOrigenId: x.sinAsignar, importeIngresoMinor: 5000,
    contexto: { cantidad_cobro: 3, cantidad_total_venta: 3, costo_recuperado_venta_minor: 0, productos_venta: [{ receta_grupo_id: 101, cantidad_cobro: 2, cantidad_total: 2 }, { receta_grupo_id: 202, cantidad_cobro: 1, cantidad_total: 1 }] } });
  assert.equal(aplicado.costo_recuperado_minor, 600);
  assert.equal(aplicado.origen_calculo_costo, 'fijo_unidad_producto');
});

test('MPF completa una meta y redirige automáticamente el siguiente cobro', () => {
  const x = base('MPF-META-AUTO');
  const meta = mpf.crearMetaFinanciera({ entidadId: x.entidad.id, nombre: 'Alquiler Agosto', montoObjetivoMinor: 1000, bolsilloId: x.marketing.id, usuarioId: admin });
  const politica = mpf.crear({ entidadId: x.entidad.id, nombre: 'Meta automática', usuarioId: admin, activar: true, predeterminada: true, reglas: [
    { nombre: 'Alquiler', base: 'ingreso', tipo: 'porcentaje', valor_minor: 10000, bolsillo_id: x.marketing.id, meta_id: meta.id, meta_accion_cumplida: 'redirigir_bolsillo', meta_bolsillo_redireccion_id: x.utilidad.id },
    { nombre: 'Utilidad', base: 'remanente', tipo: 'importe_fijo', valor_minor: 0, bolsillo_id: x.utilidad.id, accion: 'resto' },
  ] });
  const primero = motor.inicial(x.entidad.id, admin, 'meta-auto-1', { cuenta_financiera_id: x.cuenta.id, bolsillo_id: x.sinAsignar, importe_minor: 1000, fecha: '2026-07-01' });
  const aplicado = mpf.aplicarACobro({ entidadId: x.entidad.id, eventoFinancieroId: primero.id, cuentaFinancieraId: x.cuenta.id, bolsilloOrigenId: x.sinAsignar, importeIngresoMinor: 1000 });
  const cumplida = db.prepare('SELECT estado,cumplida_evento_financiero_id,cumplida_por FROM mpf_metas_financieras WHERE id=?').get(meta.id);
  assert.deepEqual(cumplida, { estado: 'cumplida', cumplida_evento_financiero_id: primero.id, cumplida_por: admin });
  assert.deepEqual(aplicado.metas_cumplidas, [meta.id]);
  const segundo = motor.inicial(x.entidad.id, admin, 'meta-auto-2', { cuenta_financiera_id: x.cuenta.id, bolsillo_id: x.sinAsignar, importe_minor: 1000, fecha: '2026-07-01' });
  const redirigido = mpf.aplicarACobro({ entidadId: x.entidad.id, eventoFinancieroId: segundo.id, cuentaFinancieraId: x.cuenta.id, bolsilloOrigenId: x.sinAsignar, importeIngresoMinor: 1000 });
  assert.equal(redirigido.detalles[0].bolsillo_id, x.utilidad.id);
  assert.equal(redirigido.detalles[0].accion_meta_cumplida, 'redirigir_bolsillo');
  assert.equal(politica.estado, 'activa');
});

test('MPF limita costo pendiente en cobros parciales, respeta respaldo, reversión e idempotencia', () => {
  const x = base('MPF-PARCIAL');
  mpf.crear({ entidadId: x.entidad.id, nombre: 'Parcial', usuarioId: admin, activar: true, predeterminada: true, modoRecuperacionCosto: 'real_calculado', respaldoCostoReal: 'fijo_unidad', costoFijoUnidadMinor: 500, monedaCostoFijo: 'PEN', bolsilloCostoId: x.marketing.id, reglas: [{ nombre: 'Utilidad', base: 'ingreso', tipo: 'porcentaje', valor_minor: 10000, bolsillo_id: x.utilidad.id }] });
  const primero = motor.inicial(x.entidad.id, admin, 'mpf-parcial-1', { cuenta_financiera_id: x.cuenta.id, bolsillo_id: x.sinAsignar, importe_minor: 5000, fecha: '2026-07-01' });
  const a = mpf.aplicarACobro({ entidadId: x.entidad.id, eventoFinancieroId: primero.id, cuentaFinancieraId: x.cuenta.id, bolsilloOrigenId: x.sinAsignar, importeIngresoMinor: 5000, contexto: { costo_real_disponible: false, cantidad_cobro: 1, cantidad_total_venta: 2, costo_recuperado_venta_minor: 0 } });
  assert.equal(a.costo_recuperado_minor, 500); assert.match(a.advertencia_costo, /No existe/);
  assert.equal(mpf.aplicarACobro({ entidadId: x.entidad.id, eventoFinancieroId: primero.id, cuentaFinancieraId: x.cuenta.id, bolsilloOrigenId: x.sinAsignar, importeIngresoMinor: 5000 }).repetido, true);
  const segundo = motor.inicial(x.entidad.id, admin, 'mpf-parcial-2', { cuenta_financiera_id: x.cuenta.id, bolsillo_id: x.sinAsignar, importe_minor: 5000, fecha: '2026-07-01' });
  const b = mpf.aplicarACobro({ entidadId: x.entidad.id, eventoFinancieroId: segundo.id, cuentaFinancieraId: x.cuenta.id, bolsilloOrigenId: x.sinAsignar, importeIngresoMinor: 5000, contexto: { costo_real_disponible: false, cantidad_cobro: 1, cantidad_total_venta: 2, costo_recuperado_venta_minor: 500 } });
  assert.equal(b.costo_recuperado_minor, 500);
  // La anulación de ventas usa la reversión de dominio ya cubierta por ventas-cobros-cxc;
  // las reservas MPF son asignaciones del mismo evento y se revierten junto con él.
  db.prepare("UPDATE mpf_politicas SET estado='inactiva',es_predeterminada=0 WHERE entidad_id=? AND nombre='Parcial'").run(x.entidad.id);
  const bloqueada = mpf.crear({ entidadId: x.entidad.id, nombre: 'Bloquear', usuarioId: admin, activar: true, predeterminada: true, modoRecuperacionCosto: 'real_calculado', respaldoCostoReal: 'bloquear', bolsilloCostoId: x.marketing.id, reglas: [{ nombre: 'Utilidad', base: 'ingreso', tipo: 'porcentaje', valor_minor: 10000, bolsillo_id: x.utilidad.id }] });
  const tercero = motor.inicial(x.entidad.id, admin, 'mpf-bloqueo', { cuenta_financiera_id: x.cuenta.id, bolsillo_id: x.sinAsignar, importe_minor: 100, fecha: '2026-07-01' });
  assert.throws(() => mpf.aplicarACobro({ entidadId: x.entidad.id, eventoFinancieroId: tercero.id, cuentaFinancieraId: x.cuenta.id, bolsilloOrigenId: x.sinAsignar, importeIngresoMinor: 100, contexto: { costo_real_disponible: false } }), /bloquea/); assert.equal(bloqueada.respaldo_costo_real, 'bloquear');
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

test('la distribución combina porcentaje, monto fijo y un único resto automático', () => {
  const x = base('MPF-RESTO');
  const p = mpf.crear({ entidadId: x.entidad.id, nombre: 'Reparto fácil', usuarioId: admin, reglas: [
    { nombre: 'Marketing', base: 'ingreso', tipo: 'porcentaje', valor_minor: 2000, bolsillo_id: x.marketing.id },
    { nombre: 'Reserva fija', base: 'remanente', tipo: 'importe_fijo', valor_minor: 2000, bolsillo_id: x.utilidad.id },
    { nombre: 'Resto automático', base: 'remanente', tipo: 'importe_fijo', valor_minor: 0, bolsillo_id: x.utilidad.id, accion: 'resto' },
  ] });
  assert.deepEqual(mpf.simular({ entidadId: x.entidad.id, politicaId: p.id, importeIngresoMinor: 10000 }).detalles.map((d) => d.importe_minor), [2000, 2000, 6000]);
  assert.throws(() => mpf.crear({ entidadId: x.entidad.id, nombre: 'Dos restos', usuarioId: admin, reglas: [
    { nombre: 'Uno', base: 'remanente', tipo: 'importe_fijo', valor_minor: 0, bolsillo_id: x.marketing.id, accion: 'resto' },
    { nombre: 'Dos', base: 'remanente', tipo: 'importe_fijo', valor_minor: 0, bolsillo_id: x.utilidad.id, accion: 'resto' },
  ] }), /Solo una regla/);
});

test('elimina políticas sin eventos y conserva las usadas con auditoría', () => {
  const x = base('MPF-ELIMINAR');
  const borrador = mpf.crear({ entidadId: x.entidad.id, nombre: 'Borrador', usuarioId: admin, reglas: [{ nombre: 'Resto', base: 'remanente', tipo: 'importe_fijo', valor_minor: 0, bolsillo_id: x.utilidad.id, accion: 'resto' }] });
  assert.equal(mpf.eliminar({ entidadId: x.entidad.id, politicaId: borrador.id, usuarioId: admin }).ok, true);
  assert.equal(db.prepare('SELECT 1 FROM mpf_politicas WHERE id=?').get(borrador.id), undefined);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM log_auditoria WHERE entidad='mpf_politicas' AND entidad_id=? AND accion='eliminar'").get(borrador.id).n, 1);
  const activa = mpf.crear({ entidadId: x.entidad.id, nombre: 'Activa sin uso', usuarioId: admin, activar: true, predeterminada: true, reglas: [{ nombre: 'Resto', base: 'remanente', tipo: 'importe_fijo', valor_minor: 0, bolsillo_id: x.utilidad.id, accion: 'resto' }] });
  assert.equal(mpf.eliminar({ entidadId: x.entidad.id, politicaId: activa.id, usuarioId: admin }).ok, true);
  const usada = mpf.crear({ entidadId: x.entidad.id, nombre: 'Usada', usuarioId: admin, activar: true, predeterminada: true, reglas: [{ nombre: 'Resto', base: 'remanente', tipo: 'importe_fijo', valor_minor: 0, bolsillo_id: x.utilidad.id, accion: 'resto' }] });
  const evento = motor.inicial(x.entidad.id, admin, 'mpf-eliminar-usada', { cuenta_financiera_id: x.cuenta.id, bolsillo_id: x.sinAsignar, importe_minor: 10000, fecha: '2026-07-01' });
  mpf.aplicarACobro({ entidadId: x.entidad.id, eventoFinancieroId: evento.id, cuentaFinancieraId: x.cuenta.id, bolsilloOrigenId: x.sinAsignar, importeIngresoMinor: 10000 });
  assert.throws(() => mpf.eliminar({ entidadId: x.entidad.id, politicaId: usada.id, usuarioId: admin }), /Esta política ya tiene eventos financieros asociados/);
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

test('MPF abre el siguiente ciclo de una meta recurrente y conserva la regla activa', () => {
  const x = base('MPF-META-RECURRENTE');
  const meta = mpf.crearMetaFinanciera({ entidadId: x.entidad.id, nombre: 'Alquiler mensual', montoObjetivoMinor: 1000, fechaObjetivo: '2026-07-31', tipo: 'recurrente', frecuenciaRecurrencia: 'mensual', bolsilloId: x.marketing.id, usuarioId: admin });
  const politica = mpf.crear({ entidadId: x.entidad.id, nombre: 'Meta recurrente', usuarioId: admin, activar: true, predeterminada: true, reglas: [
    { nombre: 'Alquiler', base: 'ingreso', tipo: 'porcentaje', valor_minor: 10000, bolsillo_id: x.marketing.id, meta_id: meta.id },
  ] });
  const evento = motor.inicial(x.entidad.id, admin, 'meta-recurrente-1', { cuenta_financiera_id: x.cuenta.id, bolsillo_id: x.sinAsignar, importe_minor: 1000, fecha: '2026-07-01' });
  mpf.aplicarACobro({ entidadId: x.entidad.id, eventoFinancieroId: evento.id, cuentaFinancieraId: x.cuenta.id, bolsilloOrigenId: x.sinAsignar, importeIngresoMinor: 1000 });
  const original = db.prepare('SELECT estado FROM mpf_metas_financieras WHERE id=?').get(meta.id);
  const siguiente = db.prepare("SELECT * FROM mpf_metas_financieras WHERE meta_origen_id=? AND estado='activa'").get(meta.id);
  const regla = db.prepare('SELECT meta_id FROM mpf_reglas WHERE politica_id=?').get(politica.id);
  assert.equal(original.estado, 'cumplida');
  assert.equal(siguiente.frecuencia_recurrencia, 'mensual');
  assert.equal(siguiente.fecha_objetivo, '2026-08-31');
  assert.equal(siguiente.saldo_inicial_minor, 1000);
  assert.equal(regla.meta_id, siguiente.id);
});

test('MPF proyecta unidades por producto para una meta sin modificar sus saldos', () => {
  const x = base('MPF-PROYECCION-META');
  const grupo = 88001;
  db.prepare("INSERT INTO recetas(grupo_id,version,nombre_producto,rendimiento,vigente,activo,usuario_id) VALUES(?,?,?,1,1,1,?)").run(grupo, 1, 'Pan proyectado', admin);
  db.prepare('INSERT INTO productos_venta(receta_grupo_id,precio_normal,precio_mayorista,usuario_id) VALUES(?,?,?,?)').run(grupo, 10, 8, admin);
  const meta = mpf.crearMetaFinanciera({ entidadId: x.entidad.id, nombre: 'Alquiler', montoObjetivoMinor: 2500, bolsilloId: x.marketing.id, usuarioId: admin });
  mpf.crear({ entidadId: x.entidad.id, nombre: 'Proyección', usuarioId: admin, activar: true, predeterminada: true, reglas: [{ nombre: 'Alquiler', base: 'ingreso', tipo: 'porcentaje', valor_minor: 10000, bolsillo_id: x.marketing.id }] });
  const antes = mpf.listarMetasFinancieras(x.entidad.id).find((m) => m.id === meta.id).saldo_acumulado_minor;
  const salida = mpf.proyeccionMetaFinanciera(x.entidad.id, meta.id, { precio: 'minorista', dias: 30 });
  const pan = salida.escenario_producto.productos.find((p) => p.receta_grupo_id === grupo);
  assert.equal(salida.meta.faltante_minor, 2500);
  assert.equal(pan.aporte_minor, 1000);
  assert.equal(pan.unidades_necesarias, 3);
  assert.equal(pan.facturacion_minor, 3000);
  assert.equal(salida.mezcla.disponible, false);
  assert.equal(mpf.listarMetasFinancieras(x.entidad.id).find((m) => m.id === meta.id).saldo_acumulado_minor, antes);
});
