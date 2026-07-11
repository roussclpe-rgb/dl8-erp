const { db } = require("../../db");
const catalogos = require("./catalogos");
const motor = require("./motor");
const { aMinorPEN } = require("./montos");
const { hashCanonico } = require("./idempotencia");

const fallo = (message, status = 400) => Object.assign(new Error(message), { status });
const fechaHoy = () => new Date().toISOString().slice(0, 10);

function pagoIdempotente({ usuarioId, clave, hashPayload }) {
  if (!clave) return null;
  const previo = db.prepare("SELECT hash_payload,respuesta_json FROM pagos_cxp_claves_idempotencia WHERE usuario_id=? AND clave=?").get(usuarioId, clave);
  if (!previo) return null;
  if (previo.hash_payload !== hashPayload) throw fallo("La clave de idempotencia se usó con otro payload", 409);
  return JSON.parse(previo.respuesta_json);
}

function buscarPagoCxPIdempotente({ usuarioId, clave, payload }) {
  if (!clave) return null;
  return pagoIdempotente({ usuarioId, clave, hashPayload: hashCanonico(payload) });
}

function saldoDocumento(documentoId) {
  const documento = db.prepare("SELECT * FROM fin_documentos_cxp WHERE id=?").get(documentoId);
  if (!documento) throw fallo("Documento CxP no encontrado", 404);
  const aplicadoMinor = db.prepare("SELECT COALESCE(SUM(importe_minor),0) total FROM fin_aplicaciones_cxp WHERE documento_cxp_id=? AND estado='confirmada'").get(documentoId).total;
  const notasMinor = db.prepare("SELECT COALESCE(SUM(importe_minor),0) total FROM fin_notas_credito_cxp WHERE documento_cxp_id=? AND estado='confirmada'").get(documentoId).total;
  return { documento, aplicadoMinor, notasMinor, saldoMinor: documento.importe_original_minor - aplicadoMinor - notasMinor };
}

function cuentaOrigen({ entidadId, metodoPago, cuentaFinancieraId, turnoCajaId }) {
  const tipos = { Efectivo: "caja", Yape: "billetera", Plin: "billetera", Transferencia: "banco", Tarjeta: "procesador" };
  const tipo = tipos[metodoPago];
  if (!tipo) throw fallo("Método de pago no soportado");
  if (!cuentaFinancieraId) throw fallo("Selecciona una cuenta financiera de origen", 409);
  const cuenta = db.prepare(`SELECT cf.*,pc.id cuenta_contable_id FROM fin_cuentas_financieras cf
    JOIN fin_plan_cuentas pc ON pc.id=cf.cuenta_contable_id
    WHERE cf.id=? AND cf.entidad_id=? AND cf.tipo=? AND cf.estado='activa'`).get(cuentaFinancieraId, entidadId, tipo);
  if (!cuenta) throw fallo("La cuenta financiera no pertenece a la entidad o no coincide con el método", 409);
  if (metodoPago !== "Efectivo") {
    if (turnoCajaId) throw fallo("Solo el efectivo puede vincularse a un turno de caja");
    return { cuenta, turnoId: null };
  }
  if (!turnoCajaId) throw fallo("El efectivo requiere un turno de caja abierto", 409);
  const turno = db.prepare(`SELECT t.id FROM turnos_caja t JOIN cajas c ON c.id=t.caja_id
    WHERE t.id=? AND t.estado='abierto' AND c.activo=1 AND c.entidad_id=? AND c.cuenta_financiera_id=?`).get(turnoCajaId, entidadId, cuenta.id);
  if (!turno) throw fallo("El turno de caja no corresponde a la cuenta de origen", 409);
  return { cuenta, turnoId: turno.id };
}

function bolsilloOrigen(entidadId, bolsilloId) {
  const bolsillo = db.prepare("SELECT * FROM fin_bolsillos WHERE id=? AND entidad_id=? AND estado='activa'").get(bolsilloId, entidadId);
  if (!bolsillo) throw fallo("El bolsillo no pertenece a la entidad o no está activo", 409);
  return bolsillo;
}

function estadoPorSaldo(original, saldo) {
  if (saldo === 0) return "pagada";
  if (saldo < original) return "parcial";
  return "abierta";
}

const registrarPagoCxP = db.transaction(({ entidadId, proveedorId, cuentaFinancieraId, bolsilloId, metodoPago, turnoCajaId = null, fecha = fechaHoy(), monto, aplicaciones, usuarioId, claveIdempotencia = null, payloadIdempotencia }) => {
  const hashPayload = claveIdempotencia ? hashCanonico(payloadIdempotencia) : null;
  const previo = pagoIdempotente({ usuarioId, clave: claveIdempotencia, hashPayload });
  if (previo) return previo;
  catalogos.exigirAcceso(entidadId, usuarioId, ["finanzas_admin", "finanzas_operador", "finanzas_personal_propietario"]);
  const proveedor = db.prepare("SELECT * FROM proveedores WHERE id=? AND activo=1").get(proveedorId);
  if (!proveedor) throw fallo("Proveedor no existe o está inactivo");
  if (!Array.isArray(aplicaciones) || aplicaciones.length === 0) throw fallo("Agrega al menos una aplicación CxP");
  const importeMinor = aMinorPEN(monto);
  if (importeMinor <= 0) throw fallo("El pago debe ser mayor a cero");
  const origen = cuentaOrigen({ entidadId, metodoPago, cuentaFinancieraId, turnoCajaId });
  const bolsillo = bolsilloOrigen(entidadId, bolsilloId);
  const aplicacionesNormalizadas = aplicaciones.map((aplicacion) => ({ documentoId: Number(aplicacion.documento_cxp_id), importeMinor: aMinorPEN(aplicacion.monto) }));
  if (aplicacionesNormalizadas.some((a) => !Number.isSafeInteger(a.documentoId) || a.documentoId <= 0 || a.importeMinor <= 0)) throw fallo("Las aplicaciones deben tener documento e importe positivos");
  if (new Set(aplicacionesNormalizadas.map((a) => a.documentoId)).size !== aplicacionesNormalizadas.length) throw fallo("No repitas un documento CxP en el mismo pago", 409);
  const totalAplicado = aplicacionesNormalizadas.reduce((total, a) => total + a.importeMinor, 0);
  if (!Number.isSafeInteger(totalAplicado) || totalAplicado !== importeMinor) throw fallo("Las aplicaciones deben totalizar exactamente el importe del pago", 409);
  const saldos = aplicacionesNormalizadas.map((a) => ({ ...a, ...saldoDocumento(a.documentoId) }));
  saldos.forEach(({ documento, saldoMinor, importeMinor: importeAplicacion }) => {
    if (documento.entidad_id !== entidadId || documento.proveedor_id !== proveedor.id) throw fallo("La CxP no pertenece al proveedor o entidad del pago", 409);
    if (documento.estado === "anulada") throw fallo("No se puede pagar una CxP anulada", 409);
    if (importeAplicacion > saldoMinor) throw fallo("La aplicación supera el saldo pendiente de la CxP", 409);
  });

  const cuentaCxp = db.prepare("SELECT id FROM fin_plan_cuentas WHERE entidad_id=? AND codigo='2101' AND estado='activa' AND permite_movimiento=1").get(entidadId);
  if (!cuentaCxp) throw fallo("La entidad no tiene la cuenta 2101 activa", 409);
  const claveEvento = claveIdempotencia
    ? `cxp-pago-${usuarioId}-${claveIdempotencia}`
    : `cxp-pago-${Date.now()}-${Math.random()}`;
  const evento = motor.ejecutar({
    entidadId, tipo: "pago_compra", fecha, descripcion: `Pago a proveedor ${proveedor.nombre}`,
    usuarioId, clave: claveEvento,
    payload: { entidadId, proveedorId: proveedor.id, cuentaFinancieraId: origen.cuenta.id, bolsilloId: bolsillo.id, metodoPago, turnoCajaId: origen.turnoId, importeMinor, aplicaciones: aplicacionesNormalizadas },
    lineas: [
      { cuenta_contable_id: cuentaCxp.id, debe_minor: importeMinor, haber_minor: 0 },
      { cuenta_contable_id: origen.cuenta.cuenta_contable_id, cuenta_financiera_id: origen.cuenta.id, debe_minor: 0, haber_minor: importeMinor },
    ],
    asigs: [{ cuenta_origen_id: origen.cuenta.id, bolsillo_origen_id: bolsillo.id, importe_minor: importeMinor }],
  });
  const pagoId = Number(db.prepare(`INSERT INTO fin_pagos_cxp
    (entidad_id,proveedor_id,evento_financiero_id,cuenta_financiera_id,bolsillo_id,turno_caja_id,metodo_pago,importe_minor,fecha,estado,creado_por)
    VALUES(?,?,?,?,?,?,?,?,?,'pendiente',?)`).run(entidadId, proveedor.id, evento.id, origen.cuenta.id, bolsillo.id, origen.turnoId, metodoPago, importeMinor, fecha, usuarioId).lastInsertRowid);
  const insertarAplicacion = db.prepare(`INSERT INTO fin_aplicaciones_cxp(documento_cxp_id,pago_cxp_id,evento_financiero_id,importe_minor,fecha_aplicacion,creado_por)
    VALUES(?,?,?,?,?,?)`);
  saldos.forEach(({ documentoId, importeMinor: importeAplicacion }) => insertarAplicacion.run(documentoId, pagoId, evento.id, importeAplicacion, fecha, usuarioId));
  db.prepare("UPDATE fin_pagos_cxp SET estado='confirmado' WHERE id=?").run(pagoId);
  const estados = saldos.map(({ documentoId, documento }) => {
    const saldo = saldoDocumento(documentoId).saldoMinor;
    const estado = estadoPorSaldo(documento.importe_original_minor, saldo);
    db.prepare("UPDATE fin_documentos_cxp SET estado=? WHERE id=?").run(estado, documentoId);
    return { documento_cxp_id: documentoId, saldo_minor: saldo, saldo: saldo / 100, estado_cxp: estado };
  });
  const respuesta = { pago_cxp_id: pagoId, evento_financiero_id: evento.id, importe_minor: importeMinor, importe: importeMinor / 100, aplicaciones: estados };
  db.prepare("INSERT INTO fin_auditoria(entidad_id,usuario_id,accion,entidad_tabla,entidad_registro_id,datos_despues) VALUES(?,?,'crear','fin_pagos_cxp',?,?)")
    .run(entidadId, usuarioId, pagoId, JSON.stringify(respuesta));
  if (claveIdempotencia) db.prepare("INSERT INTO pagos_cxp_claves_idempotencia(usuario_id,clave,hash_payload,respuesta_json) VALUES(?,?,?,?)")
    .run(usuarioId, claveIdempotencia, hashPayload, JSON.stringify(respuesta));
  return respuesta;
});

module.exports = { registrarPagoCxP, buscarPagoCxPIdempotente, saldoDocumento };
