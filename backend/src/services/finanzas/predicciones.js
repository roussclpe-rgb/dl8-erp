const { db } = require('../../db');

// Forecasts are intentionally read-only: they derive a daily cash-flow series from
// confirmed financial movements and never create events, alerts or allocations.
const day = (date) => new Date(`${date}T00:00:00Z`);
const iso = (date) => date.toISOString().slice(0, 10);
const addDays = (date, n) => { const next = new Date(date); next.setUTCDate(next.getUTCDate() + n); return next; };
const round = (n) => Math.round(n);
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

function historicSeries(entidadId, lookback = 90) {
  const until = new Date(); const from = addDays(until, -lookback + 1);
  const rows = db.prepare(`SELECT e.fecha, SUM(m.importe_minor) importe_minor
    FROM fin_movimientos_tesoreria m JOIN fin_eventos_financieros e ON e.id=m.evento_id
    WHERE e.entidad_id=? AND e.fecha>=? AND NOT EXISTS(SELECT 1 FROM fin_eventos_financieros r WHERE r.reversion_de_id=e.id)
    GROUP BY e.fecha ORDER BY e.fecha`).all(entidadId, iso(from));
  const amounts = new Map(rows.map((r) => [r.fecha, Number(r.importe_minor)]));
  return Array.from({ length: lookback }, (_, i) => amounts.get(iso(addDays(from, i))) || 0);
}

function stats(values) {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / values.length;
  return { mean, deviation: Math.sqrt(variance) };
}

function saldoTesoreria(entidadId) {
  return Number(db.prepare(`SELECT COALESCE(SUM(m.importe_minor),0) saldo FROM fin_movimientos_tesoreria m
    JOIN fin_eventos_financieros e ON e.id=m.evento_id WHERE e.entidad_id=?
    AND NOT EXISTS(SELECT 1 FROM fin_eventos_financieros r WHERE r.reversion_de_id=e.id)`).get(entidadId).saldo);
}

function predicciones(entidadId, entrada = {}) {
  const horizonte = Number(entrada.horizonte || 90);
  if (![30, 60, 90].includes(horizonte)) throw Object.assign(new Error('El horizonte debe ser 30, 60 o 90 días'), { status: 400 });
  const serie = historicSeries(entidadId);
  const observados = serie.filter((x) => x !== 0);
  if (!observados.length) return { estado: 'sin_datos', mensaje: 'No hay movimientos de tesorería confirmados en los últimos 90 días para estimar una predicción.', horizonte_dias: horizonte, datos_utilizados: { dias_historicos: 90, dias_con_movimiento: 0, fuentes: ['movimientos de tesorería confirmados'] } };
  const { mean, deviation } = stats(serie);
  const saldoInicial = saldoTesoreria(entidadId);
  const confidence = clamp(round(45 + Math.min(35, observados.length / 2) + Math.min(15, Math.max(0, 1 - deviation / Math.max(Math.abs(mean), 1)) * 15)), 45, 95);
  const rango = (dias) => ({ central_minor: round(saldoInicial + mean * dias), minimo_minor: round(saldoInicial + (mean - deviation) * dias), maximo_minor: round(saldoInicial + (mean + deviation) * dias) });
  const flujos = [30, 60, 90].map((dias) => ({ dias, ...rango(dias) }));
  const fechaAgotamiento = mean < 0 ? addDays(new Date(), Math.ceil(saldoInicial / -mean)) : null;
  const pisoSeguridad = Math.max(0, round(deviation * 30));
  const retiroSeguro = Math.max(0, round(Math.min(saldoInicial - pisoSeguridad, saldoInicial + (mean - deviation) * horizonte - pisoSeguridad)));
  const bolsillos = db.prepare(`SELECT b.id,b.nombre,b.tipo,COALESCE(SUM(CASE WHEN a.cuenta_destino_id IS NOT NULL THEN a.importe_minor ELSE -a.importe_minor END),0) saldo_minor,
    COALESCE(meta.meta_minor,0) minimo_minor FROM fin_bolsillos b
    LEFT JOIN fin_asignaciones_bolsillo a ON (a.bolsillo_destino_id=b.id OR a.bolsillo_origen_id=b.id)
    LEFT JOIN fin_eventos_financieros e ON e.id=a.evento_id
    LEFT JOIN mpf_metas_bolsillo meta ON meta.entidad_id=b.entidad_id AND meta.bolsillo_id=b.id
    WHERE b.entidad_id=? GROUP BY b.id ORDER BY b.nombre`).all(entidadId).map((b) => ({ ...b, saldo_minor: Number(b.saldo_minor), minimo_minor: Number(b.minimo_minor) }));
  const tasasMpf = db.prepare(`SELECT b.id, COALESCE(SUM(d.importe_minor),0) monto_minor
    FROM mpf_detalles_aplicacion d JOIN mpf_aplicaciones a ON a.id=d.aplicacion_id
    JOIN fin_eventos_financieros e ON e.id=a.evento_financiero_id JOIN fin_bolsillos b ON b.id=d.bolsillo_id
    WHERE a.entidad_id=? AND e.fecha>=? AND NOT EXISTS(SELECT 1 FROM fin_eventos_financieros r WHERE r.reversion_de_id=e.id)
    GROUP BY b.id`).all(entidadId, iso(addDays(new Date(), -89)));
  const tasaPorBolsillo = new Map(tasasMpf.map((x) => [x.id, Number(x.monto_minor) / 90]));
  const riesgosBolsillos = bolsillos.filter((b) => b.minimo_minor > 0).map((b) => {
    const proyectado = round(b.saldo_minor + (tasaPorBolsillo.get(b.id) || 0) * horizonte);
    return { ...b, proyectado_minor: proyectado, deficit_minor: Math.max(0, b.minimo_minor - proyectado), en_riesgo: proyectado < b.minimo_minor };
  }).filter((b) => b.en_riesgo);
  const reposicion = riesgosBolsillos.map((b) => ({ bolsillo_id: b.id, bolsillo: b.nombre, importe_sugerido_minor: b.deficit_minor, motivo: 'La proyección quedaría por debajo del mínimo configurado.' }));
  const impuestos = bolsillos.filter((b) => b.tipo === 'impuestos').map((b) => ({ bolsillo_id: b.id, bolsillo: b.nombre, saldo_actual_minor: b.saldo_minor, proyeccion_minor: round(b.saldo_minor + (tasaPorBolsillo.get(b.id) || 0) * horizonte) }));
  const alertasExistentes = db.prepare("SELECT id,tipo,severidad,mensaje FROM fin_alertas WHERE entidad_id=? AND estado IN ('activa','leida') ORDER BY CASE severidad WHEN 'critica' THEN 1 WHEN 'advertencia' THEN 2 ELSE 3 END,id DESC LIMIT 10").all(entidadId);
  const escenariosExistentes = db.prepare('SELECT id,nombre,configuracion_json,actualizado_en FROM fin_escenarios_financieros WHERE entidad_id=? ORDER BY actualizado_en DESC,id DESC LIMIT 10').all(entidadId).map((x) => ({ ...x, configuracion: JSON.parse(x.configuracion_json) }));
  const metas = db.prepare(`SELECT m.id,m.nombre,m.monto_objetivo_minor,m.fecha_objetivo,m.bolsillo_id,
    COALESCE(SUM(CASE WHEN a.cuenta_destino_id IS NOT NULL THEN a.importe_minor ELSE -a.importe_minor END),0) saldo_minor
    FROM mpf_metas_financieras m LEFT JOIN fin_asignaciones_bolsillo a ON a.bolsillo_destino_id=m.bolsillo_id OR a.bolsillo_origen_id=m.bolsillo_id
    WHERE m.entidad_id=? AND m.estado='activa' GROUP BY m.id`).all(entidadId).map((m) => {
      const daily = tasaPorBolsillo.get(m.bolsillo_id) || 0; const targetDays = m.fecha_objetivo ? Math.max(0, Math.ceil((day(m.fecha_objetivo) - new Date()) / 86400000)) : horizonte;
      const projected = round(Number(m.saldo_minor) + daily * targetDays); const gap = Number(m.monto_objetivo_minor) - Number(m.saldo_minor);
      return { ...m, saldo_minor: Number(m.saldo_minor), proyectado_minor: projected, probabilidad_cumplimiento_pct: gap <= 0 ? 100 : clamp(round((daily * targetDays / gap) * 100), 0, 100) };
    });
  return { estado: 'ok', horizonte_dias: horizonte, confianza_pct: confidence, datos_utilizados: { dias_historicos: 90, dias_con_movimiento: observados.length, fuentes: ['movimientos de tesorería confirmados', 'asignaciones MPF confirmadas', 'mínimos de bolsillos', 'metas financieras activas', 'alertas y escenarios financieros existentes'], desde: iso(addDays(new Date(), -89)), hasta: iso(new Date()) }, supuestos: { metodo: 'Promedio y desviación estándar de flujos diarios; banda equivalente a una desviación estándar.', flujo_diario_promedio_minor: round(mean), volatilidad_diaria_minor: round(deviation), saldo_inicial_minor: saldoInicial, piso_seguridad_minor: pisoSeguridad }, flujo_caja: flujos, fecha_probable_agotamiento: fechaAgotamiento ? { fecha: iso(fechaAgotamiento), escenario_central: true } : null, capacidad_retiro_segura_minor: retiroSeguro, necesidad_reposicion: reposicion, proyeccion_impuestos: impuestos, metas, bolsillos_en_riesgo: riesgosBolsillos, alertas_existentes: alertasExistentes, escenarios_existentes: escenariosExistentes };
}

module.exports = { predicciones };
