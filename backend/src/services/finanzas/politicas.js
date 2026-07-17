const { db } = require('../../db');
const catalogos = require('./catalogos');
const motor = require('./motor');

const fallo = (message, status = 400) => Object.assign(new Error(message), { status });
function asegurarTablaReversiones() {
  db.exec(`CREATE TABLE IF NOT EXISTS mpf_reversiones_aplicacion (
    id INTEGER PRIMARY KEY AUTOINCREMENT, aplicacion_id_original INTEGER NOT NULL UNIQUE,
    evento_financiero_id INTEGER NOT NULL REFERENCES fin_eventos_financieros(id), entidad_id INTEGER NOT NULL REFERENCES fin_entidades_economicas(id),
    politica_id INTEGER NOT NULL REFERENCES mpf_politicas(id), politica_version INTEGER NOT NULL, motivo TEXT NOT NULL,
    revertido_por INTEGER NOT NULL REFERENCES usuarios(id), creado_en TEXT NOT NULL DEFAULT(datetime('now')), datos_reversion_json TEXT NOT NULL
  ); CREATE INDEX IF NOT EXISTS idx_mpf_reversiones_evento ON mpf_reversiones_aplicacion(evento_financiero_id);`);
}
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
    if (regla.accion === 'omitir' || !cumpleCondicion(regla, { ...contexto, importe_ingreso_minor: importeIngresoMinor })) return { regla_id: regla.id, orden: regla.orden, nombre: regla.nombre, bolsillo_id: regla.bolsillo_destino_id || regla.bolsillo_id, importe_minor: 0, aplicada: false, accion_meta_cumplida: regla.accion_meta_cumplida || null };
    const base = regla.base === 'ingreso' ? importeIngresoMinor : remanente;
    const importe = regla.accion === 'resto' ? remanente : regla.tipo === 'porcentaje'
      ? Math.floor((base * regla.valor_minor) / 10000)
      : regla.valor_minor;
    if (importe > remanente) throw fallo(`La regla “${regla.nombre}” supera el dinero disponible`, 409);
    remanente -= importe;
    return { regla_id: regla.id, orden: regla.orden, nombre: regla.nombre, bolsillo_id: regla.bolsillo_destino_id || regla.bolsillo_id, importe_minor: importe, aplicada: true, accion_meta_cumplida: regla.accion_meta_cumplida || null };
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

function configuracionCosto({ modoRecuperacionCosto, recuperaCosto, costoFijoUnidadMinor, monedaCostoFijo, respaldoCostoReal, tieneCostosPorProducto = false }) {
  const modo = modoRecuperacionCosto || (recuperaCosto ? 'real_calculado' : 'no_recuperar');
  if (!['real_calculado', 'fijo_unidad', 'no_recuperar'].includes(modo)) throw fallo('Modo de recuperación de costo inválido');
  const respaldo = respaldoCostoReal || 'sin_recuperar';
  if (!['fijo_unidad', 'sin_recuperar', 'bloquear'].includes(respaldo)) throw fallo('Regla de respaldo de costo real inválida');
  const fijo = costoFijoUnidadMinor == null || costoFijoUnidadMinor === '' ? null : enteroPositivo(costoFijoUnidadMinor, 'costo_fijo_unidad_minor');
  const requiereFijo = modo === 'fijo_unidad' || (modo === 'real_calculado' && respaldo === 'fijo_unidad');
  if (requiereFijo && !tieneCostosPorProducto && !(fijo > 0)) throw fallo('Ingresa un costo fijo por unidad mayor a cero');
  if (requiereFijo && !tieneCostosPorProducto && !String(monedaCostoFijo || '').trim()) throw fallo('Selecciona la moneda del costo fijo');
  return { modo, respaldo, fijo, moneda: requiereFijo ? String(monedaCostoFijo).trim().toUpperCase() : null };
}

function normalizarCostosFijos(costosFijosProducto) {
  if (costosFijosProducto == null) return null; // Payload antiguo: conserva el costo global histórico.
  if (!Array.isArray(costosFijosProducto)) throw fallo('Los costos fijos por producto deben ser una lista');
  const vistos = new Set();
  return costosFijosProducto.map((item) => {
    const productoId = Number(item.receta_grupo_id);
    if (!Number.isSafeInteger(productoId) || productoId <= 0 || vistos.has(productoId)) throw fallo('Cada producto debe aparecer una sola vez en los costos fijos');
    if (!db.prepare('SELECT 1 FROM productos_venta WHERE receta_grupo_id=? AND activo=1').get(productoId)) throw fallo('El producto del costo fijo no está activo en el catálogo de ventas', 409);
    vistos.add(productoId);
    const costo = enteroPositivo(item.costo_unidad_minor, 'costo_unidad_minor');
    if (!(costo > 0)) throw fallo('El costo fijo por producto debe ser mayor a cero');
    return { receta_grupo_id: productoId, costo_unidad_minor: costo, moneda: String(item.moneda || 'PEN').trim().toUpperCase() };
  });
}
function costosFijosDe(politicaId) { return db.prepare('SELECT receta_grupo_id,costo_unidad_minor,moneda FROM mpf_politica_costos_fijos WHERE politica_id=? ORDER BY receta_grupo_id').all(politicaId); }

const crear = db.transaction(({ entidadId, nombre, eventoTipo = 'cobro_venta', reglas = [], usuarioId, activar = false, predeterminada = false, recuperaCosto = false, modoRecuperacionCosto = null, costosFijosProducto = null, costoFijoUnidadMinor = null, monedaCostoFijo = null, respaldoCostoReal = null, bolsilloCostoId = null, version = 1 }) => {
  if (!nombre?.trim()) throw fallo('El nombre de la política es obligatorio');
  if (!['cobro_venta', 'aporte', 'prestamo'].includes(eventoTipo)) throw fallo('Tipo de evento no soportado');
  const costosFijos = normalizarCostosFijos(costosFijosProducto);
  const costo = configuracionCosto({ modoRecuperacionCosto, recuperaCosto, costoFijoUnidadMinor, monedaCostoFijo, respaldoCostoReal, tieneCostosPorProducto: costosFijos !== null });
  const requiereFijo = costo.modo === 'fijo_unidad' || (costo.modo === 'real_calculado' && costo.respaldo === 'fijo_unidad');
  if (requiereFijo && costosFijos !== null && !costosFijos.length) throw fallo('Agrega al menos un costo fijo por producto');
  let bolsilloCosto = null;
  if (costo.modo !== 'no_recuperar') {
    bolsilloCosto = db.prepare("SELECT id FROM fin_bolsillos WHERE id=? AND entidad_id=? AND estado='activa'").get(bolsilloCostoId, entidadId);
    if (!bolsilloCosto) throw fallo('Selecciona un bolsillo activo para recuperar costos', 409);
  }
  if (!Number.isSafeInteger(version) || version < 1) throw fallo('Versión de política inválida');
  const info = db.prepare(`INSERT INTO mpf_politicas(entidad_id,nombre,evento_tipo,version,estado,es_predeterminada,recupera_costo,modo_recuperacion_costo,costo_fijo_unidad_minor,moneda_costo_fijo,respaldo_costo_real,bolsillo_costo_id,creado_por)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(entidadId, nombre.trim(), eventoTipo, version, activar ? 'activa' : 'borrador', predeterminada ? 1 : 0, costo.modo === 'no_recuperar' ? 0 : 1, costo.modo, costo.fijo, costo.moneda, costo.respaldo, bolsilloCosto?.id || null, usuarioId);
  const politicaId = Number(info.lastInsertRowid);
  if (costosFijos) {
    const insertarCosto = db.prepare('INSERT INTO mpf_politica_costos_fijos(politica_id,receta_grupo_id,costo_unidad_minor,moneda) VALUES(?,?,?,?)');
    costosFijos.forEach((item) => insertarCosto.run(politicaId, item.receta_grupo_id, item.costo_unidad_minor, item.moneda));
  }
  if (reglas.filter((r) => r.accion === 'resto').length > 1) throw fallo('Solo una regla puede enviar el resto', 409);
  const insert = db.prepare('INSERT INTO mpf_reglas(politica_id,orden,nombre,base,tipo,valor_minor,bolsillo_id,meta_id,meta_accion_cumplida,meta_bolsillo_redireccion_id,condicion_json,accion,bolsillo_destino_id,meta_destino_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
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
    const accionMetaCumplida = regla.meta_accion_cumplida || 'continuar';
    if (!['continuar', 'detener', 'redirigir_bolsillo', 'redirigir_resto'].includes(accionMetaCumplida)) throw fallo('Acción posterior de meta inválida');
    if (accionMetaCumplida !== 'continuar' && !metaId) throw fallo('Selecciona una meta para configurar una acción posterior');
    let bolsilloRedireccionId = null;
    if (accionMetaCumplida === 'redirigir_bolsillo') {
      bolsilloRedireccionId = enteroFiltro(regla.meta_bolsillo_redireccion_id, 'meta_bolsillo_redireccion_id');
      if (!db.prepare("SELECT 1 FROM fin_bolsillos WHERE id=? AND entidad_id=? AND estado='activa'").get(bolsilloRedireccionId, entidadId)) throw fallo('El bolsillo de redirección no es válido', 409);
    }
    const accion = regla.accion || 'aplicar'; if (!['aplicar','resto','omitir'].includes(accion)) throw fallo('Acción de regla inválida');
    const condicion = regla.condicion || {}; if (!condicion || typeof condicion !== 'object' || Array.isArray(condicion)) throw fallo('Condición de regla inválida');
    const bolsilloDestinoId = regla.bolsillo_destino_id ? enteroFiltro(regla.bolsillo_destino_id, 'bolsillo_destino_id') : null;
    if (bolsilloDestinoId && !db.prepare("SELECT 1 FROM fin_bolsillos WHERE id=? AND entidad_id=? AND estado='activa'").get(bolsilloDestinoId, entidadId)) throw fallo('Bolsillo destino no válido', 409);
    const metaDestinoId = regla.meta_destino_id ? enteroFiltro(regla.meta_destino_id, 'meta_destino_id') : null;
    if (metaDestinoId && !db.prepare("SELECT 1 FROM mpf_metas_financieras WHERE id=? AND entidad_id=? AND estado='activa'").get(metaDestinoId, entidadId)) throw fallo('Meta destino no válida', 409);
    insert.run(politicaId, index + 1, regla.nombre.trim(), regla.base, regla.tipo, valor, bolsillo.id, metaId, accionMetaCumplida, bolsilloRedireccionId, JSON.stringify(condicion), accion, bolsilloDestinoId, metaDestinoId);
  });
  // Se valida antes de exponerla: ninguna regla puede requerir más que el ingreso simulado.
  calcular(reglasDe(entidadId, politicaId), 100000000);
  return politica(entidadId, politicaId);
});

function listar(entidadId) {
  return db.prepare(`SELECT p.*, COUNT(r.id) reglas,EXISTS(SELECT 1 FROM mpf_aplicaciones a WHERE a.politica_id=p.id) tiene_eventos FROM mpf_politicas p LEFT JOIN mpf_reglas r ON r.politica_id=p.id
    WHERE p.entidad_id=? GROUP BY p.id ORDER BY p.evento_tipo,p.nombre,p.version DESC`).all(entidadId);
}
function detallePolitica(entidadId, politicaId) { const p = politica(entidadId, politicaId); return { ...p, reglas: reglasDe(entidadId, p.id), costos_fijos_producto: costosFijosDe(p.id) }; }

const eliminar = db.transaction(({ entidadId, politicaId, usuarioId }) => {
  const p = politica(entidadId, politicaId);
  const usada = db.prepare('SELECT 1 FROM mpf_aplicaciones WHERE politica_id=? LIMIT 1').get(p.id);
  if (usada) throw fallo('Esta política ya tiene eventos financieros asociados y no puede eliminarse. Puedes desactivarla para dejar de usarla sin perder el historial.', 409);
  const reglas = db.prepare('SELECT * FROM mpf_reglas WHERE politica_id=? ORDER BY orden').all(p.id);
  db.prepare('DELETE FROM mpf_reglas WHERE politica_id=?').run(p.id);
  db.prepare('DELETE FROM mpf_politicas WHERE id=? AND entidad_id=?').run(p.id, entidadId);
  db.prepare("INSERT INTO log_auditoria(usuario_id,entidad,entidad_id,accion,datos_antes) VALUES(?,'mpf_politicas',?,'eliminar',?)")
    .run(usuarioId, p.id, JSON.stringify({ entidad_id: entidadId, ...p, reglas }));
  return { ok: true, id: p.id };
});

const crearVersion = db.transaction(({ entidadId, politicaId, usuarioId, nombre = null, reglas = null, recuperaCosto = null, modoRecuperacionCosto = null, costosFijosProducto = null, costoFijoUnidadMinor = null, monedaCostoFijo = null, respaldoCostoReal = null, bolsilloCostoId = null }) => {
  const anterior = politica(entidadId, politicaId);
  const reglasAnteriores = reglasDe(entidadId, anterior.id);
  // Preserve every persisted rule attribute when creating a compatible version.
  const reglasNuevas = reglas == null ? reglasAnteriores.map((r) => ({
    nombre: r.nombre, base: r.base, tipo: r.tipo, valor_minor: r.valor_minor,
    bolsillo_id: r.bolsillo_id, meta_id: r.meta_id, meta_accion_cumplida: r.meta_accion_cumplida, meta_bolsillo_redireccion_id: r.meta_bolsillo_redireccion_id,
    condicion: JSON.parse(r.condicion_json || '{}'), accion: r.accion || 'aplicar',
    bolsillo_destino_id: r.bolsillo_destino_id, meta_destino_id: r.meta_destino_id,
  })) : reglas;
  return crear({ entidadId, nombre: nombre || anterior.nombre, eventoTipo: anterior.evento_tipo, reglas: reglasNuevas, usuarioId,
    recuperaCosto: recuperaCosto == null ? Boolean(anterior.recupera_costo) : recuperaCosto,
    modoRecuperacionCosto: modoRecuperacionCosto || anterior.modo_recuperacion_costo,
    costosFijosProducto: costosFijosProducto == null ? costosFijosDe(anterior.id) : costosFijosProducto,
    costoFijoUnidadMinor: costosFijosProducto == null && costoFijoUnidadMinor == null ? anterior.costo_fijo_unidad_minor : costoFijoUnidadMinor,
    monedaCostoFijo: monedaCostoFijo || anterior.moneda_costo_fijo,
    respaldoCostoReal: respaldoCostoReal || anterior.respaldo_costo_real,
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

const activar = db.transaction(({ entidadId, politicaId, predeterminada = false, fechaActivacion = null }) => {
  const p = politica(entidadId, politicaId);
  if (!reglasDe(entidadId, p.id).length) throw fallo('Una política requiere al menos una regla', 409);
  if (fechaActivacion && !/^\d{4}-\d{2}-\d{2}$/.test(fechaActivacion)) throw fallo('La fecha de activación no es válida');
  if (predeterminada) db.prepare("UPDATE mpf_politicas SET es_predeterminada=0 WHERE entidad_id=? AND evento_tipo=? AND estado='activa'").run(entidadId, p.evento_tipo);
  db.prepare("UPDATE mpf_politicas SET estado='activa',es_predeterminada=?,activada_en=? WHERE id=?").run(predeterminada ? 1 : p.es_predeterminada, fechaActivacion ? `${fechaActivacion}T00:00:00` : (p.activada_en || new Date().toISOString()), p.id);
  return politica(entidadId, p.id);
});

function resolverCosto(p, { costoMinor = 0, contexto = {} }) {
  const modo = p.modo_recuperacion_costo || (p.recupera_costo ? 'real_calculado' : 'no_recuperar');
  const cantidad = Number(contexto.cantidad_cobro ?? 0);
  const real = enteroPositivo(costoMinor, 'costo_minor');
  const disponible = contexto.costo_real_disponible == null ? real > 0 : Boolean(contexto.costo_real_disponible);
  const costosPorProducto = new Map(costosFijosDe(p.id).map((c) => [Number(c.receta_grupo_id), Number(c.costo_unidad_minor)]));
  const items = Array.isArray(contexto.productos_venta) ? contexto.productos_venta : [];
  const fijoHistorico = p.costo_fijo_unidad_minor == null ? 0 : enteroPositivo(p.costo_fijo_unidad_minor, 'costo_fijo_unidad_minor');
  const costoFijo = (campo) => items.reduce((total, item) => total + (costosPorProducto.get(Number(item.receta_grupo_id)) ?? fijoHistorico) * Number(item[campo] || 0), 0);
  const fijoActual = items.length ? Math.round(costoFijo('cantidad_cobro')) : Math.round(fijoHistorico * cantidad);
  const fijoTotal = items.length ? Math.round(costoFijo('cantidad_total')) : Math.round(fijoHistorico * Number(contexto.cantidad_total_venta || cantidad));
  const faltantes = items.filter((item) => !costosPorProducto.has(Number(item.receta_grupo_id)) && !fijoHistorico).map((item) => item.receta_grupo_id);
  const unitario = cantidad > 0 ? Math.round(fijoActual / cantidad) : null;
  if (modo === 'no_recuperar') return { modo, costo: 0, unitario: null, cantidad: 0, origen: 'sin_recuperar', advertencia: null };
  if (modo === 'fijo_unidad') return { modo, costo: fijoActual, costoTotalFijo: fijoTotal, unitario, cantidad, origen: costosPorProducto.size ? 'fijo_unidad_producto' : 'fijo_unidad', advertencia: faltantes.length ? `No hay costo fijo configurado para los productos: ${faltantes.join(', ')}` : null };
  if (disponible) return { modo, costo: real, unitario: cantidad > 0 ? Math.round(real / cantidad) : null, cantidad, origen: 'real_produccion_receta_inventario', advertencia: null };
  const advertencia = 'No existe un costo real válido para la venta.';
  if (p.respaldo_costo_real === 'bloquear') throw fallo(`${advertencia} La política bloquea el cobro.`, 409);
  if (p.respaldo_costo_real === 'fijo_unidad') return { modo, costo: fijoActual, costoTotalFijo: fijoTotal, unitario, cantidad, origen: costosPorProducto.size ? 'fijo_respaldo_producto' : 'fijo_respaldo', advertencia: faltantes.length ? `${advertencia} No hay costo fijo configurado para los productos: ${faltantes.join(', ')}` : advertencia };
  return { modo, costo: 0, unitario: null, cantidad: 0, origen: 'sin_recuperar_respaldo', advertencia };
}

function reglasConMetasCumplidas(entidadId, reglas) {
  const metas = new Map(db.prepare("SELECT id,estado FROM mpf_metas_financieras WHERE entidad_id=?").all(entidadId).map((meta) => [meta.id, meta]));
  const reglaResto = reglas.find((r) => r.accion === 'resto');
  return reglas.map((regla) => {
    const meta = regla.meta_id ? metas.get(regla.meta_id) : null;
    if (!meta || meta.estado !== 'cumplida') return regla;
    const accion = regla.meta_accion_cumplida || 'continuar';
    if (accion === 'continuar') return { ...regla, accion_meta_cumplida: 'continuar' };
    if (accion === 'detener') return { ...regla, accion: 'omitir', accion_meta_cumplida: 'detener' };
    if (accion === 'redirigir_bolsillo') return { ...regla, bolsillo_destino_id: regla.meta_bolsillo_redireccion_id, accion_meta_cumplida: 'redirigir_bolsillo' };
    if (!reglaResto || reglaResto.id === regla.id) throw fallo(`La regla “${regla.nombre}” no puede redirigir al resto porque no existe otra regla de resto`, 409);
    return { ...regla, bolsillo_destino_id: reglaResto.bolsillo_destino_id || reglaResto.bolsillo_id, accion_meta_cumplida: 'redirigir_resto' };
  });
}

function completarMetasAfectadas({ entidadId, eventoFinancieroId, usuarioId, bolsilloIds }) {
  if (!usuarioId || !bolsilloIds.length) return [];
  const marcadores = bolsilloIds.map(() => '?').join(',');
  const metas = db.prepare(`SELECT m.*,COALESCE(SUM(CASE WHEN a.bolsillo_destino_id=m.bolsillo_id THEN a.importe_minor ELSE 0 END)-SUM(CASE WHEN a.bolsillo_origen_id=m.bolsillo_id THEN a.importe_minor ELSE 0 END),0) saldo_minor
    FROM mpf_metas_financieras m LEFT JOIN fin_asignaciones_bolsillo a ON m.bolsillo_id IN(a.bolsillo_origen_id,a.bolsillo_destino_id)
    WHERE m.entidad_id=? AND m.estado='activa' AND m.bolsillo_id IN(${marcadores}) GROUP BY m.id HAVING saldo_minor-m.saldo_inicial_minor>=m.monto_objetivo_minor`).all(entidadId, ...bolsilloIds);
  const actualizar = db.prepare("UPDATE mpf_metas_financieras SET estado='cumplida',cumplida_en=datetime('now'),cumplida_evento_financiero_id=?,cumplida_por=?,actualizado_por=?,actualizado_en=datetime('now') WHERE id=? AND estado='activa'");
  metas.forEach((meta) => {
    if (!actualizar.run(eventoFinancieroId, usuarioId, usuarioId, meta.id).changes) return;
    db.prepare("INSERT INTO fin_auditoria(entidad_id,usuario_id,accion,entidad_tabla,entidad_registro_id,datos_antes,datos_despues) VALUES(?,?, 'actualizar','mpf_metas_financieras',?,?,?)")
      .run(entidadId, usuarioId, meta.id, JSON.stringify({ estado: 'activa', saldo_minor: meta.saldo_minor }), JSON.stringify({ estado: 'cumplida', automatico: true, evento_financiero_id: eventoFinancieroId, saldo_minor: meta.saldo_minor }));
    if (meta.tipo === 'recurrente') {
      const fechaBase = new Date(`${meta.fecha_objetivo || new Date().toISOString().slice(0, 10)}T12:00:00Z`);
      const meses = { semanal: 0, mensual: 1, trimestral: 3, anual: 12 }; if (meta.frecuencia_recurrencia === 'semanal') fechaBase.setUTCDate(fechaBase.getUTCDate() + 7); else fechaBase.setUTCMonth(fechaBase.getUTCMonth() + (meses[meta.frecuencia_recurrencia] || 1));
      const siguienteId = Number(db.prepare(`INSERT INTO mpf_metas_financieras(entidad_id,nombre,bolsillo_id,monto_objetivo_minor,fecha_objetivo,tipo,frecuencia_recurrencia,meta_origen_id,saldo_inicial_minor,creado_por,actualizado_por,actualizado_en)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,datetime('now'))`).run(entidadId, meta.nombre, meta.bolsillo_id, meta.monto_objetivo_minor, fechaBase.toISOString().slice(0, 10), 'recurrente', meta.frecuencia_recurrencia, meta.meta_origen_id || meta.id, meta.saldo_minor, usuarioId, usuarioId).lastInsertRowid);
      db.prepare("UPDATE mpf_reglas SET meta_id=? WHERE meta_id=? AND politica_id IN (SELECT id FROM mpf_politicas WHERE entidad_id=? AND estado='activa')").run(siguienteId, meta.id, entidadId);
    }
  });
  return metas.map((meta) => meta.id);
}

const aplicarACobro = db.transaction(({ entidadId, eventoFinancieroId, cuentaFinancieraId, bolsilloOrigenId, importeIngresoMinor, costoMinor = 0, contexto = {}, politicaId = null }) => {
  const existente = db.prepare('SELECT id FROM mpf_aplicaciones WHERE evento_financiero_id=?').get(eventoFinancieroId);
  if (existente) return { aplicacion_id: existente.id, repetido: true };
  let p = politicaId ? politica(entidadId, politicaId) : db.prepare("SELECT * FROM mpf_politicas WHERE entidad_id=? AND evento_tipo='cobro_venta' AND estado='activa' AND es_predeterminada=1").get(entidadId);
  // Una política creada fuera del asistente puede quedar activa sin ser predeterminada.
  // Si es la única activa para ventas, no hay ambigüedad y se aplica al cobro.
  if (!p && !politicaId) {
    const activas = db.prepare("SELECT * FROM mpf_politicas WHERE entidad_id=? AND evento_tipo='cobro_venta' AND estado='activa' ORDER BY id").all(entidadId);
    if (activas.length === 1) [p] = activas;
  }
  if (!p) return null; // MPF es opcional hasta que el negocio active una política.
  if (p.evento_tipo !== 'cobro_venta' || p.estado !== 'activa') throw fallo('La política seleccionada debe estar activa y ser para cobros de venta', 409);
  if (!politicaId && p.activada_en && contexto.fecha && String(contexto.fecha) < String(p.activada_en).slice(0, 10)) return null;
  const costo = resolverCosto(p, { costoMinor, contexto });
  if (costo.origen.includes('fijo') && contexto.cantidad_total_venta != null) {
    contexto = { ...contexto, costo_pendiente_fijo_minor: Math.max(0, Number(costo.costoTotalFijo ?? costo.costo) - Number(contexto.costo_recuperado_venta_minor || 0)) };
  }
  const pendiente = costo.origen.includes('fijo') && contexto.costo_pendiente_fijo_minor != null
    ? enteroPositivo(contexto.costo_pendiente_fijo_minor, 'costo_pendiente_fijo_minor')
    : contexto.costo_pendiente_minor == null ? costo.costo : enteroPositivo(contexto.costo_pendiente_minor, 'costo_pendiente_minor');
  const costoRecuperadoMinor = Math.min(costo.costo, pendiente, importeIngresoMinor);
  const saldoBolsillo = db.prepare('SELECT COALESCE(SUM(CASE WHEN bolsillo_destino_id=? THEN importe_minor ELSE 0 END)-SUM(CASE WHEN bolsillo_origen_id=? THEN importe_minor ELSE 0 END),0) saldo FROM fin_asignaciones_bolsillo').get(bolsilloOrigenId, bolsilloOrigenId).saldo;
  const reglas = reglasConMetasCumplidas(entidadId, reglasDe(entidadId, p.id));
  const resultado = calcular(reglas, importeIngresoMinor - costoRecuperadoMinor, { ...contexto, margen_estimado_minor: contexto.margen_estimado_minor ?? Math.max(0, importeIngresoMinor - costoMinor), saldo_bolsillo_minor: saldoBolsillo });
  const snapshot = { politica: { id: p.id, nombre: p.nombre, version: p.version }, reglas: reglas.map((r) => ({ id: r.id, orden: r.orden, nombre: r.nombre, base: r.base, tipo: r.tipo, valor_minor: r.valor_minor, bolsillo_id: r.bolsillo_id, accion: r.accion })) };
  const appId = Number(db.prepare(`INSERT INTO mpf_aplicaciones(entidad_id,evento_financiero_id,politica_id,politica_version,importe_ingreso_minor,costo_recuperado_minor,modo_recuperacion_costo,costo_unidad_minor,cantidad_costo,origen_calculo_costo,advertencia_costo,importe_distribuido_minor,politica_snapshot_json)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(entidadId, eventoFinancieroId, p.id, p.version, importeIngresoMinor, costoRecuperadoMinor, costo.modo, costo.unitario, costo.cantidad, costo.origen, costo.advertencia, costoRecuperadoMinor + resultado.distribuido_minor, JSON.stringify(snapshot)).lastInsertRowid);
  const asignar = db.prepare(`INSERT INTO fin_asignaciones_bolsillo(evento_id,cuenta_origen_id,bolsillo_origen_id,cuenta_destino_id,bolsillo_destino_id,importe_minor)
    VALUES(?,?,?,?,?,?)`);
  const detalle = db.prepare('INSERT INTO mpf_detalles_aplicacion(aplicacion_id,regla_id,bolsillo_id,importe_minor,condicion_evaluada_json) VALUES(?,?,?,?,?)');
  if (costoRecuperadoMinor > 0) asignar.run(eventoFinancieroId, cuentaFinancieraId, bolsilloOrigenId, cuentaFinancieraId, p.bolsillo_costo_id, costoRecuperadoMinor);
  resultado.detalles.filter((d) => d.importe_minor > 0).forEach((d) => {
    asignar.run(eventoFinancieroId, cuentaFinancieraId, bolsilloOrigenId, cuentaFinancieraId, d.bolsillo_id, d.importe_minor);
    detalle.run(appId, d.regla_id, d.bolsillo_id, d.importe_minor, JSON.stringify({ contexto, aplicada: d.aplicada, accion_meta_cumplida: d.accion_meta_cumplida || null }));
  });
  const usuarioId = contexto.usuario_id || db.prepare('SELECT creado_por FROM fin_eventos_financieros WHERE id=?').get(eventoFinancieroId)?.creado_por;
  const bolsillosAfectados = resultado.detalles.filter((d) => d.importe_minor > 0).map((d) => d.bolsillo_id);
  if (costoRecuperadoMinor > 0) bolsillosAfectados.push(p.bolsillo_costo_id);
  const metasCumplidas = completarMetasAfectadas({ entidadId, eventoFinancieroId, usuarioId, bolsilloIds: [...new Set(bolsillosAfectados.filter(Boolean))] });
  if (usuarioId) db.prepare("INSERT INTO fin_auditoria(entidad_id,usuario_id,accion,entidad_tabla,entidad_registro_id,datos_despues) VALUES(?,?,'crear','mpf_aplicaciones',?,?)")
    .run(entidadId, usuarioId, appId, JSON.stringify({ modo_recuperacion_costo: costo.modo, costo_unitario_minor: costo.unitario, cantidad: costo.cantidad, costo_recuperado_minor: costoRecuperadoMinor, origen_calculo: costo.origen, advertencia: costo.advertencia }));
  return { aplicacion_id: appId, politica_id: p.id, version: p.version, costo_recuperado_minor: costoRecuperadoMinor, modo_recuperacion_costo: costo.modo, costo_unitario_minor: costo.unitario, cantidad_costo: costo.cantidad, origen_calculo_costo: costo.origen, advertencia_costo: costo.advertencia, metas_cumplidas: metasCumplidas, ...resultado };
});

function historialEvento(entidadId, eventoId) {
  const app = db.prepare(`SELECT a.*,p.nombre politica FROM mpf_aplicaciones a JOIN mpf_politicas p ON p.id=a.politica_id
    WHERE a.entidad_id=? AND a.evento_financiero_id=?`).get(entidadId, eventoId);
  if (!app) return null;
  return { ...app, detalles: db.prepare(`SELECT d.*,r.nombre regla,r.accion,r.condicion_json,r.bolsillo_destino_id,b.nombre bolsillo FROM mpf_detalles_aplicacion d
    JOIN mpf_reglas r ON r.id=d.regla_id JOIN fin_bolsillos b ON b.id=d.bolsillo_id WHERE d.aplicacion_id=? ORDER BY r.orden`).all(app.id) };
}
function vistaPreviaReversionAplicacion(entidadId, eventoId) {
  const app = db.prepare(`SELECT a.*,p.nombre politica FROM mpf_aplicaciones a JOIN mpf_politicas p ON p.id=a.politica_id WHERE a.entidad_id=? AND a.evento_financiero_id=?`).get(entidadId, eventoId);
  if (!app) throw fallo('El cobro no tiene una distribución de política activa', 404);
  const cobro = db.prepare(`SELECT c.id,c.fecha,c.importe_minor,c.metodo_pago,d.venta_id,v.folio,cl.nombre cliente FROM fin_cobros c JOIN fin_documentos_cxc d ON d.id=c.documento_cxc_id JOIN ventas v ON v.id=d.venta_id JOIN clientes cl ON cl.id=d.cliente_id WHERE c.entidad_id=? AND c.evento_financiero_id=?`).get(entidadId, eventoId);
  if (!cobro) throw fallo('La aplicación no corresponde a un cobro de venta', 409);
  const detalles = db.prepare(`SELECT d.importe_minor,b.id bolsillo_id,b.nombre bolsillo,r.id regla_id,r.nombre regla,r.meta_id,m.nombre meta FROM mpf_detalles_aplicacion d JOIN fin_bolsillos b ON b.id=d.bolsillo_id JOIN mpf_reglas r ON r.id=d.regla_id LEFT JOIN mpf_metas_financieras m ON m.id=r.meta_id WHERE d.aplicacion_id=? ORDER BY r.orden`).all(app.id);
  const costo = app.costo_recuperado_minor > 0 ? [db.prepare('SELECT id,nombre FROM fin_bolsillos WHERE id=(SELECT bolsillo_costo_id FROM mpf_politicas WHERE id=?)').get(app.politica_id)].filter(Boolean).map((b) => ({ bolsillo_id: b.id, bolsillo: b.nombre, importe_minor: app.costo_recuperado_minor, regla: 'Recuperación de costo', regla_id: null, meta_id: null, meta: null })) : [];
  return { aplicacion_id: app.id, cobro, politica: { id: app.politica_id, nombre: app.politica, version: app.politica_version }, distribuciones: [...costo, ...detalles], metas_afectadas: detalles.filter((d) => d.meta_id).map((d) => ({ id: d.meta_id, nombre: d.meta, importe_minor: d.importe_minor })) };
}

const revertirAplicacionCobro = db.transaction(({ entidadId, eventoFinancieroId, motivo, usuarioId }) => {
  asegurarTablaReversiones();
  if (!String(motivo || '').trim()) throw fallo('El motivo de la reversión es obligatorio');
  const vista = vistaPreviaReversionAplicacion(entidadId, eventoFinancieroId);
  const app = db.prepare('SELECT * FROM mpf_aplicaciones WHERE id=? AND entidad_id=?').get(vista.aplicacion_id, entidadId);
  const cobro = db.prepare('SELECT * FROM fin_cobros WHERE entidad_id=? AND evento_financiero_id=?').get(entidadId, eventoFinancieroId);
  if (!cobro || cobro.estado !== 'confirmado') throw fallo('Solo se puede revertir la distribución de un cobro confirmado', 409);
  const reversionPrevia = db.prepare('SELECT id FROM mpf_reversiones_aplicacion WHERE aplicacion_id_original=?').get(app.id);
  if (reversionPrevia) throw fallo('Esta distribución ya fue revertida', 409);
  const asignaciones = db.prepare(`SELECT * FROM fin_asignaciones_bolsillo WHERE evento_id=? AND cuenta_origen_id=? AND bolsillo_origen_id=?`).all(eventoFinancieroId, cobro.cuenta_financiera_id, cobro.bolsillo_id);
  const detalles = db.prepare('SELECT * FROM mpf_detalles_aplicacion WHERE aplicacion_id=?').all(app.id);
  const metas = vista.metas_afectadas;
  const fechaReversion = new Date().toISOString().slice(0, 10);
  const compensacion = motor.ejecutar({
    entidadId, tipo: 'reasignacion_bolsillo', fecha: fechaReversion,
    descripcion: `Reversión de distribución MPF del cobro ${cobro.id}`,
    usuarioId, clave: `mpf-reversion-aplicacion-${app.id}`,
    payload: { aplicacion_id_original: app.id, evento_financiero_id: eventoFinancieroId, motivo: String(motivo).trim() },
    lineas: [], asigs: asignaciones.map((a) => ({ cuenta_origen_id: a.cuenta_destino_id, bolsillo_origen_id: a.bolsillo_destino_id, cuenta_destino_id: a.cuenta_origen_id, bolsillo_destino_id: a.bolsillo_origen_id, importe_minor: a.importe_minor })),
  });
  db.prepare('DELETE FROM mpf_detalles_aplicacion WHERE aplicacion_id=?').run(app.id);
  db.prepare('DELETE FROM mpf_aplicaciones WHERE id=?').run(app.id);
  const reabiertas = [];
  [...new Set(metas.map((m) => m.id))].forEach((metaId) => {
    const meta = metaConSaldo(entidadId, metaId);
    if (meta.estado === 'cumplida' && Number(meta.saldo_acumulado_minor) < Number(meta.monto_objetivo_minor)) {
      db.prepare("UPDATE mpf_metas_financieras SET estado='activa',cumplida_en=NULL,cumplida_evento_financiero_id=NULL,cumplida_por=NULL,actualizado_por=?,actualizado_en=datetime('now') WHERE id=?").run(usuarioId, metaId);
      db.prepare("INSERT INTO fin_auditoria(entidad_id,usuario_id,accion,entidad_tabla,entidad_registro_id,datos_antes,datos_despues) VALUES(?,?,'reabrir_por_reversion','mpf_metas_financieras',?,?,?)").run(entidadId, usuarioId, metaId, JSON.stringify({ estado: 'cumplida' }), JSON.stringify({ estado: 'activa', motivo, aplicacion_id: app.id }));
      reabiertas.push(metaId);
    }
  });
  const datos = { aplicacion: app, cobro: { id: cobro.id, evento_financiero_id: eventoFinancieroId }, asignaciones, detalles, metas_afectadas: metas, metas_reabiertas: reabiertas, evento_compensacion_id: compensacion.id, motivo: String(motivo).trim() };
  const info = db.prepare('INSERT INTO mpf_reversiones_aplicacion(aplicacion_id_original,evento_financiero_id,entidad_id,politica_id,politica_version,motivo,revertido_por,datos_reversion_json) VALUES(?,?,?,?,?,?,?,?)').run(app.id, eventoFinancieroId, entidadId, app.politica_id, app.politica_version, String(motivo).trim(), usuarioId, JSON.stringify(datos));
  db.prepare("INSERT INTO fin_auditoria(entidad_id,usuario_id,accion,entidad_tabla,entidad_registro_id,datos_antes,datos_despues) VALUES(?,?,'actualizar','mpf_aplicaciones',?,?,?)").run(entidadId, usuarioId, app.id, JSON.stringify(datos), JSON.stringify({ revertida: true, reversion_id: Number(info.lastInsertRowid), motivo: String(motivo).trim() }));
  db.prepare("INSERT INTO log_auditoria(usuario_id,entidad,entidad_id,accion,datos_antes,datos_despues) VALUES(?,'mpf_aplicaciones',?,'revertir',?,?)").run(usuarioId, app.id, JSON.stringify({ politica_id: app.politica_id, politica_version: app.politica_version, evento_financiero_id: eventoFinancieroId }), JSON.stringify({ motivo: String(motivo).trim(), asignaciones_retiradas: asignaciones.length, metas_reabiertas: reabiertas }));
  return { ok: true, reversion_id: Number(info.lastInsertRowid), evento_compensacion_id: compensacion.id, cobro_id: cobro.id, asignaciones_retiradas: asignaciones.length, metas_reabiertas: reabiertas };
});
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
    costo_recuperado: { importe_minor: app.costo_recuperado_minor, bolsillo: bolsilloCosto?.nombre || null, modo: app.modo_recuperacion_costo, costo_unitario_minor: app.costo_unidad_minor, cantidad: app.cantidad_costo, origen_calculo: app.origen_calculo_costo, advertencia: app.advertencia_costo },
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
  const saldoCiclo = Math.max(0, Number(meta.saldo_acumulado_minor) - Number(meta.saldo_inicial_minor || 0));
  const porcentaje_avance = Math.min(10000, Math.floor((saldoCiclo * 10000) / meta.monto_objetivo_minor));
  return { ...meta, saldo_bolsillo_minor: meta.saldo_acumulado_minor, saldo_acumulado_minor: saldoCiclo, porcentaje_avance_minor: porcentaje_avance };
}
function listarMetasFinancieras(entidadId) {
  return db.prepare('SELECT id FROM mpf_metas_financieras WHERE entidad_id=? ORDER BY CASE estado WHEN \'activa\' THEN 0 WHEN \'pausada\' THEN 1 ELSE 2 END, creado_en DESC,id DESC').all(entidadId).map((m) => metaConSaldo(entidadId, m.id));
}
const crearMetaFinanciera = db.transaction(({ entidadId, nombre, montoObjetivoMinor, fechaObjetivo = null, tipo = 'unica', frecuenciaRecurrencia = null, bolsilloId, usuarioId }) => {
  if (!nombre?.trim()) throw fallo('El nombre de la meta es obligatorio');
  if (!['unica', 'recurrente'].includes(tipo) || (tipo === 'recurrente' && !['semanal', 'mensual', 'trimestral', 'anual'].includes(frecuenciaRecurrencia))) throw fallo('Configura una frecuencia válida para la meta recurrente');
  const monto = enteroPositivo(montoObjetivoMinor, 'monto_objetivo_minor'); if (!monto) throw fallo('El monto objetivo debe ser mayor que cero');
  if (fechaObjetivo && !/^\d{4}-\d{2}-\d{2}$/.test(fechaObjetivo)) throw fallo('fecha_objetivo no es válida');
  if (!db.prepare("SELECT 1 FROM fin_bolsillos WHERE id=? AND entidad_id=? AND estado='activa'").get(bolsilloId, entidadId)) throw fallo('Bolsillo no válido', 404);
  const id = Number(db.prepare('INSERT INTO mpf_metas_financieras(entidad_id,nombre,bolsillo_id,monto_objetivo_minor,fecha_objetivo,tipo,frecuencia_recurrencia,creado_por,actualizado_por,actualizado_en) VALUES(?,?,?,?,?,?,?,?,?,datetime(\'now\'))').run(entidadId, nombre.trim(), bolsilloId, monto, fechaObjetivo, tipo, tipo === 'recurrente' ? frecuenciaRecurrencia : null, usuarioId, usuarioId).lastInsertRowid);
  db.prepare("INSERT INTO fin_auditoria(entidad_id,usuario_id,accion,entidad_tabla,entidad_registro_id,datos_despues) VALUES(?,?, 'crear','mpf_metas_financieras',?,?)").run(entidadId, usuarioId, id, JSON.stringify({ nombre: nombre.trim(), bolsillo_id: bolsilloId, monto_objetivo_minor: monto, fecha_objetivo: fechaObjetivo }));
  return metaConSaldo(entidadId, id);
});
const actualizarMetaFinanciera = db.transaction(({ entidadId, metaId, nombre, montoObjetivoMinor, fechaObjetivo, tipo = 'unica', frecuenciaRecurrencia = null, bolsilloId, usuarioId }) => {
  const anterior = metaConSaldo(entidadId, metaId); if (anterior.estado === 'cancelada') throw fallo('Una meta cancelada no se puede editar', 409);
  const monto = enteroPositivo(montoObjetivoMinor, 'monto_objetivo_minor'); if (!monto) throw fallo('El monto objetivo debe ser mayor que cero');
  if (!nombre?.trim() || (fechaObjetivo && !/^\d{4}-\d{2}-\d{2}$/.test(fechaObjetivo))) throw fallo('Datos de meta inválidos');
  if (!['unica', 'recurrente'].includes(tipo) || (tipo === 'recurrente' && !['semanal', 'mensual', 'trimestral', 'anual'].includes(frecuenciaRecurrencia))) throw fallo('Configura una frecuencia válida para la meta recurrente');
  if (!db.prepare("SELECT 1 FROM fin_bolsillos WHERE id=? AND entidad_id=? AND estado='activa'").get(bolsilloId, entidadId)) throw fallo('Bolsillo no válido', 404);
  db.prepare("UPDATE mpf_metas_financieras SET nombre=?,bolsillo_id=?,monto_objetivo_minor=?,fecha_objetivo=?,tipo=?,frecuencia_recurrencia=?,actualizado_por=?,actualizado_en=datetime('now') WHERE id=? AND entidad_id=?").run(nombre.trim(), bolsilloId, monto, fechaObjetivo || null, tipo, tipo === 'recurrente' ? frecuenciaRecurrencia : null, usuarioId, metaId, entidadId);
  db.prepare("INSERT INTO fin_auditoria(entidad_id,usuario_id,accion,entidad_tabla,entidad_registro_id,datos_antes,datos_despues) VALUES(?,?, 'actualizar','mpf_metas_financieras',?,?,?)").run(entidadId, usuarioId, metaId, JSON.stringify(anterior), JSON.stringify({ nombre: nombre.trim(), bolsillo_id: bolsilloId, monto_objetivo_minor: monto, fecha_objetivo: fechaObjetivo || null, tipo, frecuencia_recurrencia: tipo === 'recurrente' ? frecuenciaRecurrencia : null }));
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
  const metasAutomaticas = db.prepare(`SELECT m.id,m.nombre,m.estado,m.cumplida_en,m.cumplida_evento_financiero_id,b.nombre bolsillo,
    r.meta_accion_cumplida,rb.nombre bolsillo_redireccion
    FROM mpf_metas_financieras m JOIN fin_bolsillos b ON b.id=m.bolsillo_id
    LEFT JOIN mpf_reglas r ON r.meta_id=m.id
    LEFT JOIN fin_bolsillos rb ON rb.id=r.meta_bolsillo_redireccion_id
    WHERE m.entidad_id=? AND m.estado='cumplida' AND m.cumplida_evento_financiero_id IS NOT NULL ORDER BY m.cumplida_en DESC`).all(entidadId);
  return { ...datos, politica_activa: politicaActiva, eventos_recientes: eventos, metas_automaticas: metasAutomaticas };
}

function fechaISO(d) { return d.toISOString().slice(0, 10); }
function productoProyeccion(entidadId, p, meta, producto, precio) {
  const precioMinor = Math.round(Number(precio === 'mayorista' ? producto.precio_mayorista : producto.precio_normal) * 100);
  if (!(precioMinor > 0)) return { ...producto, precio_minor: 0, aporte_minor: 0, unidades_necesarias: null, facturacion_minor: null, advertencia: 'No tiene precio configurado para este escenario.' };
  const costoFijo = costosFijosDe(p.id).find((c) => Number(c.receta_grupo_id) === Number(producto.receta_grupo_id))?.costo_unidad_minor || p.costo_fijo_unidad_minor || 0;
  const costoReal = Number(producto.costo_actual_unidad_minor || 0);
  let costo = 0;
  if (p.modo_recuperacion_costo === 'fijo_unidad') costo = Number(costoFijo);
  else if (p.modo_recuperacion_costo === 'real_calculado') costo = costoReal || (p.respaldo_costo_real === 'fijo_unidad' ? Number(costoFijo) : 0);
  const neto = Math.max(0, precioMinor - Math.min(precioMinor, costo));
  const reglas = reglasConMetasCumplidas(entidadId, reglasDe(entidadId, p.id));
  const calculo = calcular(reglas, neto, { producto_ids: [producto.receta_grupo_id], cantidad_cobro: 1, cantidad_total_venta: 1, costo_real_disponible: costoReal > 0, margen_estimado_minor: neto });
  const aporteReglas = calculo.detalles.filter((d) => Number(d.bolsillo_id) === Number(meta.bolsillo_id)).reduce((s, d) => s + Number(d.importe_minor), 0);
  const aporteCosto = Number(p.bolsillo_costo_id) === Number(meta.bolsillo_id) ? Math.min(precioMinor, costo) : 0;
  return { receta_grupo_id: producto.receta_grupo_id, nombre_producto: producto.nombre_producto, precio_minor: precioMinor, aporte_minor: aporteReglas + aporteCosto, costo_recuperado_minor: aporteCosto };
}

function proyeccionMetaFinanciera(entidadId, metaId, { dias = 30, precio = 'minorista' } = {}) {
  const meta = metaConSaldo(entidadId, metaId);
  const periodoDias = Math.min(365, Math.max(1, Number.parseInt(dias, 10) || 30));
  if (!['minorista', 'mayorista'].includes(precio)) throw fallo('precio debe ser minorista o mayorista');
  const faltante = Math.max(0, Number(meta.monto_objetivo_minor) - Number(meta.saldo_acumulado_minor));
  const hoy = new Date();
  const desde = new Date(hoy); desde.setUTCDate(desde.getUTCDate() - periodoDias);
  const p = db.prepare("SELECT * FROM mpf_politicas WHERE entidad_id=? AND evento_tipo='cobro_venta' AND estado='activa' AND es_predeterminada=1").get(entidadId);
  const productos = db.prepare(`SELECT pv.receta_grupo_id,pv.precio_normal,pv.precio_mayorista,r.nombre_producto,
      (SELECT ROUND(pr.costo_unidad*100) FROM producciones pr JOIN recetas rr ON rr.id=pr.receta_id WHERE rr.grupo_id=pv.receta_grupo_id AND pr.anulado=0 ORDER BY pr.fecha DESC,pr.id DESC LIMIT 1) costo_actual_unidad_minor
    FROM productos_venta pv JOIN recetas r ON r.grupo_id=pv.receta_grupo_id AND r.vigente=1 WHERE pv.activo=1 ORDER BY r.nombre_producto`).all();
  const individuales = p ? productos.map((producto) => productoProyeccion(entidadId, p, meta, producto, precio)).map((x) => ({ ...x, unidades_necesarias: x.aporte_minor > 0 ? Math.ceil(faltante / x.aporte_minor) : null, facturacion_minor: x.aporte_minor > 0 ? Math.ceil(faltante / x.aporte_minor) * x.precio_minor : null })) : productos.map((x) => ({ ...x, precio_minor: Math.round(Number(precio === 'mayorista' ? x.precio_mayorista : x.precio_normal) * 100), aporte_minor: 0, unidades_necesarias: null, facturacion_minor: null }));
  const historial = db.prepare(`SELECT vi.receta_grupo_id,COALESCE(SUM(vi.cantidad * 1.0 * c.importe_minor / NULLIF(d.importe_original_minor,0)),0) unidades,
      COALESCE(SUM(vi.subtotal * 100 * c.importe_minor / NULLIF(d.importe_original_minor,0)),0) facturacion_minor,
      COUNT(DISTINCT c.id) cobros,MIN(c.fecha) primera_fecha,MAX(c.fecha) ultima_fecha
    FROM fin_cobros c JOIN fin_documentos_cxc d ON d.id=c.documento_cxc_id JOIN ventas v ON v.id=d.venta_id JOIN venta_items vi ON vi.venta_id=v.id
    WHERE c.entidad_id=? AND c.fecha>=? AND v.anulado=0 AND NOT EXISTS(SELECT 1 FROM fin_eventos_financieros rev WHERE rev.reversion_de_id=c.evento_financiero_id)
    GROUP BY vi.receta_grupo_id`).all(entidadId, fechaISO(desde));
  const porProducto = new Map(individuales.map((x) => [Number(x.receta_grupo_id), x]));
  const mezclaItems = historial.map((h) => ({ ...h, ...(porProducto.get(Number(h.receta_grupo_id)) || {}), unidades: Number(h.unidades) }));
  const unidadesHistoricas = mezclaItems.reduce((s, x) => s + x.unidades, 0);
  const facturacionHistorica = mezclaItems.reduce((s, x) => s + Number(x.facturacion_minor || 0), 0);
  const aportePromedioUnidad = unidadesHistoricas ? mezclaItems.reduce((s, x) => s + x.unidades * Number(x.aporte_minor || 0), 0) / unidadesHistoricas : 0;
  const aportePorSol = facturacionHistorica ? mezclaItems.reduce((s, x) => s + x.unidades * Number(x.aporte_minor || 0), 0) / facturacionHistorica : 0;
  const unidadesNecesarias = aportePromedioUnidad > 0 ? Math.ceil(faltante / aportePromedioUnidad) : null;
  const facturacionNecesaria = aportePorSol > 0 ? Math.ceil(faltante / aportePorSol) : null;
  const aportesHistoricos = mezclaItems.reduce((s, x) => s + x.unidades * Number(x.aporte_minor || 0), 0);
  const aporteDiario = aportesHistoricos / periodoDias;
  const diasCumplimiento = aporteDiario > 0 ? Math.ceil(faltante / aporteDiario) : null;
  const desglose = unidadesNecesarias == null ? [] : mezclaItems.map((x) => ({ receta_grupo_id: x.receta_grupo_id, nombre_producto: x.nombre_producto, proporcion: unidadesHistoricas ? x.unidades / unidadesHistoricas : 0, unidades_estimadas: Math.ceil(unidadesNecesarias * x.unidades / unidadesHistoricas), facturacion_estimada_minor: Math.ceil(unidadesNecesarias * x.unidades / unidadesHistoricas) * Number(x.precio_minor || 0), aporte_estimado_minor: Math.ceil(unidadesNecesarias * x.unidades / unidadesHistoricas) * Number(x.aporte_minor || 0) }));
  const diasRestantes = meta.fecha_objetivo ? Math.max(0, Math.ceil((new Date(`${meta.fecha_objetivo}T23:59:59Z`) - hoy) / 86400000)) : null;
  return { meta: { id: meta.id, nombre: meta.nombre, objetivo_minor: meta.monto_objetivo_minor, saldo_actual_minor: meta.saldo_acumulado_minor, faltante_minor: faltante, porcentaje_avance_minor: meta.porcentaje_avance_minor, dias_restantes: diasRestantes }, politica: p ? { id: p.id, nombre: p.nombre } : null, escenario_producto: { precio, productos: individuales }, mezcla: { periodo_dias: periodoDias, disponible: Boolean(p && unidadesHistoricas > 0 && aportePromedioUnidad > 0), mensaje: !p ? 'No hay una política financiera activa para proyectar aportes.' : unidadesHistoricas === 0 ? 'Aún no hay cobros confirmados suficientes para calcular una mezcla confiable.' : aportePromedioUnidad === 0 ? 'La mezcla reciente no aporta a este bolsillo con la política activa.' : null, aporte_promedio_unidad_minor: Math.round(aportePromedioUnidad), aporte_por_sol_minor: aportePorSol, unidades_necesarias: unidadesNecesarias, facturacion_necesaria_minor: facturacionNecesaria, fecha_estimada_cumplimiento: diasCumplimiento == null ? null : fechaISO(new Date(hoy.getTime() + diasCumplimiento * 86400000)), desglose } };
}
function listarMetas(entidadId) { return db.prepare('SELECT m.*,b.nombre,b.tipo FROM mpf_metas_bolsillo m JOIN fin_bolsillos b ON b.id=m.bolsillo_id WHERE m.entidad_id=? ORDER BY b.nombre').all(entidadId); }
function guardarMeta({ entidadId, bolsilloId, metaMinor, usuarioId }) { const n=enteroPositivo(metaMinor,'meta_minor'); if(!db.prepare("SELECT 1 FROM fin_bolsillos WHERE id=? AND entidad_id=? AND estado='activa'").get(bolsilloId,entidadId))throw fallo('Bolsillo no válido',404); db.prepare("INSERT INTO mpf_metas_bolsillo(entidad_id,bolsillo_id,meta_minor,actualizado_por) VALUES(?,?,?,?) ON CONFLICT(entidad_id,bolsillo_id) DO UPDATE SET meta_minor=excluded.meta_minor,actualizado_por=excluded.actualizado_por,actualizado_en=datetime('now')").run(entidadId,bolsilloId,n,usuarioId); return db.prepare('SELECT * FROM mpf_metas_bolsillo WHERE entidad_id=? AND bolsillo_id=?').get(entidadId,bolsilloId); }

function cobrosSinPolitica(entidadId, { desde = null, cobroIds = null, politicaId = null } = {}) {
  const p = politicaId ? politica(entidadId, politicaId) : null;
  if (p && p.evento_tipo !== 'cobro_venta') throw fallo('Selecciona una política de cobros', 409);
  if (desde && !/^\d{4}-\d{2}-\d{2}$/.test(desde)) throw fallo('La fecha inicial no es válida');
  const ids = Array.isArray(cobroIds) ? cobroIds.map(Number).filter(Number.isSafeInteger) : null;
  const filtros = ["c.entidad_id=?", "c.estado='confirmado'", "v.anulado=0", "NOT EXISTS(SELECT 1 FROM fin_eventos_financieros r WHERE r.reversion_de_id=c.evento_financiero_id)", "NOT EXISTS(SELECT 1 FROM mpf_aplicaciones a WHERE a.evento_financiero_id=c.evento_financiero_id)"];
  const params = [entidadId];
  if (desde) { filtros.push('c.fecha>=?'); params.push(desde); }
  if (ids) { if (!ids.length) return []; filtros.push(`c.id IN (${ids.map(() => '?').join(',')})`); params.push(...ids); }
  const rows = db.prepare(`SELECT c.id,c.fecha,c.importe_minor,c.metodo_pago,c.evento_financiero_id,c.cuenta_financiera_id,c.bolsillo_id,
      d.venta_id,v.folio,cl.nombre cliente,cf.nombre cuenta_ingreso,COUNT(vi.id) items,GROUP_CONCAT(DISTINCT rec.nombre_producto) productos
    FROM fin_cobros c JOIN fin_documentos_cxc d ON d.id=c.documento_cxc_id AND d.entidad_id=c.entidad_id
      JOIN ventas v ON v.id=d.venta_id JOIN clientes cl ON cl.id=d.cliente_id
      LEFT JOIN fin_cuentas_financieras cf ON cf.id=c.cuenta_financiera_id LEFT JOIN venta_items vi ON vi.venta_id=v.id LEFT JOIN recetas rec ON rec.grupo_id=vi.receta_grupo_id
    WHERE ${filtros.join(' AND ')} GROUP BY c.id ORDER BY c.fecha,c.id`).all(...params);
  return rows.map((r) => ({ ...r, aporte_estimado_minor: p ? calcular(reglasDe(entidadId, p.id), Number(r.importe_minor)).distribuido_minor : null, estado: !r.cuenta_financiera_id || !r.bolsillo_id ? 'No procesable' : (p?.modo_recuperacion_costo === 'real_calculado' && p.respaldo_costo_real === 'bloquear' && !r.items ? 'No procesable' : 'Pendiente'), motivo: !r.cuenta_financiera_id || !r.bolsillo_id ? 'Falta cuenta de ingreso o bolsillo de origen' : (p?.modo_recuperacion_costo === 'real_calculado' && p.respaldo_costo_real === 'bloquear' && !r.items ? 'No hay productos para calcular el costo real' : null) }));
}

function contextoRetroactivo(cobro) {
  const productos = db.prepare('SELECT receta_grupo_id,cantidad FROM venta_items WHERE venta_id=?').all(cobro.venta_id);
  return { canal: cobro.metodo_pago, fecha: cobro.fecha, dia_semana: new Date(`${cobro.fecha}T12:00:00Z`).getUTCDay(), periodo: cobro.fecha.slice(0, 7), usuario_id: cobro.usuario_id, productos_venta: productos.map((x) => ({ receta_grupo_id: x.receta_grupo_id, cantidad_total: Number(x.cantidad), cantidad_cobro: Number(x.cantidad) })), cantidad_cobro: productos.reduce((n, x) => n + Number(x.cantidad), 0), cantidad_total_venta: productos.reduce((n, x) => n + Number(x.cantidad), 0), costo_real_disponible: false, costo_pendiente_minor: 0 };
}

const procesarCobrosSinPolitica = ({ entidadId, politicaId, modo, fechaElegida = null, cobroIds = null, usuarioId }) => {
  if (modo !== 'manual') throw fallo('Los cobros históricos solo se procesan mediante selección manual');
  const p = politica(entidadId, politicaId);
  if (p.estado !== 'activa') throw fallo('La política debe estar activa', 409);
  const candidatos = cobrosSinPolitica(entidadId, { cobroIds, politicaId });
  const resumen = { procesados: [], omitidos: [], fallidos: [], monto_total_distribuido_minor: 0 };
  candidatos.forEach((cobro) => {
    if (cobro.estado === 'No procesable') { resumen.omitidos.push({ id: cobro.id, motivo: cobro.motivo }); return; }
    try {
      const r = aplicarACobro({ entidadId, eventoFinancieroId: cobro.evento_financiero_id, cuentaFinancieraId: cobro.cuenta_financiera_id, bolsilloOrigenId: cobro.bolsillo_id, importeIngresoMinor: cobro.importe_minor, contexto: { ...contextoRetroactivo(cobro), usuario_id: usuarioId }, politicaId: p.id });
      if (r?.repetido) resumen.omitidos.push({ id: cobro.id, motivo: 'Ya tiene distribución de política' });
      else { resumen.procesados.push(cobro.id); resumen.monto_total_distribuido_minor += Number(r?.distribuido_minor || 0) + Number(r?.costo_recuperado_minor || 0); }
    } catch (e) { resumen.fallidos.push({ id: cobro.id, motivo: e.message }); }
  });
  db.prepare("INSERT INTO log_auditoria(usuario_id,entidad,entidad_id,accion,datos_despues) VALUES(?,'mpf_aplicacion_retroactiva',?,'procesar',?)")
    .run(usuarioId, p.id, JSON.stringify({ entidad_id: entidadId, politica_id: p.id, politica_version: p.version, modo, fecha_elegida: fechaElegida, procesados: resumen.procesados, omitidos: resumen.omitidos, fallidos: resumen.fallidos }));
  return { ...resumen, procesados: resumen.procesados.length, omitidos: resumen.omitidos, fallidos: resumen.fallidos, cantidad_procesados: resumen.procesados.length };
};

module.exports = { crear, crearVersion, listar, detallePolitica, eliminar, activar, simular, simularConReglas, aplicarACobro, historialEvento, vistaPreviaReversionAplicacion, revertirAplicacionCobro, flujoDineroEvento, listarFlujosDinero, auditoriaMpf, listarMetasFinancieras, crearMetaFinanciera, actualizarMetaFinanciera, cambiarEstadoMetaFinanciera, aportesMetaFinanciera, proyeccionMetaFinanciera, listarPlantillas, aplicarPlantilla, resumen, dashboardEjecutivo, listarMetas, guardarMeta, cobrosSinPolitica, procesarCobrosSinPolitica };
