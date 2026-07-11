const { db } = require("../../db");
const catalogos = require("./catalogos");
const motor = require("./motor");
const { aMinorPEN } = require("./montos");
const { hashCanonico } = require("./idempotencia");
const { saldoDocumento } = require("./pagos-cxp");

const fallo = (message, status = 400) => Object.assign(new Error(message), { status });
const estadoPorSaldo = (original, saldo) => saldo === 0 ? "pagada" : saldo < original ? "parcial" : "abierta";
const previo = (usuarioId, clave, payload) => {
  if (!clave) return null;
  const existente = db.prepare("SELECT hash_payload,respuesta_json FROM correcciones_cxp_claves_idempotencia WHERE usuario_id=? AND clave=?").get(usuarioId, clave);
  const hash = hashCanonico(payload);
  if (!existente) return { hash };
  if (existente.hash_payload !== hash) throw fallo("La clave de idempotencia se uso con otro payload", 409);
  return JSON.parse(existente.respuesta_json);
};
const guardar = (usuarioId, clave, hash, respuesta) => {
  if (clave) db.prepare("INSERT INTO correcciones_cxp_claves_idempotencia(usuario_id,clave,hash_payload,respuesta_json) VALUES(?,?,?,?)").run(usuarioId, clave, hash, JSON.stringify(respuesta));
};

const anularCompra = db.transaction(({ loteId, usuarioId }) => {
  const compra = db.prepare(`SELECT l.*,d.id documento_id,d.entidad_id,d.evento_emision_id
    FROM lotes_compra l JOIN fin_documentos_cxp d ON d.lote_compra_id=l.id WHERE l.id=?`).get(loteId);
  if (!compra) throw fallo("Compra financiera no encontrada", 404);
  catalogos.exigirAcceso(compra.entidad_id, usuarioId, ["finanzas_admin", "finanzas_personal_propietario"]);
  if (compra.anulado) throw fallo("La compra ya fue anulada", 409);
  if (compra.cantidad_restante !== compra.cantidad_total_base) throw fallo("La compra tiene consumo del lote; requiere devolucion o nota de credito", 409);
  if (db.prepare("SELECT 1 FROM fin_aplicaciones_cxp WHERE documento_cxp_id=? AND estado='confirmada'").get(compra.documento_id)) throw fallo("La compra tiene pagos confirmados; revierte los pagos primero", 409);
  const reversion = motor.revertir({ entidadId: compra.entidad_id, eventoId: compra.evento_emision_id, usuarioId, clave: `anular-compra-${compra.loteId || loteId}`, permitirVinculado: true });
  db.prepare("UPDATE lotes_compra SET anulado=1 WHERE id=?").run(loteId);
  db.prepare("UPDATE fin_documentos_cxp SET estado='anulada' WHERE id=?").run(compra.documento_id);
  db.prepare(`INSERT INTO movimientos_inventario
    (ingrediente_id,tipo,cantidad_base,costo_unidad_base,referencia_tipo,referencia_id,motivo,usuario_id,fecha,periodo_id)
    VALUES(?,'reversion',?,?, 'lote_compra',?,'Anulacion compra',?,?,?)`)
    .run(compra.ingrediente_id, -compra.cantidad_total_base, compra.costo_unidad_base, loteId, usuarioId, compra.fecha_compra, compra.periodo_id);
  return { ok: true, reversion_evento_id: reversion.id };
});

const anularCompraIdempotente = db.transaction(({ loteId, usuarioId, clave }) => {
  const payload = { tipo: "anular_compra_cxp", loteId: Number(loteId) };
  const existente = previo(usuarioId, clave, payload);
  if (existente && existente.hash === undefined) return existente;
  const respuesta = anularCompra({ loteId, usuarioId });
  guardar(usuarioId, clave, existente && existente.hash, respuesta);
  return respuesta;
});

const revertirPago = db.transaction(({ pagoId, usuarioId, clave }) => {
  const payload = { tipo: "reversion_pago_cxp", pagoId: Number(pagoId) };
  const existente = previo(usuarioId, clave, payload);
  if (existente && existente.hash === undefined) return existente;
  const pago = db.prepare("SELECT * FROM fin_pagos_cxp WHERE id=?").get(pagoId);
  if (!pago) throw fallo("Pago CxP no encontrado", 404);
  catalogos.exigirAcceso(pago.entidad_id, usuarioId, ["finanzas_admin", "finanzas_personal_propietario"]);
  if (pago.estado !== "confirmado") throw fallo("El pago no esta confirmado", 409);
  const reversion = motor.revertir({ entidadId: pago.entidad_id, eventoId: pago.evento_financiero_id, usuarioId, clave: clave || `revertir-pago-cxp-${pago.id}`, permitirVinculado: true });
  db.prepare("UPDATE fin_aplicaciones_cxp SET estado='revertida' WHERE pago_cxp_id=? AND estado='confirmada'").run(pago.id);
  db.prepare("UPDATE fin_pagos_cxp SET estado='revertido' WHERE id=?").run(pago.id);
  db.prepare("SELECT DISTINCT documento_cxp_id FROM fin_aplicaciones_cxp WHERE pago_cxp_id=?").all(pago.id).forEach(({ documento_cxp_id }) => {
    const saldo = saldoDocumento(documento_cxp_id);
    db.prepare("UPDATE fin_documentos_cxp SET estado=? WHERE id=?").run(estadoPorSaldo(saldo.documento.importe_original_minor, saldo.saldoMinor), documento_cxp_id);
  });
  const respuesta = { ok: true, reversion_evento_id: reversion.id };
  guardar(usuarioId, clave, existente && existente.hash, respuesta);
  return respuesta;
});

const registrarNotaCredito = db.transaction(({ documentoId, entidadId, proveedorId, cantidadBase, importe, fecha, usuarioId, clave }) => {
  const payload = { tipo: "nota_credito_cxp", documentoId: Number(documentoId), entidadId: Number(entidadId), proveedorId: Number(proveedorId), cantidadBase, importe, fecha };
  const existente = previo(usuarioId, clave, payload);
  if (existente && existente.hash === undefined) return existente;
  const documento = db.prepare(`SELECT d.*,l.cantidad_restante,l.ingrediente_id,l.costo_unidad_base,l.periodo_id
    FROM fin_documentos_cxp d JOIN lotes_compra l ON l.id=d.lote_compra_id WHERE d.id=?`).get(documentoId);
  if (!documento) throw fallo("Documento CxP no encontrado", 404);
  if (!Number.isSafeInteger(entidadId) || entidadId !== documento.entidad_id) throw fallo("La entidad no coincide con la CxP", 409);
  if (!Number.isSafeInteger(proveedorId) || proveedorId !== documento.proveedor_id) throw fallo("El proveedor no coincide con la CxP", 409);
  if (documento.estado === "anulada") throw fallo("No se puede corregir una CxP anulada", 409);
  catalogos.exigirAcceso(documento.entidad_id, usuarioId, ["finanzas_admin", "finanzas_personal_propietario"]);
  const cantidad = Number(cantidadBase);
  const importeMinor = aMinorPEN(importe);
  if (!(cantidad > 0) || importeMinor <= 0) throw fallo("Cantidad e importe deben ser positivos");
  if (cantidad > documento.cantidad_restante) throw fallo("La devolucion supera el inventario disponible", 409);
  const saldoInicial = saldoDocumento(documento.id);
  if (importeMinor > saldoInicial.saldoMinor) throw fallo("La nota supera el saldo corregible de la CxP", 409);
  const cuentaInventario = db.prepare("SELECT id FROM fin_plan_cuentas WHERE entidad_id=? AND codigo='1301'").get(documento.entidad_id).id;
  const cuentaCxP = db.prepare("SELECT id FROM fin_plan_cuentas WHERE entidad_id=? AND codigo='2101'").get(documento.entidad_id).id;
  const evento = motor.ejecutar({ entidadId: documento.entidad_id, tipo: "nota_credito_compra", fecha, descripcion: `Nota de credito compra ${documento.lote_compra_id}`, usuarioId, clave: `nota-cxp-${usuarioId}-${clave || Date.now()}`, payload, lineas: [{ cuenta_contable_id: cuentaCxP, debe_minor: importeMinor, haber_minor: 0 }, { cuenta_contable_id: cuentaInventario, debe_minor: 0, haber_minor: importeMinor }] });
  const notaId = Number(db.prepare(`INSERT INTO fin_notas_credito_cxp(documento_cxp_id,entidad_id,lote_compra_id,evento_financiero_id,cantidad_base,importe_minor,fecha,creado_por) VALUES(?,?,?,?,?,?,?,?)`).run(documento.id, documento.entidad_id, documento.lote_compra_id, evento.id, cantidad, importeMinor, fecha, usuarioId).lastInsertRowid);
  db.prepare("UPDATE lotes_compra SET cantidad_restante=cantidad_restante-? WHERE id=?").run(cantidad, documento.lote_compra_id);
  db.prepare(`INSERT INTO movimientos_inventario(ingrediente_id,tipo,cantidad_base,costo_unidad_base,referencia_tipo,referencia_id,motivo,usuario_id,fecha,periodo_id) VALUES(?,'reversion',?,?,'nota_credito_cxp',?,'Devolucion a proveedor',?,?,?)`).run(documento.ingrediente_id, -cantidad, documento.costo_unidad_base, notaId, usuarioId, fecha, documento.periodo_id);
  const saldoFinal = saldoDocumento(documento.id).saldoMinor;
  const estadoFinal = estadoPorSaldo(documento.importe_original_minor, saldoFinal);
  db.prepare("UPDATE fin_documentos_cxp SET estado=? WHERE id=?").run(estadoFinal, documento.id);
  const respuesta = { nota_credito_id: notaId, evento_financiero_id: evento.id, saldo_minor: saldoFinal, saldo: saldoFinal / 100, estado_cxp: estadoFinal };
  guardar(usuarioId, clave, existente && existente.hash, respuesta);
  return respuesta;
});

module.exports = { anularCompra, anularCompraIdempotente, revertirPago, registrarNotaCredito };
