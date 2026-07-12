const test = require('node:test');
const assert = require('node:assert/strict');
process.env.DB_PATH = ':memory:';
const { db } = require('../src/db');
const catalogos = require('../src/services/finanzas/catalogos');
const alertas = require('../src/services/finanzas/alertas');
const politicas = require('../src/services/finanzas/politicas');

const admin = Number(db.prepare("INSERT INTO usuarios(nombre,email,password_hash,rol_id) VALUES('Alertas','alertas@test','x',1)").run().lastInsertRowid);
function base() {
  const entidad = catalogos.crearEntidadFundacion({ codigo: 'ALT', nombre: 'Alertas', tipo: 'empresa', fechaInicial: '2026-07-01', usuarioId: admin }).entidad;
  const bolsillo = catalogos.crearBolsillo({ entidadId: entidad.id, codigo: 'RES', nombre: 'Reserva', tipo: 'reserva', usuarioId: admin });
  return { entidad, bolsillo };
}

test('alertas configura umbral por entidad, detecta política sin costo y conserva historial', () => {
  const { entidad, bolsillo } = base();
  const politica = politicas.crear({ entidadId: entidad.id, nombre: 'Ventas', usuarioId: admin, activar: true, predeterminada: true, reglas: [{ nombre: 'Reserva', base: 'ingreso', tipo: 'porcentaje', valor_minor: 10000, bolsillo_id: bolsillo.id }] });
  const configuradas = alertas.guardarConfiguracion(entidad.id, [{ tipo: 'meta_proxima_vencer', activa: true, severidad: 'critica', umbral_minor: 14 }]);
  assert.equal(configuradas.find((x) => x.tipo === 'meta_proxima_vencer').umbral_minor, 14);
  const detectadas = alertas.evaluar(entidad.id);
  const costo = detectadas.find((x) => x.tipo === 'costo_no_recuperado');
  assert.ok(costo);
  assert.equal(costo.origen_json.includes(String(politica.id)), true);
  alertas.cambiarEstado(entidad.id, costo.id, 'resuelta', admin);
  assert.equal(alertas.historial(entidad.id, costo.id)[0].estado_nuevo, 'resuelta');
});
