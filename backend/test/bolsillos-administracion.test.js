const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DB_PATH = ':memory:';
const { db } = require('../src/db');
const catalogos = require('../src/services/finanzas/catalogos');
const motor = require('../src/services/finanzas/motor');

const usuarioId = Number(db.prepare("INSERT INTO usuarios(nombre,email,password_hash,rol_id) VALUES('Bolsillos','bolsillos@test','x',1)").run().lastInsertRowid);

function crearBase(codigo) {
  const entidad = catalogos.crearEntidadFundacion({ codigo, nombre: codigo, tipo: 'empresa', fechaInicial: '2026-07-01', usuarioId }).entidad;
  const cuentaContableId = db.prepare("SELECT id FROM fin_plan_cuentas WHERE entidad_id=? AND codigo='1101'").get(entidad.id).id;
  const cuenta = catalogos.crearCuentaFinanciera({ entidadId: entidad.id, cuentaContableId, codigo: `C-${codigo}`, nombre: 'Caja', tipo: 'caja', usuarioId });
  const sinAsignar = db.prepare("SELECT id FROM fin_bolsillos WHERE entidad_id=? AND tipo='sin_asignar'").get(entidad.id).id;
  return { entidad, cuenta, sinAsignar };
}

test('administra edición y eliminación de bolsillos sin movimientos', () => {
  const { entidad } = crearBase('BOLS-1');
  const bolsillo = catalogos.crearBolsillo({ entidadId: entidad.id, codigo: 'RES', nombre: 'Reserva', tipo: 'reserva', descripcion: 'Inicial', prioridad: 1, saldoMinimo: 10, usuarioId });
  const editado = catalogos.actualizarBolsillo({ entidadId: entidad.id, id: bolsillo.id, nombre: 'Reserva operativa', descripcion: 'Actualizada', prioridad: 2, saldoMinimo: 25.5, permiteSaldoNegativo: true, estado: 'inactiva', usuarioId });
  assert.deepEqual({ nombre: editado.nombre, descripcion: editado.descripcion, prioridad: editado.prioridad, saldo: editado.saldo_minimo_minor, negativo: editado.permite_saldo_negativo, estado: editado.estado }, { nombre: 'Reserva operativa', descripcion: 'Actualizada', prioridad: 2, saldo: 2550, negativo: 1, estado: 'inactiva' });
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM fin_auditoria WHERE entidad_tabla='fin_bolsillos' AND entidad_registro_id=?").get(bolsillo.id).n, 2);
  const eliminado = catalogos.eliminarBolsillo({ entidadId: entidad.id, id: bolsillo.id, usuarioId });
  assert.equal(eliminado.ok, true);
  assert.equal(db.prepare('SELECT 1 FROM fin_bolsillos WHERE id=?').get(bolsillo.id), undefined);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM log_auditoria WHERE entidad='fin_bolsillos' AND entidad_id=? AND accion='eliminar'").get(bolsillo.id).n, 1);
});

test('un bolsillo con movimientos solo puede desactivarse y queda fuera de nuevas operaciones', () => {
  const { entidad, cuenta, sinAsignar } = crearBase('BOLS-2');
  const bolsillo = catalogos.crearBolsillo({ entidadId: entidad.id, codigo: 'OP', nombre: 'Operación', tipo: 'operacion', usuarioId });
  motor.inicial(entidad.id, usuarioId, 'bolsillos-inicial', { cuenta_financiera_id: cuenta.id, bolsillo_id: sinAsignar, importe_minor: 10000, fecha: '2026-07-01' });
  motor.reasignar(entidad.id, usuarioId, 'bolsillos-reasignar', { cuenta_financiera_id: cuenta.id, bolsillo_origen_id: sinAsignar, bolsillo_destino_id: bolsillo.id, importe_minor: 1000, fecha: '2026-07-01' });
  assert.throws(() => catalogos.eliminarBolsillo({ entidadId: entidad.id, id: bolsillo.id, usuarioId }), /no puede eliminarse para preservar la integridad del historial.*puedes desactivarlo/);
  const inactivo = catalogos.cambiarEstadoCatalogo({ tipo: 'bolsillos', entidadId: entidad.id, id: bolsillo.id, estado: 'inactiva', usuarioId });
  assert.equal(inactivo.estado, 'inactiva');
  assert.throws(() => motor.inicial(entidad.id, usuarioId, 'bolsillos-inactivo', { cuenta_financiera_id: cuenta.id, bolsillo_id: bolsillo.id, importe_minor: 1, fecha: '2026-07-01' }), /no pertenece/);
  assert.equal(catalogos.listarPorEntidad('bolsillos', entidad.id).find((item) => item.id === bolsillo.id).estado, 'inactiva');
});
