const { db } = require('../../db');
const politicas = require('./politicas');

const fallo = (message, status = 400) => Object.assign(new Error(message), { status });
const entero = (value, field, min = 0) => { const n = Number(value); if (!Number.isSafeInteger(n) || n < min) throw fallo(`${field} no es válido`); return n; };
const porcentaje = (value, field) => { const n = Number(value); if (!Number.isFinite(n) || n < 0 || n > 1000) throw fallo(`${field} debe estar entre 0 y 1000`); return n; };
const variacion = (value, field) => { const n = Number(value); if (!Number.isFinite(n) || n < -100 || n > 1000) throw fallo(`${field} debe estar entre -100 y 1000`); return n; };
const fechaInicio = (dias) => { const d = new Date(); d.setDate(d.getDate() - dias); return d.toISOString().slice(0, 10); };

function validarConfiguracion(entidadId, entrada = {}) {
  const periodo_dias = entero(entrada.periodo_dias ?? 30, 'periodo_dias', 1);
  if (![30, 60, 90].includes(periodo_dias)) throw fallo('El período debe ser de 30, 60 o 90 días');
  const politica_id = entero(entrada.politica_id, 'política', 1);
  const politica = db.prepare('SELECT * FROM mpf_politicas WHERE id=? AND entidad_id=?').get(politica_id, entidadId);
  if (!politica) throw fallo('La política no pertenece a la entidad', 404);
  const config = {
    periodo_dias,
    politica_id,
    cambio_precio_pct: variacion(entrada.cambio_precio_pct ?? 0, 'cambio de precio'),
    cambio_volumen_pct: variacion(entrada.cambio_volumen_pct ?? 0, 'cambio de volumen'),
    cambio_costo_pct: variacion(entrada.cambio_costo_pct ?? 0, 'cambio de costo'),
    cobro_pct: porcentaje(entrada.cobro_pct ?? 100, 'cobro parcial'),
    reglas: Array.isArray(entrada.reglas) ? entrada.reglas : null,
  };
  if (config.reglas) config.reglas = config.reglas.map((r, index) => {
    const bolsillo_id = entero(r.bolsillo_id, `bolsillo de regla ${index + 1}`, 1);
    if (!db.prepare("SELECT 1 FROM fin_bolsillos WHERE id=? AND entidad_id=? AND estado='activa'").get(bolsillo_id, entidadId)) throw fallo('Un bolsillo de regla no pertenece a la entidad', 409);
    return { nombre: String(r.nombre || `Regla ${index + 1}`).trim(), bolsillo_id, porcentaje: porcentaje(r.porcentaje, `porcentaje de regla ${index + 1}`) };
  });
  return config;
}

function baseActual(entidadId, dias) {
  const desde = fechaInicio(dias);
  const fila = db.prepare(`SELECT COALESCE(SUM(a.importe_ingreso_minor),0) ingresos_minor, COALESCE(SUM(a.costo_recuperado_minor),0) costos_minor,
    COUNT(*) cobros FROM mpf_aplicaciones a JOIN fin_eventos_financieros e ON e.id=a.evento_financiero_id
    WHERE a.entidad_id=? AND e.fecha>=?`).get(entidadId, desde);
  return { ...fila, desde, periodo_dias: dias };
}

function simular(entidadId, entrada = {}) {
  const config = validarConfiguracion(entidadId, entrada);
  const actual = baseActual(entidadId, config.periodo_dias);
  const factorPrecio = 1 + config.cambio_precio_pct / 100;
  const factorVolumen = 1 + config.cambio_volumen_pct / 100;
  const ingresosProyectados = Math.round(actual.ingresos_minor * factorPrecio * factorVolumen * (config.cobro_pct / 100));
  const costosProyectados = Math.round(actual.costos_minor * factorVolumen * (1 + config.cambio_costo_pct / 100));
  const politica = db.prepare('SELECT * FROM mpf_politicas WHERE id=? AND entidad_id=?').get(config.politica_id, entidadId);
  let resultadoMpf;
  if (config.reglas) {
    const reglas = config.reglas.map((r, i) => ({ id: `escenario-${i}`, orden: i + 1, nombre: r.nombre, bolsillo_id: r.bolsillo_id, base: 'ingreso', tipo: 'porcentaje', valor_minor: Math.round(r.porcentaje * 100), accion: 'aplicar', condicion_json: '{}' }));
    resultadoMpf = politicas.simularConReglas({ entidadId, politicaId: politica.id, importeIngresoMinor: Math.max(0, ingresosProyectados - (politica.recupera_costo ? Math.min(costosProyectados, ingresosProyectados) : 0)), reglas });
  } else resultadoMpf = politicas.simular({ entidadId, politicaId: politica.id, importeIngresoMinor: Math.max(0, ingresosProyectados - (politica.recupera_costo ? Math.min(costosProyectados, ingresosProyectados) : 0)) });
  const costo_recuperado_minor = politica.recupera_costo ? Math.min(costosProyectados, ingresosProyectados) : 0;
  const porBolsillo = new Map();
  resultadoMpf.detalles.forEach((d) => porBolsillo.set(d.bolsillo_id, (porBolsillo.get(d.bolsillo_id) || 0) + d.importe_minor));
  if (costo_recuperado_minor && politica.bolsillo_costo_id) porBolsillo.set(politica.bolsillo_costo_id, (porBolsillo.get(politica.bolsillo_costo_id) || 0) + costo_recuperado_minor);
  const nombres = db.prepare('SELECT id,nombre,tipo FROM fin_bolsillos WHERE entidad_id=?').all(entidadId);
  const distribucion = [...porBolsillo.entries()].map(([bolsillo_id, importe_minor]) => ({ bolsillo_id, importe_minor, ...(nombres.find((b) => b.id === bolsillo_id) || {}) }));
  const reservado_minor = distribucion.filter((d) => ['reserva', 'impuestos'].includes(d.tipo)).reduce((n, d) => n + d.importe_minor, 0);
  const metas = politicas.listarMetasFinancieras(entidadId).filter((m) => m.estado === 'activa').map((m) => {
    const aporte = porBolsillo.get(m.bolsillo_id) || 0; const proyectado = m.saldo_acumulado_minor + aporte;
    return { id: m.id, nombre: m.nombre, objetivo_minor: m.monto_objetivo_minor, actual_minor: m.saldo_acumulado_minor, proyectado_minor: proyectado, cumple: proyectado >= m.monto_objetivo_minor };
  });
  const alertas_probables = [];
  if (!politica.recupera_costo && costosProyectados > 0) alertas_probables.push({ tipo: 'costo_no_recuperado', severidad: 'advertencia', mensaje: 'La política elegida no recupera los costos proyectados.' });
  if (config.cobro_pct < 100) alertas_probables.push({ tipo: 'cobros_parciales', severidad: 'informativa', mensaje: `Solo se proyecta cobrar ${config.cobro_pct}% de las ventas.` });
  metas.filter((m) => !m.cumple).forEach((m) => alertas_probables.push({ tipo: 'meta_no_cumplida', severidad: 'advertencia', mensaje: `La meta ${m.nombre} no se cumpliría en el escenario.` }));
  if (ingresosProyectados <= 0) alertas_probables.push({ tipo: 'sin_ingresos_proyectados', severidad: 'critica', mensaje: 'No hay ingresos proyectados con estos supuestos.' });
  const disponible = resultadoMpf.disponible_minor;
  return { configuracion: config, supuestos: { ingresos_base_minor: actual.ingresos_minor, costos_base_minor: actual.costos_minor, cobros_base: actual.cobros, desde: actual.desde, politica: politica.nombre }, actual: { ingresos_minor: actual.ingresos_minor, costos_recuperados_minor: actual.costos_minor }, proyeccion: { ingresos_minor: ingresosProyectados, costos_proyectados_minor: costosProyectados, costos_recuperados_minor: costo_recuperado_minor, distribucion, utilidad_disponible_minor: disponible, dinero_reservado_minor: reservado_minor, metas, alertas_probables }, comparacion: { ingresos_minor: ingresosProyectados - actual.ingresos_minor, costos_recuperados_minor: costo_recuperado_minor - actual.costos_minor, utilidad_disponible_minor: disponible - Math.max(0, actual.ingresos_minor - actual.costos_minor) } };
}

function listar(entidadId) { return db.prepare('SELECT id,nombre,configuracion_json,creado_en,actualizado_en FROM fin_escenarios_financieros WHERE entidad_id=? ORDER BY actualizado_en DESC,id DESC').all(entidadId).map((x) => ({ ...x, configuracion: JSON.parse(x.configuracion_json) })); }
function obtener(entidadId, id) { const x = db.prepare('SELECT * FROM fin_escenarios_financieros WHERE id=? AND entidad_id=?').get(id, entidadId); if (!x) throw fallo('Escenario no encontrado', 404); return { ...x, configuracion: JSON.parse(x.configuracion_json) }; }
function guardar({ entidadId, nombre, configuracion, usuarioId, id = null }) { if (!nombre?.trim()) throw fallo('El nombre es obligatorio'); const valida = validarConfiguracion(entidadId, configuracion); if (id) { if (!obtener(entidadId, id)) return null; db.prepare("UPDATE fin_escenarios_financieros SET nombre=?,configuracion_json=?,actualizado_en=datetime('now') WHERE id=? AND entidad_id=?").run(nombre.trim(), JSON.stringify(valida), id, entidadId); return obtener(entidadId, id); } const r = db.prepare('INSERT INTO fin_escenarios_financieros(entidad_id,nombre,configuracion_json,creado_por) VALUES(?,?,?,?)').run(entidadId, nombre.trim(), JSON.stringify(valida), usuarioId); return obtener(entidadId, Number(r.lastInsertRowid)); }
function duplicar({ entidadId, id, nombre, usuarioId }) { const base = obtener(entidadId, id); return guardar({ entidadId, nombre: nombre || `${base.nombre} (copia)`, configuracion: base.configuracion, usuarioId }); }
function eliminar(entidadId, id) { if (!db.prepare('DELETE FROM fin_escenarios_financieros WHERE id=? AND entidad_id=?').run(id, entidadId).changes) throw fallo('Escenario no encontrado', 404); return { id, eliminado: true }; }
module.exports = { simular, listar, obtener, guardar, duplicar, eliminar };
