const express = require("express");
const { db } = require("../db");
const { requireAuth } = require("../middleware/auth");
const politicas = require("../services/finanzas/politicas");
const catalogos = require("../services/finanzas/catalogos");

const router = express.Router();
router.use(requireAuth);

const TIPOS = new Set(["facturacion", "unidades_vendidas", "utilidad_bruta"]);
const ESTADOS = new Set(["activo", "cumplido", "vencido", "cancelado"]);
const CANALES = new Set(["Efectivo", "Yape", "Transferencia", "Tarjeta"]);

function error(mensaje, status = 400) { const e = new Error(mensaje); e.status = status; return e; }
function fechaValida(valor, campo) {
  if (typeof valor !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(valor) || Number.isNaN(new Date(`${valor}T00:00:00Z`).getTime())) throw error(`${campo} debe tener el formato AAAA-MM-DD`);
  return valor;
}
function validar(body) {
  const nombre = String(body.nombre || "").trim();
  const tipo = body.tipo;
  const valorObjetivo = Number(body.valor_objetivo);
  const fechaInicio = fechaValida(body.fecha_inicio, "La fecha de inicio");
  const fechaFin = fechaValida(body.fecha_fin, "La fecha de fin");
  const observaciones = body.observaciones == null ? "" : String(body.observaciones).trim();
  const entidadId = body.entidad_id == null || body.entidad_id === "" ? null : Number(body.entidad_id);
  const productoId = body.producto_id == null || body.producto_id === "" ? null : Number(body.producto_id);
  const vendedorId = body.vendedor_id == null || body.vendedor_id === "" ? null : Number(body.vendedor_id);
  const canalVenta = body.canal_venta == null || body.canal_venta === "" ? null : String(body.canal_venta);
  if (nombre.length < 3 || nombre.length > 120) throw error("El nombre debe tener entre 3 y 120 caracteres");
  if (!TIPOS.has(tipo)) throw error("El tipo de objetivo no es válido");
  if (!Number.isFinite(valorObjetivo) || valorObjetivo <= 0 || valorObjetivo > 1e12) throw error("El valor objetivo debe ser mayor que cero");
  if (fechaInicio > fechaFin) throw error("La fecha de inicio no puede ser posterior a la fecha de fin");
  if (observaciones.length > 1000) throw error("Las observaciones no pueden superar los 1000 caracteres");
  for (const [valor, campo] of [[entidadId, "La entidad"], [productoId, "El producto"], [vendedorId, "El vendedor"]]) if (valor != null && (!Number.isSafeInteger(valor) || valor <= 0)) throw error(`${campo} no es válido`);
  if (canalVenta && !CANALES.has(canalVenta)) throw error("El canal de venta no es válido");
  return { nombre, tipo, valorObjetivo, fechaInicio, fechaFin, observaciones, entidadId, productoId, vendedorId, canalVenta };
}

function filtros(fila, alias = "v") {
  const where = [`${alias}.anulado = 0`, `date(${alias}.fecha) BETWEEN ? AND ?`]; const params = [fila.fecha_inicio, fila.fecha_fin];
  if (fila.vendedor_id) { where.push(`${alias}.usuario_id = ?`); params.push(fila.vendedor_id); }
  if (fila.entidad_id) { where.push(`EXISTS (SELECT 1 FROM fin_documentos_cxc d WHERE d.venta_id=${alias}.id AND d.entidad_id=?)`); params.push(fila.entidad_id); }
  if (fila.canal_venta) { where.push(`EXISTS (SELECT 1 FROM pagos pg WHERE pg.venta_id=${alias}.id AND pg.metodo_pago=?)`); params.push(fila.canal_venta); }
  return { where: where.join(" AND "), params };
}
function metricas(fila, hasta = fila.fecha_fin) {
  const copia = { ...fila, fecha_fin: hasta }; const filtro = filtros(copia);
  const productos = copia.producto_id ? " AND vi.receta_grupo_id=?" : "";
  const productoParams = copia.producto_id ? [copia.producto_id] : [];
  const total = db.prepare(`SELECT COALESCE(SUM(v.total), 0) AS facturacion FROM ventas v WHERE ${filtro.where}`).get(...filtro.params);
  const lineas = db.prepare(`SELECT COALESCE(SUM(vi.subtotal), 0) AS facturacion, COALESCE(SUM(vi.cantidad), 0) AS unidades,
      COALESCE(SUM(vic.costo_total), 0) AS costo
    FROM ventas v JOIN venta_items vi ON vi.venta_id = v.id
    LEFT JOIN (
      SELECT venta_item_id, SUM(cantidad * costo_unidad) AS costo_total
      FROM venta_item_costos GROUP BY venta_item_id
    ) vic ON vic.venta_item_id = vi.id
    WHERE ${filtro.where}${productos}`).get(...filtro.params, ...productoParams);
  const facturacion = copia.producto_id ? Number(lineas.facturacion) : Number(total.facturacion);
  return { facturacion, unidades: Number(lineas.unidades), costo: Number(lineas.costo), valor: copia.tipo === "facturacion" ? facturacion : copia.tipo === "unidades_vendidas" ? Number(lineas.unidades) : facturacion - Number(lineas.costo) };
}

function diasEntre(inicio, fin) { return Math.max(1, Math.round((Date.parse(`${fin}T00:00:00Z`) - Date.parse(`${inicio}T00:00:00Z`)) / 86400000) + 1); }
function hoyISO() { return new Date().toISOString().slice(0, 10); }
function proyeccion(fila, avance) {
  const hoy = hoyISO(); const corte = hoy < fila.fecha_inicio ? fila.fecha_inicio : (hoy > fila.fecha_fin ? fila.fecha_fin : hoy);
  const diasConDatos = hoy < fila.fecha_inicio ? 0 : diasEntre(fila.fecha_inicio, corte);
  const totalDias = diasEntre(fila.fecha_inicio, fila.fecha_fin);
  const ritmoDiario = diasConDatos ? avance / diasConDatos : 0;
  const cierre = ritmoDiario * totalDias;
  const faltante = Math.max(0, Number(fila.valor_objetivo) - avance);
  const fechaEstimada = ritmoDiario > 0 ? new Date(Date.parse(`${hoy}T00:00:00Z`) + Math.ceil(faltante / ritmoDiario) * 86400000).toISOString().slice(0, 10) : null;
  return { ritmo_diario: ritmoDiario, fecha_estimada_cumplimiento: fechaEstimada, proyeccion_cierre: cierre, dias_con_datos: diasConDatos };
}
function presentar(fila) {
  const hoy = hoyISO();
  const avanceActual = metricas(fila, hoy < fila.fecha_fin ? hoy : fila.fecha_fin).valor;
  const valorFaltante = Math.max(0, Number(fila.valor_objetivo) - avanceActual);
  const porcentajeCumplimiento = Math.min(100, (avanceActual / Number(fila.valor_objetivo)) * 100);
  const diasRestantes = hoy > fila.fecha_fin ? 0 : diasEntre(hoy, fila.fecha_fin) - 1;
  let estado = fila.estado;
  if (estado === "activo" && avanceActual >= Number(fila.valor_objetivo)) estado = "cumplido";
  else if (estado === "activo" && hoy > fila.fecha_fin) estado = "vencido";
  let estadoVisual = "En camino";
  if (estado === "cumplido") estadoVisual = "Cumplido";
  else if (estado === "vencido" || estado === "cancelado") estadoVisual = "En riesgo";
  else {
    const total = diasEntre(fila.fecha_inicio, fila.fecha_fin);
    const transcurridos = hoy <= fila.fecha_inicio ? 0 : Math.min(total, diasEntre(fila.fecha_inicio, hoy) - 1);
    const esperado = (transcurridos / total) * 100;
    if (porcentajeCumplimiento >= esperado + 10) estadoVisual = "Adelantado";
    else if (porcentajeCumplimiento < esperado - 10) estadoVisual = "En riesgo";
  }
  return { ...fila, estado, avance_actual: avanceActual, valor_faltante: valorFaltante, porcentaje_cumplimiento: porcentajeCumplimiento, dias_restantes: diasRestantes, estado_visual: estadoVisual, ...proyeccion(fila, avanceActual) };
}

function resumenObjetivos() {
  const objetivos = db.prepare("SELECT * FROM objetivos_negocio ORDER BY fecha_fin ASC, id DESC").all().map(presentar);
  const activos = objetivos.filter((x) => x.estado === "activo");
  const riesgo = activos.filter((x) => x.estado_visual === "En riesgo");
  const proximos = activos.filter((x) => x.dias_restantes <= 7);
  const tendencia = db.prepare(`SELECT date(fecha) fecha, ROUND(SUM(total),2) ventas FROM ventas
    WHERE anulado=0 AND date(fecha) >= date('now','-29 days') GROUP BY date(fecha) ORDER BY fecha`).all();
  const promedio = activos.length ? activos.reduce((s, x) => s + x.porcentaje_cumplimiento, 0) / activos.length : 0;
  return { objetivos, resumen: { activos: activos.length, cumplidos: objetivos.filter((x) => x.estado === "cumplido").length, en_riesgo: riesgo.length, proximos_a_vencer: proximos.length, progreso_general: promedio, proyeccion_cierre: activos.reduce((s, x) => s + x.proyeccion_cierre, 0) }, tendencia };
}

function politicaSimulada(fila, importeProyectado, req) {
  if (fila.tipo !== "facturacion") return { disponible: false, mensaje: "El impacto financiero se calcula a partir de ventas necesarias." };
  if (!fila.entidad_id) return { disponible: false, mensaje: "Selecciona una entidad al editar este objetivo para simular la distribución." };
  catalogos.exigirAcceso(fila.entidad_id, req.usuario.id, catalogos.ROLES_FINANCIEROS);
  const politica = db.prepare("SELECT * FROM mpf_politicas WHERE entidad_id=? AND evento_tipo='cobro_venta' AND estado='activa' AND es_predeterminada=1").get(fila.entidad_id);
  if (!politica) return { disponible: false, mensaje: "No hay una política financiera activa para esta entidad. Activa una política para ver la simulación." };
  const hasta = hoyISO() < fila.fecha_fin ? hoyISO() : fila.fecha_fin;
  const metricasPeriodo = metricas(fila, hasta); const base = Math.max(0, Math.round(importeProyectado * 100));
  const costoMinor = politica.recupera_costo && metricasPeriodo.facturacion > 0 ? Math.round(base * metricasPeriodo.costo / metricasPeriodo.facturacion) : 0;
  const simulacion = politicas.simular({ entidadId: fila.entidad_id, politicaId: politica.id, importeIngresoMinor: base, contexto: { canal: fila.canal_venta || undefined } });
  return { disponible: true, solo_simulacion: true, importe_proyectado_minor: base, politica: { id: politica.id, nombre: politica.nombre, version: politica.version }, recuperacion_costo_minor: costoMinor, distribucion: simulacion.detalles, disponible_minor: simulacion.disponible_minor };
}

router.get("/", (req, res, next) => {
  try { res.json(db.prepare("SELECT * FROM objetivos_negocio ORDER BY fecha_fin ASC, id DESC").all().map(presentar)); } catch (e) { next(e); }
});

router.get("/dashboard", (req, res, next) => { try { res.json(resumenObjetivos()); } catch (e) { next(e); } });

router.post("/", (req, res, next) => {
  try {
    const x = validar(req.body);
    const id = db.prepare("INSERT INTO objetivos_negocio(nombre,tipo,valor_objetivo,fecha_inicio,fecha_fin,estado,observaciones,entidad_id,producto_id,vendedor_id,canal_venta,usuario_id) VALUES(?,?,?,?,?,'activo',?,?,?,?,?,?)")
      .run(x.nombre, x.tipo, x.valorObjetivo, x.fechaInicio, x.fechaFin, x.observaciones, x.entidadId, x.productoId, x.vendedorId, x.canalVenta, req.usuario.id).lastInsertRowid;
    res.status(201).json(presentar(db.prepare("SELECT * FROM objetivos_negocio WHERE id=?").get(id)));
  } catch (e) { next(e); }
});

router.put("/:id", (req, res, next) => {
  try {
    const actual = db.prepare("SELECT * FROM objetivos_negocio WHERE id=?").get(req.params.id);
    if (!actual) throw error("No existe el objetivo", 404);
    const x = validar(req.body);
    db.prepare("UPDATE objetivos_negocio SET nombre=?,tipo=?,valor_objetivo=?,fecha_inicio=?,fecha_fin=?,observaciones=?,entidad_id=?,producto_id=?,vendedor_id=?,canal_venta=?,actualizado_en=datetime('now') WHERE id=?")
      .run(x.nombre, x.tipo, x.valorObjetivo, x.fechaInicio, x.fechaFin, x.observaciones, x.entidadId, x.productoId, x.vendedorId, x.canalVenta, actual.id);
    res.json(presentar(db.prepare("SELECT * FROM objetivos_negocio WHERE id=?").get(actual.id)));
  } catch (e) { next(e); }
});

router.get("/opciones", (req, res, next) => {
  try {
    const productos = db.prepare("SELECT DISTINCT vi.receta_grupo_id id, vi.nombre_producto nombre FROM venta_items vi ORDER BY nombre").all();
    const vendedores = db.prepare("SELECT DISTINCT u.id,u.nombre FROM usuarios u JOIN ventas v ON v.usuario_id=u.id ORDER BY u.nombre").all();
    res.json({ productos, vendedores, canales: [...CANALES] });
  } catch (e) { next(e); }
});

router.get("/:id/simulacion-politica", (req, res, next) => {
  try {
    const fila = db.prepare("SELECT * FROM objetivos_negocio WHERE id=?").get(req.params.id);
    if (!fila) throw error("No existe el objetivo", 404);
    res.json(politicaSimulada(fila, presentar(fila).proyeccion_cierre, req));
  } catch (e) { next(e); }
});

router.post("/:id/simulador", (req, res, next) => {
  try {
    const fila = db.prepare("SELECT * FROM objetivos_negocio WHERE id=?").get(req.params.id);
    if (!fila) throw error("No existe el objetivo", 404);
    const objetivo = Number(req.body.valor_objetivo);
    if (!Number.isFinite(objetivo) || objetivo <= 0) throw error("El valor objetivo debe ser mayor que cero");
    const datos = presentar(fila); const hasta = hoyISO() < fila.fecha_fin ? hoyISO() : fila.fecha_fin; const m = metricas(fila, hasta);
    const precioMedio = m.unidades > 0 ? m.facturacion / m.unidades : 0; const margen = m.facturacion > 0 ? (m.facturacion - m.costo) / m.facturacion : 0;
    const faltante = Math.max(0, objetivo - datos.avance_actual);
    const ventasNecesarias = fila.tipo === "facturacion" ? faltante : fila.tipo === "unidades_vendidas" ? faltante * precioMedio : (margen > 0 ? faltante / margen : 0);
    const unidadesNecesarias = fila.tipo === "unidades_vendidas" ? faltante : (precioMedio > 0 ? ventasNecesarias / precioMedio : 0);
    const tiempoEstimadoDias = datos.ritmo_diario > 0 ? faltante / datos.ritmo_diario : null;
    res.json({ valor_objetivo: objetivo, avance_actual: datos.avance_actual, faltante, ventas_necesarias: ventasNecesarias, unidades_necesarias: unidadesNecesarias, tiempo_estimado_dias: tiempoEstimadoDias, impacto_financiero: politicaSimulada({ ...fila, tipo: "facturacion" }, ventasNecesarias, req) });
  } catch (e) { next(e); }
});

router.patch("/:id/estado", (req, res, next) => {
  try {
    const estado = String(req.body.estado || "").toLowerCase();
    if (!ESTADOS.has(estado)) throw error("El estado no es válido");
    const result = db.prepare("UPDATE objetivos_negocio SET estado=?,actualizado_en=datetime('now') WHERE id=?").run(estado, req.params.id);
    if (!result.changes) throw error("No existe el objetivo", 404);
    res.json(presentar(db.prepare("SELECT * FROM objetivos_negocio WHERE id=?").get(req.params.id)));
  } catch (e) { next(e); }
});

module.exports = router;
