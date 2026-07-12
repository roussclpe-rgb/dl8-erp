const { db } = require('../../db');
const catalogos = require('./catalogos');

const fallo = (message, status = 400) => Object.assign(new Error(message), { status });
const PLANTILLAS = {
  panaderia: { nombre: 'Panadería', destinos: [
    ['INSUMOS', 'Insumos', 'operacion', 35], ['EMPAQUES', 'Empaques', 'operacion', 8], ['MARKETING', 'Marketing', 'operacion', 12], ['REINVERSION', 'Reinversión', 'reserva', 25], ['RESERVA', 'Reserva', 'reserva', 10], ['UTILIDAD', 'Utilidad', 'operacion', 10],
  ] },
  ecommerce: { nombre: 'E-commerce', destinos: [
    ['REPOSICION', 'Reposición de inventario', 'operacion', 45], ['MARKETING', 'Marketing', 'operacion', 15], ['IMPUESTOS', 'Impuestos', 'impuestos', 10], ['REINVERSION', 'Reinversión', 'reserva', 15], ['UTILIDAD', 'Utilidad', 'operacion', 15],
  ] },
  servicios: { nombre: 'Servicios profesionales', destinos: [
    ['IMPUESTOS', 'Impuestos', 'impuestos', 18], ['MARKETING', 'Marketing', 'operacion', 12], ['RESERVA', 'Reserva', 'reserva', 20], ['REINVERSION', 'Reinversión', 'reserva', 20], ['UTILIDAD', 'Utilidad', 'operacion', 30],
  ] },
};
const enteroPositivo = (valor, campo) => {
  const n = Number(valor);
  if (!Number.isSafeInteger(n) || n < 0) throw fallo(`${campo} debe ser un entero no negativo`);
  return n;
};

function politica(entidadId, politicaId) {
  const row = db.prepare('SELECT * FROM mpf_politicas WHERE id=? AND entidad_id=?').get(politicaId, entidadId);
  if (!row) throw fallo('Política financiera no encontrada', 404);
  return row;
}

function reglasDe(entidadId, politicaId) {
  const rows = db.prepare(`SELECT r.* FROM mpf_reglas r JOIN mpf_politicas p ON p.id=r.politica_id
    JOIN fin_bolsillos b ON b.id=r.bolsillo_id WHERE r.politica_id=? AND p.entidad_id=?
    AND b.entidad_id=? AND b.estado='activa' ORDER BY r.orden`).all(politicaId, entidadId, entidadId);
  return rows;
}

function cumpleCondicion(regla, contexto) { const c=JSON.parse(regla.condicion_json||'{}'); const entre=(v,min,max)=>(min==null||v>=min)&&(max==null||v<=max); return entre(contexto.importe_ingreso_minor,c.monto_min_minor,c.monto_max_minor)&&entre(contexto.margen_estimado_minor||0,c.margen_min_minor,c.margen_max_minor)&&(!c.canal||c.canal===contexto.canal)&&(!c.dia_semana||Number(c.dia_semana)===contexto.dia_semana)&&(!c.periodo||c.periodo===contexto.periodo)&&(!c.meta_estado||c.meta_estado===contexto.meta_estado); }
function calcular(reglas, importeIngresoMinor, contexto = {}) {
  let remanente = enteroPositivo(importeIngresoMinor, 'importe_ingreso_minor');
  const detalles = reglas.map((regla) => {
    if (regla.accion === 'omitir' || !cumpleCondicion(regla, { ...contexto, importe_ingreso_minor: importeIngresoMinor })) return { regla_id: regla.id, orden: regla.orden, nombre: regla.nombre, bolsillo_id: regla.bolsillo_destino_id || regla.bolsillo_id, importe_minor: 0, aplicada: false };
    const base = regla.base === 'ingreso' ? importeIngresoMinor : remanente;
    const importe = regla.accion === 'resto' ? remanente : regla.tipo === 'porcentaje'
      ? Math.floor((base * regla.valor_minor) / 10000)
      : regla.valor_minor;
    if (importe > remanente) throw fallo(`La regla “${regla.nombre}” supera el dinero disponible`, 409);
    remanente -= importe;
    return { regla_id: regla.id, orden: regla.orden, nombre: regla.nombre, bolsillo_id: regla.bolsillo_destino_id || regla.bolsillo_id, importe_minor: importe, aplicada: true };
  });
  return { detalles, disponible_minor: remanente, distribuido_minor: importeIngresoMinor - remanente };
}

function simular({ entidadId, politicaId, importeIngresoMinor, contexto = {} }) {
  const p = politica(entidadId, politicaId);
  return { politica_id: p.id, politica: p.nombre, version: p.version, contexto, ...calcular(reglasDe(entidadId, p.id), importeIngresoMinor, contexto) };
}
// Variante pura para escenarios: no persiste ni modifica la política original.
function simularConReglas({ entidadId, politicaId, importeIngresoMinor, reglas, contexto = {} }) {
  const p = politica(entidadId, politicaId);
  if (!Array.isArray(reglas) || !reglas.length) throw fallo('El escenario necesita al menos una regla');
  return { politica_id: p.id, politica: p.nombre, version: p.version, contexto, ...calcular(reglas, importeIngresoMinor, contexto) };
}

const crear = db.transaction(({ entidadId, nombre, eventoTipo = 'cobro_venta', reglas = [], usuarioId, activar = false, predeterminada = false, recuperaCosto = false, bolsilloCostoId = null, version = 1 }) => {
  if (!nombre?.trim()) throw fallo('El nombre de la política es obligatorio');
  if (!['cobro_venta', 'aporte', 'prestamo'].includes(eventoTipo)) throw fallo('Tipo de evento no soportado');
  let bolsilloCosto = null;
  if (recuperaCosto) {
    bolsilloCosto = db.prepare("SELECT id FROM fin_bolsillos WHERE id=? AND entidad_id=? AND estado='activa'").get(bolsilloCostoId, entidadId);
    if (!bolsilloCosto) throw fallo('Selecciona un bolsillo activo para recuperar costos', 409);
  }
  if (!Number.isSafeInteger(version) || version < 1) throw fallo('Versión de política inválida');
  const info = db.prepare(`INSERT INTO mpf_politicas(entidad_id,nombre,evento_tipo,version,estado,es_predeterminada,recupera_costo,bolsillo_costo_id,creado_por)
    VALUES(?,?,?,?,?,?,?,?,?)`).run(entidadId, nombre.trim(), eventoTipo, version, activar ? 'activa' : 'borrador', predeterminada ? 1 : 0, recuperaCosto ? 1 : 0, bolsilloCosto?.id || null, usuarioId);
  const politicaId = Number(info.lastInsertRowid);
  if (reglas.filter((r) => r.accion === 'resto').length > 1) throw fallo('Solo una regla puede enviar el resto', 409);
  const insert = db.prepare('INSERT INTO mpf_reglas(politica_id,orden,nombre,base,tipo,valor_minor,bolsillo_id,meta_id,condicion_json,accion,bolsillo_destino_id,meta_destino_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)');
  reglas.forEach((regla, index) => {
    if (!regla.nombre?.trim() || !['ingreso', 'remanente'].includes(regla.base) || !['porcentaje', 'importe_fijo'].includes(regla.tipo)) throw fallo('Regla de política inválida');
    const bolsillo = db.prepare("SELECT id FROM fin_bolsillos WHERE id=? AND entidad_id=? AND estado='activa'").get(regla.bolsillo_id, entidadId);
    if (!bolsillo) throw fallo('El bolsillo de una regla no pertenece a la entidad', 409);
    const valor = enteroPositivo(regla.valor_minor, 'valor_minor');
    if (regla.tipo === 'porcentaje' && valor > 10000) throw fallo('Un porcentaje no puede superar 10000 puntos base');
    let metaId = null;
    if (regla.meta_id != null && regla.meta_id !== '') {
      metaId = enteroFiltro(regla.meta_id, 'meta_id');
      const meta = db.prepare("SELECT id FROM mpf_metas_financieras WHERE id=? AND entidad_id=? AND bolsillo_id=? AND estado='activa'").get(metaId, entidadId, bolsillo.id);
      if (!meta) throw fallo('La meta debe estar activa y vinculada al bolsillo de la regla', 409);
    }
    const accion = regla.accion || 'aplicar'; if (!['aplicar','resto','omitir'].includes(accion)) throw fallo('Acción de regla inválida');
    const condicion = regla.condicion || {}; if (!condicion || typeof condicion !== 'object' || Array.isArray(condicion)) throw fallo('Condición de regla inválida');
    const bolsilloDestinoId = regla.bolsillo_destino_id ? enteroFiltro(regla.bolsillo_destino_id, 'bolsillo_destino_id') : null;
    if (bolsilloDestinoId && !db.prepare("SELECT 1 FROM fin_bolsillos WHERE id=? AND entidad_id=? AND estado='activa'").get(bolsilloDestinoId, entidadId)) throw fallo('Bolsillo destino no válido', 409);
    const metaDestinoId = regla.meta_destino_id ? enteroFiltro(regla.meta_destino_id, 'meta_destino_id') : null;
    if (metaDestinoId && !db.prepare("SELECT 1 FROM mpf_metas_financieras WHERE id=? AND entidad_id=? AND estado='activa'").get(metaDestinoId, entidadId)) throw fallo('Meta destino no válida', 409);
    insert.run(politicaId, index + 1, regla.nombre.trim(), regla.base, regla.tipo, valor, bolsillo.id, metaId, JSON.stringify(condicion), accion, bolsilloDestinoId, metaDestinoId);
  });
  // Se valida antes de exponerla: ninguna regla puede requerir más que el ingreso simulado.
  calcular(reglasDe(entidadId, politicaId), 100000000);
  return politica(entidadId, politicaId);
});

function listar(entidadId) {
  return db.prepare(`SELECT p.*, COUNT(r.id) reglas FROM mpf_politicas p LEFT JOIN mpf_reglas r ON r.politica_id=p.id
    WHERE p.entidad_id=? GROUP BY p.id ORDER BY p.evento_tipo,p.nombre,p.version DESC`).all(entidadId);
}
function detallePolitica(entidadId, politicaId) { const p = politica(entidadId, politicaId); return { ...p, reglas: reglasDe(entidadId, p.id) }; }

const crearVersion = db.transaction(({ entidadId, politicaId, usuarioId, nombre = null, reglas = null, recuperaCosto = null, bolsilloCostoId = null }) => {
  const anterior = politica(entidadId, politicaId);
  const reglasAnteriores = reglasDe(entidadId, anterior.id);
  // Preserve every persisted rule attribute when creating a compatible version.
  const reglasNuevas = reglas == null ? reglasAnteriores.map((r) => ({
    nombre: r.nombre, base: r.base, tipo: r.tipo, valor_minor: r.valor_minor,
    bolsillo_id: r.bolsillo_id, meta_id: r.meta_id,
    condicion: JSON.parse(r.condicion_json || '{}'), accion: r.accion || 'aplicar',
    bolsillo_destino_id: r.bolsillo_destino_id, meta_destino_id: r.meta_destino_id,
  })) : reglas;
  return crear({ entidadId, nombre: nombre || anterior.nombre, eventoTipo: anterior.evento_tipo, reglas: reglasNuevas, usuarioId,
    recuperaCosto: recuperaCosto == null ? Boolean(anterior.recupera_costo) : recuperaCosto,
    bolsilloCostoId: bolsilloCostoId || anterior.bolsillo_costo_id, version: anterior.version + 1 });
});

function listarPlantillas() { return Object.entries(PLANTILLAS).map(([codigo, plantilla]) => ({ codigo, nombre: plantilla.nombre, destinos: plantilla.destinos.map(([, nombre, , porcentaje]) => ({ nombre, porcentaje })) })); }
const aplicarPlantilla = db.transaction(({ entidadId, codigo, usuarioId }) => {
  const plantilla = PLANTILLAS[codigo];
  if (!plantilla) throw fallo('Plantilla financiera no encontrada', 404);
  const existente = db.prepare('SELECT * FROM mpf_politicas WHERE entidad_id=? AND nombre=? ORDER BY version DESC LIMIT 1').get(entidadId, `Ventas — ${plantilla.nombre}`);
  if (existente) return { politica: existente, existente: true };
  const reglas = plantilla.destinos.map(([bolsilloCodigo, nombre, tipo, porcentaje]) => {
    let bolsillo = db.prepare("SELECT id FROM fin_bolsillos WHERE entidad_id=? AND codigo=? AND estado='activa'").get(entidadId, bolsilloCodigo);
    if (!bolsillo) bolsillo = catalogos.crearBolsillo({ entidadId, codigo: bolsilloCodigo, nombre, tipo, usuarioId });
    return { nombre, bolsillo_id: bolsillo.id, base: 'ingreso', tipo: 'porcentaje', valor_minor: porcentaje * 100 };
  });
  const bolsilloCostoId = codigo === 'panaderia' || codigo === 'ecommerce' ? reglas[0].bolsillo_id : null;
  const politicaCreada = crear({ entidadId, nombre: `Ventas — ${plantilla.nombre}`, eventoTipo: 'cobro_venta', reglas, usuarioId, recuperaCosto: Boolean(bolsilloCostoId), bolsilloCostoId });
  return { politica: politicaCreada, existente: false };
});

const activar = db.transaction(({ entidadId, politicaId, predeterminada = false }) => {
  const p = politica(entidadId, politicaId);
  if (!reglasDe(entidadId, p.id).length) throw fallo('Una política requiere al menos una regla', 409);
  if (predeterminada) db.prepare("UPDATE mpf_politicas SET es_predeterminada=0 WHERE entidad_id=? AND evento_tipo=? AND estado='activa'").run(entidadId, p.evento_tipo);
  db.prepare("UPDATE mpf_politicas SET estado='activa',es_predeterminada=? WHERE id=?").run(predeterminada ? 1 : p.es_predeterminada, p.id);
  return politica(entidadId, p.id);
});

const aplicarACobro = db.transaction(({ entidadId, eventoFinancieroId, cuentaFinancieraId, bolsilloOrigenId, importeIngresoMinor, costoMinor = 0, contexto = {} }) => {
  const existente = db.prepare('SELECT id FROM mpf_aplicaciones WHERE evento_financiero_id=?').get(eventoFinancieroId);
  if (existente) return { aplicacion_id: existente.id, repetido: true };
  const p = db.prepare("SELECT * FROM mpf_politicas WHERE entidad_id=? AND evento_tipo='cobro_venta' AND estado='activa' AND es_predeterminada=1").get(entidadId);
  if (!p) return null; // MPF es opcional hasta que el negocio active una política.
  const costoRecuperadoMinor = p.recupera_costo ? Math.min(enteroPositivo(costoMinor, 'costo_minor'), importeIngresoMinor) : 0;
  const saldoBolsillo = db.prepare('SELECT COALESCE(SUM(CASE WHEN bolsillo_destino_id=? THEN importe_minor ELSE 0 END)-SUM(CASE WHEN bolsillo_origen_id=? THEN importe_minor ELSE 0 END),0) saldo FROM fin_asignaciones_bolsillo').get(bolsilloOrigenId, bolsilloOrigenId).saldo;
  const resultado = calcular(reglasDe(entidadId, p.id), importeIngresoMinor - costoRecuperadoMinor, { ...contexto, margen_estimado_minor: contexto.margen_estimado_minor ?? Math.max(0, importeIngresoMinor - costoMinor), saldo_bolsillo_minor: saldoBolsillo });
  const appId = Number(db.prepare(`INSERT INTO mpf_aplicaciones(entidad_id,evento_financiero_id,politica_id,politica_version,importe_ingreso_minor,costo_recuperado_minor,importe_distribuido_minor)
    VALUES(?,?,?,?,?,?,?)`).run(entidadId, eventoFinancieroId, p.id, p.version, importeIngresoMinor, costoRecuperadoMinor, costoRecuperadoMinor + resultado.distribuido_minor).lastInsertRowid);
  const asignar = db.prepare(`INSERT INTO fin_asignaciones_bolsillo(evento_id,cuenta_origen_id,bolsillo_origen_id,cuenta_destino_id,bolsillo_destino_id,importe_minor)
    VALUES(?,?,?,?,?,?)`);
  const detalle = db.prepare('INSERT INTO mpf_detalles_aplicacion(aplicacion_id,regla_id,bolsillo_id,importe_minor,condicion_evaluada_json) VALUES(?,?,?,?,?)');
  if (costoRecuperadoMinor > 0) asignar.run(eventoFinancieroId, cuentaFinancieraId, bolsilloOrigenId, cuentaFinancieraId, p.bolsillo_costo_id, costoRecuperadoMinor);
  resultado.detalles.filter((d) => d.importe_minor > 0).forEach((d) => {
    asignar.run(eventoFinancieroId, cuentaFinancieraId, bolsilloOrigenId, cuentaFinancieraId, d.bolsillo_id, d.importe_minor);
    detalle.run(appId, d.regla_id, d.bolsillo_id, d.importe_minor, JSON.stringify({ contexto, aplicada: d.aplicada }));
  });
  return { aplicacion_id: appId, politica_id: p.id, version: p.version, costo_recuperado_minor: costoRecuperadoMinor, ...resultado };
});

function historialEvento(entidadId, eventoId) {
  const app = db.prepare(`SELECT a.*,p.nombre politica FROM mpf_aplicaciones a JOIN mpf_politicas p ON p.id=a.politica_id
    WHERE a.entidad_id=? AND a.evento_financiero_id=?`).get(entidadId, eventoId);
  if (!app) return null;
  return { ...app, detalles: db.prepare(`SELECT d.*,r.nombre regla,r.accion,r.condicion_json,r.bolsillo_destino_id,b.nombre bolsillo FROM mpf_detalles_aplicacion d
    JOIN mpf_reglas r ON r.id=d.regla_id JOIN fin_bolsillos b ON b.id=d.bolsillo_id WHERE d.aplicacion_id=? ORDER BY r.orden`).all(app.id) };
}
function flujoDineroEvento(entidadId, eventoId) {
  const app = historialEvento(entidadId, eventoId);
  if (!app) throw fallo('El evento no tiene una aplicación MPF', 404);
  const cobro = db.prepare(`SELECT c.*,d.venta_id,v.folio FROM fin_cobros c JOIN fin_documentos_cxc d ON d.id=c.documento_cxc_id JOIN ventas v ON v.id=d.venta_id WHERE c.evento_financiero_id=?`).get(eventoId);
  if (!cobro) throw fallo('El evento MPF no corresponde a un cobro de venta', 409);
  const cuenta = db.prepare('SELECT id,nombre,tipo FROM fin_cuentas_financieras WHERE id=? AND entidad_id=?').get(cobro.cuenta_financiera_id, entidadId);
  const politica = db.prepare('SELECT bolsillo_costo_id FROM mpf_politicas WHERE id=?').get(app.politica_id);
  const bolsilloCosto = politica?.bolsillo_costo_id ? db.prepare('SELECT nombre FROM fin_bolsillos WHERE id=?').get(politica.bolsillo_costo_id) : null;
  const reversion = db.prepare(`SELECT id,fecha,descripcion FROM fin_eventos_financieros
    WHERE entidad_id=? AND reversion_de_id=?`).get(entidadId, eventoId) || null;
  const reglas = db.prepare(`SELECT r.id,r.orden,r.nombre,r.base,r.tipo,r.valor_minor,b.nombre bolsillo
    FROM mpf_reglas r JOIN fin_bolsillos b ON b.id=r.bolsillo_id
    WHERE r.politica_id=? ORDER BY r.orden`).all(app.politica_id);
  return {
    evento_id: eventoId,
    estado: reversion ? 'revertido' : 'confirmado',
    venta: { id: cobro.venta_id, folio: cobro.folio },
    cobro: { id: cobro.id, fecha: cobro.fecha, importe_minor: app.importe_ingreso_minor, metodo_pago: cobro.metodo_pago, cuenta },
    politica: { id: app.politica_id, nombre: app.politica, version: app.politica_version, reglas },
    costo_recuperado: { importe_minor: app.costo_recuperado_minor, bolsillo: bolsilloCosto?.nombre || null },
    distribuciones: app.detalles.map((d) => ({ regla: d.regla, bolsillo: d.bolsillo, importe_minor: d.importe_minor })),
    disponible_final_minor: app.importe_ingreso_minor - app.importe_distribuido_minor,
    reversion,
  };
}

function enteroFiltro(valor, campo) {
  if (valor == null || valor === '') return null;
  const n = Number(valor);
  if (!Number.isSafeInteger(n) || n <= 0) throw fallo(`${campo} no es válido`);
  return n;
}

function listarFlujosDinero(entidadId, { desde = null, hasta = null, ventaId = null, cobroId = null } = {}) {
  if (desde && !/^\d{4}-\d{2}-\d{2}$/.test(desde)) throw fallo('La fecha desde no es válida');
  if (hasta && !/^\d{4}-\d{2}-\d{2}$/.test(hasta)) throw fallo('La fecha hasta no es válida');
  if (desde && hasta && desde > hasta) throw fallo('La fecha desde no puede ser posterior a la fecha hasta');
  const venta = enteroFiltro(ventaId, 'venta_id');
  const cobro = enteroFiltro(cobroId, 'cobro_id');
  return db.prepare(`SELECT e.id evento_id,e.fecha,e.descripcion,a.importe_ingreso_minor,a.costo_recuperado_minor,
      a.importe_distribuido_minor,c.id cobro_id,c.metodo_pago,d.venta_id,v.folio,p.id politica_id,p.nombre politica,
      p.version politica_version,cf.id cuenta_financiera_id,cf.nombre cuenta_financiera,
      r.id reversion_id,r.fecha reversion_fecha,r.descripcion reversion_descripcion
    FROM mpf_aplicaciones a
    JOIN fin_eventos_financieros e ON e.id=a.evento_financiero_id
    JOIN fin_cobros c ON c.evento_financiero_id=e.id AND c.entidad_id=a.entidad_id
    JOIN fin_documentos_cxc d ON d.id=c.documento_cxc_id AND d.entidad_id=a.entidad_id
    JOIN ventas v ON v.id=d.venta_id
    JOIN mpf_politicas p ON p.id=a.politica_id AND p.entidad_id=a.entidad_id
    JOIN fin_cuentas_financieras cf ON cf.id=c.cuenta_financiera_id AND cf.entidad_id=a.entidad_id
    LEFT JOIN fin_eventos_financieros r ON r.reversion_de_id=e.id AND r.entidad_id=a.entidad_id
    WHERE a.entidad_id=@entidadId
      AND (@desde IS NULL OR e.fecha>=@desde) AND (@hasta IS NULL OR e.fecha<=@hasta)
      AND (@venta IS NULL OR d.venta_id=@venta) AND (@cobro IS NULL OR c.id=@cobro)
    ORDER BY e.fecha DESC,e.id DESC`).all({ entidadId, desde, hasta, venta, cobro }).map((row) => ({
      ...row,
      estado: row.reversion_id ? 'revertido' : 'confirmado',
      reversion: row.reversion_id ? { id: row.reversion_id, fecha: row.reversion_fecha, descripcion: row.reversion_descripcion } : null,
      disponible_final_minor: row.importe_ingreso_minor - row.importe_distribuido_minor,
    }));
}

function enteroPaginacion(valor, campo, defecto, maximo) {
  if (valor == null || valor === '') return defecto;
  const n = Number(valor);
  if (!Number.isSafeInteger(n) || n < 1 || n > maximo) throw fallo(`${campo} no es válido`);
  return n;
}

function auditoriaMpf(entidadId, filtros = {}) {
  const { desde = null, hasta = null, tipoEvento = null } = filtros;
  if (desde && !/^\d{4}-\d{2}-\d{2}$/.test(desde)) throw fallo('La fecha desde no es válida');
  if (hasta && !/^\d{4}-\d{2}-\d{2}$/.test(hasta)) throw fallo('La fecha hasta no es válida');
  if (desde && hasta && desde > hasta) throw fallo('La fecha desde no puede ser posterior a la fecha hasta');
  if (tipoEvento && !['cobro_venta', 'reversion'].includes(tipoEvento)) throw fallo('tipo_evento no es válido');
  const params = {
    entidadId, desde, hasta, tipoEvento,
    venta: enteroFiltro(filtros.ventaId, 'venta_id'), cobro: enteroFiltro(filtros.cobroId, 'cobro_id'),
    evento: enteroFiltro(filtros.eventoId, 'evento_id'), politica: enteroFiltro(filtros.politicaId, 'politica_id'), bolsillo: enteroFiltro(filtros.bolsilloId, 'bolsillo_id'),
  };
  const pagina = enteroPaginacion(filtros.pagina, 'pagina', 1, 1000000);
  const porPagina = enteroPaginacion(filtros.porPagina, 'por_pagina', 20, 100);
  const where = `a.entidad_id=@entidadId
    AND (@desde IS NULL OR e.fecha>=@desde) AND (@hasta IS NULL OR e.fecha<=@hasta)
    AND (@venta IS NULL OR d.venta_id=@venta) AND (@cobro IS NULL OR c.id=@cobro)
    AND (@evento IS NULL OR e.id=@evento) AND (@politica IS NULL OR p.id=@politica)
    AND (@bolsillo IS NULL OR det.bolsillo_id=@bolsillo)
    AND (@tipoEvento IS NULL OR (@tipoEvento='cobro_venta' AND r.id IS NULL) OR (@tipoEvento='reversion' AND r.id IS NOT NULL))`;
  const joins = `FROM mpf_aplicaciones a
    JOIN fin_eventos_financieros e ON e.id=a.evento_financiero_id
    JOIN fin_cobros c ON c.evento_financiero_id=e.id AND c.entidad_id=a.entidad_id
    JOIN fin_documentos_cxc d ON d.id=c.documento_cxc_id AND d.entidad_id=a.entidad_id
    JOIN ventas v ON v.id=d.venta_id
    JOIN mpf_politicas p ON p.id=a.politica_id AND p.entidad_id=a.entidad_id
    JOIN mpf_detalles_aplicacion det ON det.aplicacion_id=a.id
    JOIN mpf_reglas regla ON regla.id=det.regla_id
    JOIN fin_bolsillos bolsillo ON bolsillo.id=det.bolsillo_id AND bolsillo.entidad_id=a.entidad_id
    LEFT JOIN fin_eventos_financieros r ON r.reversion_de_id=e.id AND r.entidad_id=a.entidad_id`;
  const total = db.prepare(`SELECT COUNT(*) total ${joins} WHERE ${where}`).get(params).total;
  const filas = db.prepare(`SELECT e.id evento_id,e.fecha,e.descripcion,c.id cobro_id,d.venta_id,v.folio,v.anulado venta_anulada,
      p.id politica_id,p.nombre politica,a.politica_version,regla.id regla_id,regla.orden regla_orden,
      regla.nombre regla,regla.base regla_base,regla.tipo regla_tipo,regla.valor_minor regla_valor_minor,
      CASE WHEN regla.base='ingreso' THEN a.importe_ingreso_minor-a.costo_recuperado_minor
           ELSE a.importe_ingreso_minor-a.costo_recuperado_minor-(SELECT COALESCE(SUM(prev.importe_minor),0)
             FROM mpf_detalles_aplicacion prev JOIN mpf_reglas pr ON pr.id=prev.regla_id
             WHERE prev.aplicacion_id=a.id AND pr.orden<regla.orden) END importe_base_minor,
      det.importe_minor monto_minor,det.condicion_evaluada_json,regla.condicion_json,regla.accion,bolsillo.id bolsillo_id,bolsillo.nombre bolsillo,
      r.id reversion_id,r.fecha reversion_fecha,
      d.evento_emision_id evento_emision_id
    ${joins} WHERE ${where} ORDER BY e.fecha DESC,e.id DESC,regla.orden ASC LIMIT @porPagina OFFSET @offset`)
    .all({ ...params, porPagina, offset: (pagina - 1) * porPagina }).map((fila) => ({
      ...fila,
      tipo_evento: fila.reversion_id ? 'reversion' : 'cobro_venta',
      estado: fila.reversion_id ? 'revertido' : 'confirmado',
      calculo: fila.regla_tipo === 'porcentaje' ? 'porcentaje' : 'importe_fijo',
      eventos_relacionados: { emision_venta_id: fila.evento_emision_id, reversion_id: fila.reversion_id, reversion_fecha: fila.reversion_fecha },
    }));
  return { resultados: filas, paginacion: { pagina, por_pagina: porPagina, total, total_paginas: Math.ceil(total / porPagina) } };
}

function metaConSaldo(entidadId, metaId) {
  const meta = db.prepare(`SELECT m.*,b.nombre bolsillo,COALESCE(SUM(CASE WHEN a.bolsillo_destino_id=b.id THEN a.importe_minor ELSE 0 END)-SUM(CASE WHEN a.bolsillo_origen_id=b.id THEN a.importe_minor ELSE 0 END),0) saldo_acumulado_minor
    FROM mpf_metas_financieras m JOIN fin_bolsillos b ON b.id=m.bolsillo_id
    LEFT JOIN fin_asignaciones_bolsillo a ON b.id IN(a.bolsillo_origen_id,a.bolsillo_destino_id)
    WHERE m.id=? AND m.entidad_id=? GROUP BY m.id`).get(metaId, entidadId);
  if (!meta) throw fallo('Meta financiera no encontrada', 404);
  const porcentaje_avance = Math.min(10000, Math.floor((meta.saldo_acumulado_minor * 10000) / meta.monto_objetivo_minor));
  return { ...meta, porcentaje_avance_minor: porcentaje_avance };
}
function listarMetasFinancieras(entidadId) {
  return db.prepare('SELECT id FROM mpf_metas_financieras WHERE entidad_id=? ORDER BY CASE estado WHEN \'activa\' THEN 0 WHEN \'pausada\' THEN 1 ELSE 2 END, creado_en DESC,id DESC').all(entidadId).map((m) => metaConSaldo(entidadId, m.id));
}
const crearMetaFinanciera = db.transaction(({ entidadId, nombre, montoObjetivoMinor, fechaObjetivo = null, bolsilloId, usuarioId }) => {
  if (!nombre?.trim()) throw fallo('El nombre de la meta es obligatorio');
  const monto = enteroPositivo(montoObjetivoMinor, 'monto_objetivo_minor'); if (!monto) throw fallo('El monto objetivo debe ser mayor que cero');
  if (fechaObjetivo && !/^\d{4}-\d{2}-\d{2}$/.test(fechaObjetivo)) throw fallo('fecha_objetivo no es válida');
  if (!db.prepare("SELECT 1 FROM fin_bolsillos WHERE id=? AND entidad_id=? AND estado='activa'").get(bolsilloId, entidadId)) throw fallo('Bolsillo no válido', 404);
  const id = Number(db.prepare('INSERT INTO mpf_metas_financieras(entidad_id,nombre,bolsillo_id,monto_objetivo_minor,fecha_objetivo,creado_por,actualizado_por,actualizado_en) VALUES(?,?,?,?,?,?,?,datetime(\'now\'))').run(entidadId, nombre.trim(), bolsilloId, monto, fechaObjetivo, usuarioId, usuarioId).lastInsertRowid);
  db.prepare("INSERT INTO fin_auditoria(entidad_id,usuario_id,accion,entidad_tabla,entidad_registro_id,datos_despues) VALUES(?,?, 'crear','mpf_metas_financieras',?,?)").run(entidadId, usuarioId, id, JSON.stringify({ nombre: nombre.trim(), bolsillo_id: bolsilloId, monto_objetivo_minor: monto, fecha_objetivo: fechaObjetivo }));
  return metaConSaldo(entidadId, id);
});
const actualizarMetaFinanciera = db.transaction(({ entidadId, metaId, nombre, montoObjetivoMinor, fechaObjetivo, bolsilloId, usuarioId }) => {
  const anterior = metaConSaldo(entidadId, metaId); if (anterior.estado === 'cancelada') throw fallo('Una meta cancelada no se puede editar', 409);
  const monto = enteroPositivo(montoObjetivoMinor, 'monto_objetivo_minor'); if (!monto) throw fallo('El monto objetivo debe ser mayor que cero');
  if (!nombre?.trim() || (fechaObjetivo && !/^\d{4}-\d{2}-\d{2}$/.test(fechaObjetivo))) throw fallo('Datos de meta inválidos');
  if (!db.prepare("SELECT 1 FROM fin_bolsillos WHERE id=? AND entidad_id=? AND estado='activa'").get(bolsilloId, entidadId)) throw fallo('Bolsillo no válido', 404);
  db.prepare("UPDATE mpf_metas_financieras SET nombre=?,bolsillo_id=?,monto_objetivo_minor=?,fecha_objetivo=?,actualizado_por=?,actualizado_en=datetime('now') WHERE id=? AND entidad_id=?").run(nombre.trim(), bolsilloId, monto, fechaObjetivo || null, usuarioId, metaId, entidadId);
  db.prepare("INSERT INTO fin_auditoria(entidad_id,usuario_id,accion,entidad_tabla,entidad_registro_id,datos_antes,datos_despues) VALUES(?,?, 'actualizar','mpf_metas_financieras',?,?,?)").run(entidadId, usuarioId, metaId, JSON.stringify(anterior), JSON.stringify({ nombre: nombre.trim(), bolsillo_id: bolsilloId, monto_objetivo_minor: monto, fecha_objetivo: fechaObjetivo || null }));
  return metaConSaldo(entidadId, metaId);
});
const cambiarEstadoMetaFinanciera = db.transaction(({ entidadId, metaId, estado, usuarioId }) => {
  if (!['activa','pausada','cumplida','cancelada'].includes(estado)) throw fallo('Estado de meta no válido');
  const anterior = metaConSaldo(entidadId, metaId); if (anterior.estado === 'cancelada' && estado !== 'cancelada') throw fallo('Una meta cancelada no se puede reactivar', 409);
  db.prepare("UPDATE mpf_metas_financieras SET estado=?,actualizado_por=?,actualizado_en=datetime('now') WHERE id=? AND entidad_id=?").run(estado, usuarioId, metaId, entidadId);
  db.prepare("INSERT INTO fin_auditoria(entidad_id,usuario_id,accion,entidad_tabla,entidad_registro_id,datos_antes,datos_despues) VALUES(?,?, 'actualizar','mpf_metas_financieras',?,?,?)").run(entidadId, usuarioId, metaId, JSON.stringify({ estado: anterior.estado }), JSON.stringify({ estado }));
  return metaConSaldo(entidadId, metaId);
});
function aportesMetaFinanciera(entidadId, metaId) {
  metaConSaldo(entidadId, metaId);
  return db.prepare(`SELECT e.id evento_id,e.fecha,c.id cobro_id,d.venta_id,v.folio,det.importe_minor,r.nombre regla,
    CASE WHEN rev.id IS NULL THEN 'confirmado' ELSE 'revertido' END estado,rev.id reversion_id
    FROM mpf_detalles_aplicacion det JOIN mpf_reglas r ON r.id=det.regla_id
    JOIN mpf_aplicaciones a ON a.id=det.aplicacion_id JOIN fin_eventos_financieros e ON e.id=a.evento_financiero_id
    JOIN fin_cobros c ON c.evento_financiero_id=e.id JOIN fin_documentos_cxc d ON d.id=c.documento_cxc_id JOIN ventas v ON v.id=d.venta_id
    LEFT JOIN fin_eventos_financieros rev ON rev.reversion_de_id=e.id AND rev.entidad_id=a.entidad_id
    WHERE a.entidad_id=? AND r.meta_id=? ORDER BY e.fecha DESC,e.id DESC`).all(entidadId, metaId);
}

function resumen(entidadId, desde = null, hasta = null) {
  const filtro = `${desde ? ' AND e.fecha>=@desde' : ''}${hasta ? ' AND e.fecha<=@hasta' : ''}`;
  const params = { entidadId, desde, hasta };
  const totales = db.prepare(`SELECT COUNT(*) aplicaciones,COALESCE(SUM(a.importe_ingreso_minor),0) recibido_minor,
    COALESCE(SUM(a.costo_recuperado_minor),0) costo_recuperado_minor,COALESCE(SUM(a.importe_distribuido_minor),0) distribuido_minor
    FROM mpf_aplicaciones a JOIN fin_eventos_financieros e ON e.id=a.evento_financiero_id WHERE a.entidad_id=@entidadId${filtro}`).get(params);
  const bolsillos = db.prepare(`SELECT b.id,b.nombre,b.tipo,COALESCE(SUM(x.importe_minor),0) reservado_minor
    FROM mpf_aplicaciones app JOIN fin_eventos_financieros e ON e.id=app.evento_financiero_id
    JOIN fin_asignaciones_bolsillo x ON x.evento_id=app.evento_financiero_id
    JOIN fin_bolsillos b ON b.id=x.bolsillo_destino_id
    WHERE app.entidad_id=@entidadId AND x.bolsillo_origen_id IS NOT NULL${filtro}
    GROUP BY b.id,b.nombre,b.tipo ORDER BY reservado_minor DESC`).all(params);
  const metas = db.prepare(`SELECT m.bolsillo_id,m.meta_minor,b.nombre,COALESCE(SUM(CASE WHEN a.bolsillo_destino_id=b.id THEN a.importe_minor ELSE 0 END)-SUM(CASE WHEN a.bolsillo_origen_id=b.id THEN a.importe_minor ELSE 0 END),0) saldo_minor
    FROM mpf_metas_bolsillo m JOIN fin_bolsillos b ON b.id=m.bolsillo_id LEFT JOIN fin_asignaciones_bolsillo a ON b.id IN(a.bolsillo_origen_id,a.bolsillo_destino_id)
    WHERE m.entidad_id=? GROUP BY m.id,b.id ORDER BY b.nombre`).all(entidadId);
  return { ...totales, reservado_minor: totales.distribuido_minor - totales.costo_recuperado_minor, disponible_minor: totales.recibido_minor - totales.distribuido_minor, bolsillos, metas };
}
function dashboardEjecutivo(entidadId, desde = null, hasta = null) {
  const datos = resumen(entidadId, desde, hasta);
  const politicaActiva = db.prepare("SELECT id,nombre,version,recupera_costo FROM mpf_politicas WHERE entidad_id=? AND evento_tipo='cobro_venta' AND estado='activa' AND es_predeterminada=1").get(entidadId) || null;
  const eventos = db.prepare(`SELECT e.id,e.fecha,e.descripcion,a.importe_ingreso_minor,a.costo_recuperado_minor,a.importe_distribuido_minor,p.nombre politica,p.version
    FROM mpf_aplicaciones a JOIN fin_eventos_financieros e ON e.id=a.evento_financiero_id JOIN mpf_politicas p ON p.id=a.politica_id
    WHERE a.entidad_id=? ${desde ? 'AND e.fecha>=?' : ''} ${hasta ? 'AND e.fecha<=?' : ''} ORDER BY e.fecha DESC,e.id DESC LIMIT 10`).all(...[entidadId, ...(desde ? [desde] : []), ...(hasta ? [hasta] : [])]);
  return { ...datos, politica_activa: politicaActiva, eventos_recientes: eventos };
}
function listarMetas(entidadId) { return db.prepare('SELECT m.*,b.nombre,b.tipo FROM mpf_metas_bolsillo m JOIN fin_bolsillos b ON b.id=m.bolsillo_id WHERE m.entidad_id=? ORDER BY b.nombre').all(entidadId); }
function guardarMeta({ entidadId, bolsilloId, metaMinor, usuarioId }) { const n=enteroPositivo(metaMinor,'meta_minor'); if(!db.prepare("SELECT 1 FROM fin_bolsillos WHERE id=? AND entidad_id=? AND estado='activa'").get(bolsilloId,entidadId))throw fallo('Bolsillo no válido',404); db.prepare("INSERT INTO mpf_metas_bolsillo(entidad_id,bolsillo_id,meta_minor,actualizado_por) VALUES(?,?,?,?) ON CONFLICT(entidad_id,bolsillo_id) DO UPDATE SET meta_minor=excluded.meta_minor,actualizado_por=excluded.actualizado_por,actualizado_en=datetime('now')").run(entidadId,bolsilloId,n,usuarioId); return db.prepare('SELECT * FROM mpf_metas_bolsillo WHERE entidad_id=? AND bolsillo_id=?').get(entidadId,bolsilloId); }

module.exports = { crear, crearVersion, listar, detallePolitica, activar, simular, simularConReglas, aplicarACobro, historialEvento, flujoDineroEvento, listarFlujosDinero, auditoriaMpf, listarMetasFinancieras, crearMetaFinanciera, actualizarMetaFinanciera, cambiarEstadoMetaFinanciera, aportesMetaFinanciera, listarPlantillas, aplicarPlantilla, resumen, dashboardEjecutivo, listarMetas, guardarMeta };
