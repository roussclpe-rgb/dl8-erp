const { db } = require("../../db");
const catalogos = require("./catalogos");
const motor = require("./motor");
const { aMinorPEN } = require("./montos");
const { hashCanonico } = require("./idempotencia");
const politicas = require("./politicas");

const fallo = (message, status = 400) => Object.assign(new Error(message), { status });
const fechaHoy = () => new Date().toISOString().slice(0, 10);

function buscarPagoIdempotente({ usuarioId, clave, ventaId, pagos, turnoCajaId }) {
  if (!clave) return null;
  const hashPayload = hashCanonico({ venta_id: Number(ventaId), pagos, turno_caja_id: turnoCajaId || null });
  const previo = db.prepare("SELECT hash_payload,respuesta_json FROM pagos_claves_idempotencia WHERE usuario_id=? AND clave=?").get(usuarioId, clave);
  if (!previo) return null;
  if (previo.hash_payload !== hashPayload) throw fallo("La clave de idempotencia se usó con otro payload", 409);
  return JSON.parse(previo.respuesta_json);
}

function saldoDocumento(documentoId) {
  const documento = db.prepare("SELECT * FROM fin_documentos_cxc WHERE id=?").get(documentoId);
  if (!documento) throw fallo("Documento CxC no encontrado", 404);
  const aplicado = db.prepare("SELECT COALESCE(SUM(importe_minor),0) total FROM fin_aplicaciones_cxc WHERE documento_cxc_id=? AND estado='confirmada'").get(documentoId).total;
  return { documento, aplicadoMinor: aplicado, saldoMinor: documento.importe_original_minor - aplicado };
}

function bolsilloSinAsignar(entidadId, bolsilloId) {
  const bolsillo = bolsilloId
    ? db.prepare("SELECT id FROM fin_bolsillos WHERE id=? AND entidad_id=? AND estado='activa'").get(bolsilloId, entidadId)
    : db.prepare("SELECT id FROM fin_bolsillos WHERE entidad_id=? AND tipo='sin_asignar' AND estado='activa'").get(entidadId);
  if (!bolsillo) throw fallo("No existe un bolsillo válido para recibir el cobro", 409);
  return bolsillo.id;
}

function cuentaReceptora({ entidadId, metodoPago, cuentaFinancieraId, turnoCajaId }) {
  if (metodoPago === "Efectivo") {
    if (!turnoCajaId) throw fallo("El efectivo requiere un turno de caja abierto", 409);
    const turno = db.prepare("SELECT * FROM turnos_caja WHERE id=? AND estado='abierto'").get(turnoCajaId);
    if (!turno) throw fallo("El efectivo requiere un turno de caja abierto", 409);
    const cuenta = db.prepare(`SELECT cf.*, pc.id cuenta_contable_id FROM cajas c
      JOIN fin_cuentas_financieras cf ON cf.id=c.cuenta_financiera_id
      JOIN fin_plan_cuentas pc ON pc.id=cf.cuenta_contable_id
      WHERE c.id=? AND c.activo=1 AND c.entidad_id=? AND cf.entidad_id=? AND cf.tipo='caja' AND cf.estado='activa'`).get(turno.caja_id, entidadId, entidadId);
    if (!cuenta) throw fallo("La caja del turno no pertenece a la entidad de la venta", 409);
    return { cuenta, turnoId: turno.id };
  }

  const tipos = { Yape: "billetera", Plin: "billetera", Transferencia: "banco", Tarjeta: "procesador" };
  const tipoEsperado = tipos[metodoPago];
  if (!tipoEsperado) throw fallo("Método de pago no soportado");
  if (!cuentaFinancieraId) throw fallo(`Selecciona una cuenta financiera tipo ${tipoEsperado} para ${metodoPago}`, 409);
  const cuenta = db.prepare(`SELECT cf.*, pc.id cuenta_contable_id FROM fin_cuentas_financieras cf
    JOIN fin_plan_cuentas pc ON pc.id=cf.cuenta_contable_id
    WHERE cf.id=? AND cf.entidad_id=? AND cf.tipo=? AND cf.estado='activa'`).get(cuentaFinancieraId, entidadId, tipoEsperado);
  if (!cuenta) throw fallo(`La cuenta financiera no es una ${tipoEsperado} activa de la entidad`, 409);
  return { cuenta, turnoId: null };
}

function estadoPorSaldo(importeOriginalMinor, saldoMinor) {
  if (saldoMinor === 0) return "pagada";
  if (saldoMinor < importeOriginalMinor) return "parcial";
  return "abierta";
}

// El costo se toma de la última producción registrada de cada producto antes
// de la venta. Es una reserva operativa del MPF, no un asiento contable.
function costoVentaMinor(ventaId, fechaVenta) {
  const congelado = db.prepare(`SELECT COALESCE(SUM(vic.cantidad*vic.costo_unidad),0) total
    FROM venta_item_costos vic JOIN venta_items vi ON vi.id=vic.venta_item_id WHERE vi.venta_id=?`).get(ventaId).total;
  if (congelado > 0) return Math.round(congelado * 100);
  const items = db.prepare('SELECT receta_grupo_id,cantidad FROM venta_items WHERE venta_id=?').all(ventaId);
  return Math.round(items.reduce((total, item) => {
    const produccion = db.prepare(`SELECT p.costo_unidad FROM producciones p JOIN recetas r ON r.id=p.receta_id
      WHERE r.grupo_id=? AND p.anulado=0 AND p.fecha<=? ORDER BY p.fecha DESC,p.id DESC LIMIT 1`).get(item.receta_grupo_id, fechaVenta);
    return total + (produccion ? Number(produccion.costo_unidad) * Number(item.cantidad) : 0);
  }, 0) * 100);
}

function costoProporcionalCobro({ ventaId, fechaVenta, importeCobroMinor, importeVentaMinor }) {
  const costoTotal = costoVentaMinor(ventaId, fechaVenta);
  if (!costoTotal || !importeVentaMinor) return 0;
  const yaReservado = db.prepare(`SELECT COALESCE(SUM(a.costo_recuperado_minor),0) total FROM mpf_aplicaciones a
    JOIN fin_cobros c ON c.evento_financiero_id=a.evento_financiero_id WHERE c.documento_cxc_id=(SELECT id FROM fin_documentos_cxc WHERE venta_id=?)`).get(ventaId).total;
  return Math.max(0, Math.min(costoTotal - yaReservado, Math.round((costoTotal * importeCobroMinor) / importeVentaMinor)));
}

const registrarCobrosVenta = db.transaction(({ ventaId, pagos, turnoCajaId, usuarioId, fecha = fechaHoy(), claveIdempotencia = null }) => {
  const previo = buscarPagoIdempotente({ usuarioId, clave: claveIdempotencia, ventaId, pagos, turnoCajaId });
  if (previo) return previo;
  const venta = db.prepare("SELECT v.*, d.id documento_cxc_id, d.entidad_id, d.estado estado_cxc FROM ventas v JOIN fin_documentos_cxc d ON d.venta_id=v.id WHERE v.id=? AND v.anulado=0").get(ventaId);
  if (!venta) throw fallo("Venta con CxC no encontrada", 404);
  catalogos.exigirAcceso(venta.entidad_id, usuarioId, ["finanzas_admin", "finanzas_operador", "finanzas_personal_propietario"]);
  if (!Array.isArray(pagos) || pagos.length === 0) throw fallo("Agrega al menos un pago");

  const hashPayload = claveIdempotencia ? hashCanonico({ venta_id: Number(ventaId), pagos, turno_caja_id: turnoCajaId || null }) : null;

  const importes = pagos.map((pago) => aMinorPEN(pago.monto));
  if (importes.some((importe) => importe <= 0)) throw fallo("Los pagos deben ser mayores a cero");
  const saldoInicial = saldoDocumento(venta.documento_cxc_id);
  const totalAplicar = importes.reduce((total, importe) => total + importe, 0);
  if (!Number.isSafeInteger(totalAplicar)) throw fallo("El total de pagos excede el rango financiero permitido");
  if (totalAplicar > saldoInicial.saldoMinor) throw fallo("El total aplicado supera el saldo pendiente de la CxC", 409);
  if (venta.estado_cxc === "anulada") throw fallo("La CxC está anulada", 409);

  const cuentaCxc = db.prepare("SELECT id FROM fin_plan_cuentas WHERE entidad_id=? AND codigo='1201' AND estado='activa'").get(venta.entidad_id);
  if (!cuentaCxc) throw fallo("La entidad no tiene la cuenta 1201 activa", 409);
  const resultados = [];
  pagos.forEach((pago, indice) => {
    const importeMinor = importes[indice];
    const destino = cuentaReceptora({ entidadId: venta.entidad_id, metodoPago: pago.metodoPago, cuentaFinancieraId: pago.cuenta_financiera_id, turnoCajaId });
    const bolsilloId = bolsilloSinAsignar(venta.entidad_id, pago.bolsillo_id);
    const metodoOperativo = pago.metodoPago === "Plin" ? "Yape" : pago.metodoPago;
    const pagoId = Number(db.prepare("INSERT INTO pagos(venta_id,monto,metodo_pago,fecha,usuario_id) VALUES(?,?,?,?,?)")
      .run(venta.id, importeMinor / 100, metodoOperativo, fecha, usuarioId).lastInsertRowid);
    const evento = motor.ejecutar({
      entidadId: venta.entidad_id, tipo: "cobro_venta", fecha,
      descripcion: `Cobro aplicado a venta ${venta.id}, pago ${pagoId}, método ${pago.metodoPago}`,
      usuarioId, clave: `cxc-cobro-pago-${pagoId}`,
      payload: { ventaId: venta.id, documentoCxcId: venta.documento_cxc_id, pagoId, metodoPago: pago.metodoPago, cuentaFinancieraId: destino.cuenta.id, bolsilloId, importeMinor },
      lineas: [
        { cuenta_contable_id: destino.cuenta.cuenta_contable_id, cuenta_financiera_id: destino.cuenta.id, debe_minor: importeMinor, haber_minor: 0 },
        { cuenta_contable_id: cuentaCxc.id, debe_minor: 0, haber_minor: importeMinor },
      ],
      asigs: [{ cuenta_destino_id: destino.cuenta.id, bolsillo_destino_id: bolsilloId, importe_minor: importeMinor }],
    });
    // El MPF sólo reclasifica el cobro ya ingresado: no toca el asiento ni la cuenta receptora.
    const politica = politicas.aplicarACobro({
      entidadId: venta.entidad_id,
      eventoFinancieroId: evento.id,
      cuentaFinancieraId: destino.cuenta.id,
      bolsilloOrigenId: bolsilloId,
      importeIngresoMinor: importeMinor,
      costoMinor: costoProporcionalCobro({ ventaId: venta.id, fechaVenta: venta.fecha, importeCobroMinor: importeMinor, importeVentaMinor: venta.total ? aMinorPEN(venta.total) : venta.importe_original_minor }),
      contexto: { canal: pago.metodoPago, fecha, dia_semana: new Date(`${fecha}T12:00:00Z`).getUTCDay(), periodo: fecha.slice(0, 7), producto_ids: db.prepare('SELECT receta_grupo_id id FROM venta_items WHERE venta_id=?').all(venta.id).map((x) => x.id), categoria_ids: [] },
    });
    const cobroId = Number(db.prepare(`INSERT INTO fin_cobros
      (entidad_id,pago_id,documento_cxc_id,evento_financiero_id,cuenta_financiera_id,bolsillo_id,turno_caja_id,metodo_pago,importe_minor,fecha,creado_por)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(venta.entidad_id, pagoId, venta.documento_cxc_id, evento.id, destino.cuenta.id, bolsilloId, destino.turnoId, pago.metodoPago, importeMinor, fecha, usuarioId).lastInsertRowid);
    const aplicacionId = Number(db.prepare(`INSERT INTO fin_aplicaciones_cxc
      (documento_cxc_id,cobro_id,evento_financiero_id,importe_minor,fecha_aplicacion,creado_por)
      VALUES(?,?,?,?,?,?)`).run(venta.documento_cxc_id, cobroId, evento.id, importeMinor, fecha, usuarioId).lastInsertRowid);
    db.prepare("UPDATE pagos SET evento_financiero_id=?,cobro_id=?,aplicacion_cxc_id=? WHERE id=?").run(evento.id, cobroId, aplicacionId, pagoId);
    db.prepare("INSERT INTO fin_auditoria(entidad_id,usuario_id,accion,entidad_tabla,entidad_registro_id,datos_despues) VALUES(?,?,'crear','fin_cobros',?,?)")
      .run(venta.entidad_id, usuarioId, cobroId, JSON.stringify({ pago_id: pagoId, aplicacion_cxc_id: aplicacionId, evento_financiero_id: evento.id }));
    resultados.push({ pago_id: pagoId, cobro_id: cobroId, aplicacion_cxc_id: aplicacionId, evento_financiero_id: evento.id, politica_financiera: politica });
  });

  const saldoFinal = saldoDocumento(venta.documento_cxc_id).saldoMinor;
  const estado = estadoPorSaldo(saldoInicial.documento.importe_original_minor, saldoFinal);
  db.prepare("UPDATE fin_documentos_cxc SET estado=? WHERE id=?").run(estado, venta.documento_cxc_id);
  const respuesta = { saldo: saldoFinal / 100, saldo_minor: saldoFinal, estado_cxc: estado, cobros: resultados };
  if (claveIdempotencia) db.prepare("INSERT INTO pagos_claves_idempotencia(venta_id,usuario_id,clave,hash_payload,respuesta_json) VALUES(?,?,?,?,?)")
    .run(venta.id, usuarioId, claveIdempotencia, hashPayload, JSON.stringify(respuesta));
  return respuesta;
});

const anularVentaSinCobros = db.transaction(({ ventaId, usuarioId }) => {
  const venta = db.prepare("SELECT v.*,d.id documento_cxc_id,d.entidad_id,d.evento_emision_id,d.estado estado_cxc FROM ventas v JOIN fin_documentos_cxc d ON d.venta_id=v.id WHERE v.id=?").get(ventaId);
  if (!venta) return null;
  if (venta.anulado || venta.estado_cxc === "anulada") throw fallo("Esta venta ya estaba anulada", 409);
  catalogos.exigirAcceso(venta.entidad_id, usuarioId, ["finanzas_admin", "finanzas_personal_propietario"]);
  const cobros = db.prepare(`SELECT c.id,c.evento_financiero_id,c.importe_minor FROM fin_cobros c
    WHERE c.documento_cxc_id=? ORDER BY c.id DESC`).all(venta.documento_cxc_id);
  const reversionesCobro = cobros.map((cobro) => motor.revertir({
    entidadId: venta.entidad_id, eventoId: cobro.evento_financiero_id, usuarioId,
    clave: `anular-cobro-venta-${venta.id}-${cobro.id}`, permitirVinculado: true,
  }));
  const reversion = motor.revertir({ entidadId: venta.entidad_id, eventoId: venta.evento_emision_id, usuarioId, clave: `anular-emision-venta-${venta.id}`, permitirVinculado: true });
  db.prepare("UPDATE ventas SET anulado=1 WHERE id=?").run(venta.id);
  db.prepare("UPDATE fin_documentos_cxc SET estado='anulada' WHERE id=?").run(venta.documento_cxc_id);
  db.prepare("INSERT INTO log_auditoria(usuario_id,entidad,entidad_id,accion,datos_antes,datos_despues) VALUES(?,'venta',?,'anular',?,?)")
    .run(usuarioId, venta.id, JSON.stringify(venta), JSON.stringify({ reversion_evento_id: reversion.id }));
  return { ok: true, reversion_evento_id: reversion.id, reversiones_cobro: reversionesCobro.map((r) => r.id) };
});

module.exports = { registrarCobrosVenta, buscarPagoIdempotente, saldoDocumento, anularVentaSinCobros };
