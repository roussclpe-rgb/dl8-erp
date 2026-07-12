const { db } = require('../../db');
const motor = require('./motor');
const politicas = require('./politicas');

const DEFINICIONES = {
  diferencia_saldos: { severidad: 'critica', activa: true, umbral_minor: null, etiqueta: 'Diferencia de saldos' },
  dinero_sin_asignar: { severidad: 'advertencia', activa: true, umbral_minor: 0, etiqueta: 'Dinero sin asignar' },
  impuestos_insuficientes: { severidad: 'critica', activa: true, umbral_minor: null, etiqueta: 'Impuestos insuficientes' },
  bolsillo_bajo_minimo: { severidad: 'advertencia', activa: true, umbral_minor: 0, etiqueta: 'Bolsillo bajo mínimo' },
  costo_no_recuperado: { severidad: 'advertencia', activa: true, umbral_minor: null, etiqueta: 'Costo no recuperado' },
  meta_proxima_vencer: { severidad: 'advertencia', activa: true, umbral_minor: 7, etiqueta: 'Meta próxima a vencer' },
  meta_atrasada: { severidad: 'critica', activa: true, umbral_minor: null, etiqueta: 'Meta atrasada' },
  politica_inactiva: { severidad: 'advertencia', activa: true, umbral_minor: null, etiqueta: 'Sin política activa' },
  politica_sin_aplicaciones: { severidad: 'advertencia', activa: true, umbral_minor: 30, etiqueta: 'Política sin aplicaciones recientes' },
};

function configuracion(entidadId) {
  const guardadas = db.prepare('SELECT tipo,severidad,umbral_minor,activa FROM fin_alertas_config WHERE entidad_id=?').all(entidadId);
  const porTipo = new Map(guardadas.map((x) => [x.tipo, x]));
  return Object.entries(DEFINICIONES).map(([tipo, def]) => ({ tipo, ...def, ...(porTipo.get(tipo) || {}) }));
}

function guardarConfiguracion(entidadId, items) {
  const upsert = db.prepare(`INSERT INTO fin_alertas_config(entidad_id,tipo,severidad,umbral_minor,activa)
    VALUES(?,?,?,?,?) ON CONFLICT(entidad_id,tipo) DO UPDATE SET severidad=excluded.severidad, umbral_minor=excluded.umbral_minor, activa=excluded.activa`);
  const tx = db.transaction(() => items.forEach((item) => {
    const def = DEFINICIONES[item.tipo];
    if (!def) throw Object.assign(new Error('Tipo de alerta no válido'), { status: 400 });
    if (!['informativa', 'advertencia', 'critica'].includes(item.severidad || def.severidad)) throw Object.assign(new Error('Severidad no válida'), { status: 400 });
    const umbral = item.umbral_minor === '' || item.umbral_minor == null ? null : Number(item.umbral_minor);
    if (umbral != null && (!Number.isSafeInteger(umbral) || umbral < 0)) throw Object.assign(new Error('Umbral no válido'), { status: 400 });
    upsert.run(entidadId, item.tipo, item.severidad || def.severidad, umbral, item.activa === false || item.activa === 0 ? 0 : 1);
  }));
  tx();
  return configuracion(entidadId);
}

function evaluar(entidadId) {
  const cfg = new Map(configuracion(entidadId).map((x) => [x.tipo, x]));
  const hallazgos = [];
  const agregar = (tipo, clave, mensaje, origen) => {
    const c = cfg.get(tipo);
    if (c?.activa) hallazgos.push([tipo, clave, c.severidad, mensaje, origen]);
  };
  const dinero = motor.dondeEstaDinero(entidadId);
  if (dinero.conciliacion.diferencia_minor !== 0) agregar('diferencia_saldos', 'conciliacion', 'Diferencia entre tesorería y bolsillos', dinero.conciliacion);
  const sin = dinero.finalidades.find((x) => x.nombre === 'sin_asignar')?.saldo_minor || 0;
  if (sin > (cfg.get('dinero_sin_asignar')?.umbral_minor ?? 0)) agregar('dinero_sin_asignar', 'general', 'Hay dinero sin asignar', { importe_minor: sin, ruta: '/donde-esta-mi-dinero' });
  dinero.bolsillos.filter((b) => b.tipo === 'impuestos' && b.saldo_minor < 0).forEach((b) => agregar('impuestos_insuficientes', `bolsillo:${b.id}`, `Reserva de impuestos insuficiente: ${b.nombre}`, { ...b, ruta: '/finanzas' }));
  const minimo = cfg.get('bolsillo_bajo_minimo')?.umbral_minor ?? 0;
  dinero.bolsillos.filter((b) => b.tipo !== 'sin_asignar' && b.saldo_minor < minimo).forEach((b) => agregar('bolsillo_bajo_minimo', `bolsillo:${b.id}`, `Bolsillo bajo el mínimo: ${b.nombre}`, { ...b, minimo_minor: minimo, ruta: '/finanzas' }));

  const hoy = new Date().toISOString().slice(0, 10);
  const metas = politicas.listarMetasFinancieras(entidadId).filter((m) => m.estado === 'activa' && m.saldo_acumulado_minor < m.monto_objetivo_minor);
  metas.filter((m) => m.fecha_objetivo && m.fecha_objetivo <= hoy).forEach((m) => agregar('meta_atrasada', `meta:${m.id}`, `Meta atrasada: ${m.nombre}`, { ...m, ruta: '/metas-financieras' }));
  const diasMeta = cfg.get('meta_proxima_vencer')?.umbral_minor ?? 7;
  const limiteMeta = new Date(); limiteMeta.setDate(limiteMeta.getDate() + diasMeta);
  metas.filter((m) => m.fecha_objetivo && m.fecha_objetivo > hoy && m.fecha_objetivo <= limiteMeta.toISOString().slice(0, 10)).forEach((m) => agregar('meta_proxima_vencer', `meta:${m.id}`, `Meta próxima a vencer: ${m.nombre}`, { ...m, dias_restantes: Math.ceil((new Date(`${m.fecha_objetivo}T00:00:00`) - new Date(`${hoy}T00:00:00`)) / 86400000), ruta: '/metas-financieras' }));

  const activa = db.prepare("SELECT * FROM mpf_politicas WHERE entidad_id=? AND estado='activa' AND es_predeterminada=1").get(entidadId);
  if (!activa) agregar('politica_inactiva', 'general', 'No hay política MPF activa para cobros', { ruta: '/politicas-financieras' });
  if (activa) {
    if (!activa.recupera_costo) agregar('costo_no_recuperado', `politica:${activa.id}`, `La política ${activa.nombre} no recupera el costo de venta`, { politica_id: activa.id, ruta: '/politicas-financieras' });
    const diasSinAplicar = cfg.get('politica_sin_aplicaciones')?.umbral_minor ?? 30;
    const ultima = db.prepare('SELECT MAX(creado_en) fecha FROM mpf_aplicaciones WHERE entidad_id=? AND politica_id=?').get(entidadId, activa.id).fecha;
    const limite = new Date(); limite.setDate(limite.getDate() - diasSinAplicar);
    if ((!ultima && new Date(activa.creado_en) <= limite) || (ultima && new Date(ultima) <= limite)) agregar('politica_sin_aplicaciones', `politica:${activa.id}`, `La política ${activa.nombre} no tiene aplicaciones recientes`, { politica_id: activa.id, ultima_aplicacion: ultima, ruta: '/politicas-financieras' });
  }
  const upsert = db.prepare("INSERT INTO fin_alertas(entidad_id,tipo,clave_problema,severidad,estado,mensaje,origen_json) VALUES(?,?,?,?, 'activa',?,?) ON CONFLICT(entidad_id,tipo,clave_problema) DO UPDATE SET severidad=excluded.severidad,estado=CASE WHEN fin_alertas.estado IN ('resuelta','ignorada') THEN 'activa' ELSE fin_alertas.estado END,mensaje=excluded.mensaje,origen_json=excluded.origen_json,actualizada_en=datetime('now')");
  hallazgos.forEach(([tipo, clave, severidad, mensaje, origen]) => upsert.run(entidadId, tipo, clave, severidad, mensaje, JSON.stringify(origen)));
  return db.prepare("SELECT * FROM fin_alertas WHERE entidad_id=? ORDER BY CASE estado WHEN 'activa' THEN 0 WHEN 'leida' THEN 1 WHEN 'resuelta' THEN 2 ELSE 3 END, CASE severidad WHEN 'critica' THEN 0 WHEN 'advertencia' THEN 1 ELSE 2 END,actualizada_en DESC").all(entidadId);
}
function cambiarEstado(entidadId, id, estado, usuarioId) { if (!['activa', 'leida', 'resuelta', 'ignorada'].includes(estado)) throw Object.assign(new Error('Estado no válido'), { status: 400 }); const a = db.prepare('SELECT * FROM fin_alertas WHERE id=? AND entidad_id=?').get(id, entidadId); if (!a) throw Object.assign(new Error('Alerta no encontrada'), { status: 404 }); db.prepare("UPDATE fin_alertas SET estado=?,actualizada_en=datetime('now') WHERE id=?").run(estado, id); db.prepare('INSERT INTO fin_alertas_historial(alerta_id,usuario_id,estado_anterior,estado_nuevo) VALUES(?,?,?,?)').run(id, usuarioId, a.estado, estado); return { id, estado }; }
function historial(entidadId, id) { if (!db.prepare('SELECT 1 FROM fin_alertas WHERE id=? AND entidad_id=?').get(id, entidadId)) throw Object.assign(new Error('Alerta no encontrada'), { status: 404 }); return db.prepare('SELECT h.*,u.nombre usuario FROM fin_alertas_historial h LEFT JOIN usuarios u ON u.id=h.usuario_id WHERE alerta_id=? ORDER BY h.id DESC').all(id); }
module.exports = { evaluar, cambiarEstado, historial, configuracion, guardarConfiguracion };
