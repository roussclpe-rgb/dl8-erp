const { db } = require("../../db");
const catalogos = require("./catalogos");

const fallo = (message, status = 400) => Object.assign(new Error(message), { status });
const fechaValida = (fecha, nombre) => {
  if (fecha == null || fecha === "") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw fallo(`${nombre} debe tener formato YYYY-MM-DD`);
  return fecha;
};
const idOpcional = (valor, nombre) => {
  if (valor == null || valor === "") return null;
  const id = Number(valor);
  if (!Number.isSafeInteger(id) || id <= 0) throw fallo(`${nombre} debe ser un ID positivo`);
  return id;
};

function saldoExpr(alias = "d") {
  return `((SELECT COALESCE(SUM(a.importe_minor),0) FROM fin_aplicaciones_cxp a WHERE a.documento_cxp_id=${alias}.id AND a.estado='confirmada')+(SELECT COALESCE(SUM(n.importe_minor),0) FROM fin_notas_credito_cxp n WHERE n.documento_cxp_id=${alias}.id AND n.estado='confirmada'))`;
}

function listarDocumentosCxP({ entidadId, usuarioId, filtros = {} }) {
  const entidad = Number(entidadId);
  if (!Number.isSafeInteger(entidad) || entidad <= 0) throw fallo("entidad_id es obligatorio");
  catalogos.exigirAcceso(entidad, usuarioId);
  const proveedorId = idOpcional(filtros.proveedor_id, "proveedor_id");
  const estados = ["abierta", "parcial", "pagada", "anulada"];
  const estado = filtros.estado || null;
  if (estado && !estados.includes(estado)) throw fallo("estado CxP inválido");
  const desde = fechaValida(filtros.fecha_emision_desde || filtros.desde, "fecha_emision_desde");
  const hasta = fechaValida(filtros.fecha_emision_hasta || filtros.hasta, "fecha_emision_hasta");
  const venceDesde = fechaValida(filtros.fecha_vencimiento_desde, "fecha_vencimiento_desde");
  const venceHasta = fechaValida(filtros.fecha_vencimiento_hasta, "fecha_vencimiento_hasta");
  const aplicado = saldoExpr("d");
  const rows = db.prepare(`SELECT d.id,d.entidad_id,e.nombre entidad_nombre,d.proveedor_id,p.nombre proveedor_nombre,d.tipo_documento,d.fecha_emision,d.fecha_vencimiento,d.moneda,d.importe_original_minor,d.estado,d.evento_emision_id,d.lote_compra_id,
      ${aplicado} aplicado_minor,d.importe_original_minor-${aplicado} saldo_minor,
      l.fecha_compra,l.presentacion,l.cantidad_comprada,l.unidad_compra,l.cantidad_restante,l.costo_total,i.id ingrediente_id,i.nombre ingrediente_nombre,i.unidad_base
    FROM fin_documentos_cxp d
    JOIN fin_entidades_economicas e ON e.id=d.entidad_id
    JOIN proveedores p ON p.id=d.proveedor_id
    JOIN lotes_compra l ON l.id=d.lote_compra_id
    JOIN ingredientes i ON i.id=l.ingrediente_id
    WHERE d.entidad_id=? AND (? IS NULL OR d.proveedor_id=?) AND (? IS NULL OR d.estado=?)
      AND (? IS NULL OR d.fecha_emision>=?) AND (? IS NULL OR d.fecha_emision<=?)
      AND (? IS NULL OR d.fecha_vencimiento>=?) AND (? IS NULL OR d.fecha_vencimiento<=?)
    ORDER BY d.fecha_emision DESC,d.id DESC`).all(entidad, proveedorId, proveedorId, estado, estado, desde, desde, hasta, hasta, venceDesde, venceDesde, venceHasta, venceHasta);
  return rows.map((row) => ({ ...row, importe_original: row.importe_original_minor / 100, aplicado: row.aplicado_minor / 100, saldo: row.saldo_minor / 100, historico: false }));
}

function detalleDocumentoCxP({ documentoId, usuarioId }) {
  const id = Number(documentoId);
  if (!Number.isSafeInteger(id) || id <= 0) throw fallo("Documento CxP no encontrado", 404);
  const aplicado = saldoExpr("d");
  const documento = db.prepare(`SELECT d.*,e.nombre entidad_nombre,p.nombre proveedor_nombre,${aplicado} aplicado_minor,d.importe_original_minor-${aplicado} saldo_minor,
      l.*,i.nombre ingrediente_nombre,i.unidad_base
    FROM fin_documentos_cxp d JOIN fin_entidades_economicas e ON e.id=d.entidad_id JOIN proveedores p ON p.id=d.proveedor_id
    JOIN lotes_compra l ON l.id=d.lote_compra_id JOIN ingredientes i ON i.id=l.ingrediente_id WHERE d.id=?`).get(id);
  if (!documento) throw fallo("Documento CxP no encontrado", 404);
  catalogos.exigirAcceso(documento.entidad_id, usuarioId);
  const eventoEmision = db.prepare(`SELECT e.*,a.id asiento_id,a.fecha asiento_fecha,a.glosa FROM fin_eventos_financieros e
    LEFT JOIN fin_asientos_contables a ON a.evento_id=e.id WHERE e.id=?`).get(documento.evento_emision_id);
  const lineasEmision = db.prepare(`SELECT l.*,pc.codigo cuenta_codigo,pc.nombre cuenta_nombre FROM fin_lineas_asiento l JOIN fin_asientos_contables a ON a.id=l.asiento_id JOIN fin_plan_cuentas pc ON pc.id=l.cuenta_contable_id WHERE a.evento_id=? ORDER BY l.id`).all(documento.evento_emision_id);
  const aplicaciones = db.prepare(`SELECT a.*,p.id pago_cxp_id,p.metodo_pago,p.fecha pago_fecha,p.importe_minor pago_importe_minor,p.estado pago_estado,p.cuenta_financiera_id,p.bolsillo_id,e.descripcion evento_descripcion,c.nombre cuenta_financiera_nombre,b.nombre bolsillo_nombre
    FROM fin_aplicaciones_cxp a JOIN fin_pagos_cxp p ON p.id=a.pago_cxp_id JOIN fin_eventos_financieros e ON e.id=p.evento_financiero_id
    JOIN fin_cuentas_financieras c ON c.id=p.cuenta_financiera_id JOIN fin_bolsillos b ON b.id=p.bolsillo_id
    WHERE a.documento_cxp_id=? ORDER BY a.id`).all(id).map((a) => ({ ...a, importe: a.importe_minor / 100, pago_importe: a.pago_importe_minor / 100 }));
  const pagosMap = new Map();
  aplicaciones.forEach((aplicacion) => {
    if (!pagosMap.has(aplicacion.pago_cxp_id)) pagosMap.set(aplicacion.pago_cxp_id, {
      id: aplicacion.pago_cxp_id, evento_financiero_id: aplicacion.evento_financiero_id, fecha: aplicacion.pago_fecha, metodo_pago: aplicacion.metodo_pago,
      importe_minor: aplicacion.pago_importe_minor, importe: aplicacion.pago_importe, estado: aplicacion.pago_estado,
      cuenta_financiera_id: aplicacion.cuenta_financiera_id, cuenta_financiera_nombre: aplicacion.cuenta_financiera_nombre,
      bolsillo_id: aplicacion.bolsillo_id, bolsillo_nombre: aplicacion.bolsillo_nombre, aplicaciones: [],
    });
    pagosMap.get(aplicacion.pago_cxp_id).aplicaciones.push({ id: aplicacion.id, importe_minor: aplicacion.importe_minor, importe: aplicacion.importe, estado: aplicacion.estado, fecha_aplicacion: aplicacion.fecha_aplicacion });
  });
  return {
    documento: { ...documento, importe_original: documento.importe_original_minor / 100, aplicado: documento.aplicado_minor / 100, saldo: documento.saldo_minor / 100, historico: false },
    compra: { id: documento.lote_compra_id, ingrediente_id: documento.ingrediente_id, ingrediente_nombre: documento.ingrediente_nombre, unidad_base: documento.unidad_base, fecha_compra: documento.fecha_compra, presentacion: documento.presentacion, cantidad_comprada: documento.cantidad_comprada, unidad_compra: documento.unidad_compra, cantidad_restante: documento.cantidad_restante, costo_total: documento.costo_total },
    proveedor: { id: documento.proveedor_id, nombre: documento.proveedor_nombre },
    evento_emision: { ...eventoEmision, lineas: lineasEmision },
    aplicaciones,
    pagos: [...pagosMap.values()],
  };
}

function listarComprasHistoricas({ usuarioId, filtros = {} }) {
  const proveedorId = idOpcional(filtros.proveedor_id, "proveedor_id");
  const ingredienteId = idOpcional(filtros.ingrediente_id, "ingrediente_id");
  const desde = fechaValida(filtros.fecha_desde || filtros.fecha_compra_desde, "fecha_desde");
  const hasta = fechaValida(filtros.fecha_hasta || filtros.fecha_compra_hasta, "fecha_hasta");
  const rows = db.prepare(`SELECT l.*,p.nombre proveedor_nombre,i.nombre ingrediente_nombre,i.unidad_base
    FROM lotes_compra l JOIN ingredientes i ON i.id=l.ingrediente_id LEFT JOIN proveedores p ON p.id=l.proveedor_id
    LEFT JOIN fin_documentos_cxp d ON d.lote_compra_id=l.id
    WHERE d.id IS NULL AND l.anulado=0
      AND (? IS NULL OR l.proveedor_id=?) AND (? IS NULL OR l.ingrediente_id=?)
      AND (? IS NULL OR l.fecha_compra>=?) AND (? IS NULL OR l.fecha_compra<=?)
    ORDER BY l.fecha_compra DESC,l.id DESC`).all(proveedorId, proveedorId, ingredienteId, ingredienteId, desde, desde, hasta, hasta);
  // No hay entidad que autorizar en el legado: esta ruta solo expone el mismo historial operativo ya visible en /compras.
  if (!usuarioId) throw fallo("No autorizado", 403);
  return rows.map((row) => ({
    ...row, historico: true, documento_cxp_id: null, entidad_id: null,
    saldo_historico_inferible: false,
    advertencia_saldo_historico: "El saldo histórico no se puede inferir desde costo_total; requiere migración por fecha de corte y saldos iniciales por proveedor.",
  }));
}

module.exports = { listarDocumentosCxP, detalleDocumentoCxP, listarComprasHistoricas };
