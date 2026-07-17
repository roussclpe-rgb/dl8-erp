const { db } = require("../../db");
const catalogos = require("./catalogos");
const motor = require("./motor");
const { aMinorPEN } = require("./montos");
const { hashCanonico } = require("./idempotencia");

const fallo = (message, status = 400) => Object.assign(new Error(message), { status });

function cuentaPlan(entidadId, codigo) {
  const cuenta = db.prepare("SELECT id FROM fin_plan_cuentas WHERE entidad_id = ? AND codigo = ? AND estado = 'activa' AND permite_movimiento = 1").get(entidadId, codigo);
  if (!cuenta) throw fallo("La entidad no tiene la cuenta financiera requerida para ventas", 409);
  return cuenta.id;
}

function siguienteFolio() {
  return db.prepare("SELECT COALESCE(MAX(folio), 0) + 1 AS folio FROM ventas").get().folio;
}

function ventaIdempotente({ usuarioId, clave, hashPayload }) {
  if (!clave) return null;
  const previo = db.prepare("SELECT hash_payload, respuesta_json FROM ventas_claves_idempotencia WHERE usuario_id = ? AND clave = ?").get(usuarioId, clave);
  if (!previo) return null;
  if (previo.hash_payload !== hashPayload) throw fallo("La clave de idempotencia se usó con otro payload", 409);
  return JSON.parse(previo.respuesta_json);
}

function buscarVentaIdempotente({ usuarioId, clave, payload }) {
  if (!clave) return null;
  return ventaIdempotente({ usuarioId, clave, hashPayload: hashCanonico(payload) });
}

function congelarCostosVenta(ventaId, fecha) {
  const items = db.prepare('SELECT * FROM venta_items WHERE venta_id=?').all(ventaId);
  const insertar = db.prepare('INSERT INTO venta_item_costos(venta_item_id,produccion_id,cantidad,costo_unidad) VALUES(?,?,?,?)');
  for (const item of items) {
    let porAsignar = Number(item.cantidad);
    let saltar = db.prepare(`SELECT COALESCE(SUM(vi.cantidad),0) total FROM venta_items vi JOIN ventas v ON v.id=vi.venta_id
      WHERE vi.receta_grupo_id=? AND v.anulado=0 AND v.id<?`).get(item.receta_grupo_id, ventaId).total;
    const producciones = db.prepare(`SELECT p.* FROM producciones p JOIN recetas r ON r.id=p.receta_id
      WHERE r.grupo_id=? AND p.anulado=0 AND p.fecha<=? ORDER BY p.fecha,p.id`).all(item.receta_grupo_id, fecha);
    for (const produccion of producciones) {
      if (porAsignar <= 0) break;
      if (saltar >= produccion.unidades_producidas) { saltar -= produccion.unidades_producidas; continue; }
      const disponible = produccion.unidades_producidas - saltar; saltar = 0;
      const tomar = Math.min(porAsignar, disponible);
      insertar.run(item.id, produccion.id, tomar, produccion.costo_unidad); porAsignar -= tomar;
    }
  }
}

/**
 * Devuelve el costo contable congelado de la venta en céntimos solamente
 * cuando puede demostrarse que cada unidad vendida proviene de una producción
 * y que todos los ingredientes de esa producción tuvieron costo registrado.
 *
 * Si falta cualquiera de esas condiciones, no se emite costo de venta: evita
 * convertir una estimación parcial en un resultado contable aparentemente
 * exacto.
 */
function costoContableVentaMinor(ventaId) {
  const items = db.prepare("SELECT id, receta_grupo_id, cantidad FROM venta_items WHERE venta_id=?").all(ventaId);
  if (!items.length) return null;

  const costosPorItem = db.prepare(`
    SELECT vic.venta_item_id, vic.produccion_id, vic.cantidad, vic.costo_unidad, p.receta_id
    FROM venta_item_costos vic JOIN producciones p ON p.id=vic.produccion_id
    WHERE vic.venta_item_id=? AND p.anulado=0
  `);
  const ingredientesReceta = db.prepare("SELECT ingrediente_id FROM receta_items WHERE receta_id=?");
  const logProduccion = db.prepare(`
    SELECT datos_despues FROM log_auditoria
    WHERE entidad='produccion' AND entidad_id=? ORDER BY id DESC LIMIT 1
  `);
  const produccionesValidadas = new Map();
  let costo = 0;

  for (const item of items) {
    const asignaciones = costosPorItem.all(item.id);
    const cantidadCosteada = asignaciones.reduce((total, fila) => total + Number(fila.cantidad), 0);
    if (cantidadCosteada + 0.000001 < Number(item.cantidad)) return null;

    for (const asignacion of asignaciones) {
      if (!produccionesValidadas.has(asignacion.produccion_id)) {
        const ingredientes = ingredientesReceta.all(asignacion.receta_id);
        const log = logProduccion.get(asignacion.produccion_id);
        let consumos;
        try { consumos = log ? JSON.parse(log.datos_despues) : null; } catch (_) { consumos = null; }
        const costosCompletos = ingredientes.every(({ ingrediente_id }) => {
          const consumo = consumos?.find((itemConsumo) => Number(itemConsumo.ingredienteId) === Number(ingrediente_id));
          return Array.isArray(consumo?.consumos) && consumo.consumos.length > 0 && consumo.consumos.every((lote) => Number(lote.costoUnidadBase) > 0);
        });
        produccionesValidadas.set(asignacion.produccion_id, costosCompletos);
      }
      if (!produccionesValidadas.get(asignacion.produccion_id) || Number(asignacion.costo_unidad) <= 0) return null;
      costo += Number(asignacion.cantidad) * Number(asignacion.costo_unidad);
    }
  }

  const costoMinor = Math.round(costo * 100);
  return costoMinor > 0 ? costoMinor : null;
}

const emitirVenta = db.transaction(({ entidadId, usuarioId, fecha, cliente, periodoId, items, descuentoTipo, descuentoValor, pagos, turnoCajaId, claveIdempotencia, payloadIdempotencia, registrarPagos, calcularVenta }) => {
  catalogos.exigirAcceso(entidadId, usuarioId, ["finanzas_admin", "finanzas_operador", "finanzas_personal_propietario"]);
  const hashPayload = claveIdempotencia ? hashCanonico(payloadIdempotencia) : null;
  const previo = ventaIdempotente({ usuarioId, clave: claveIdempotencia, hashPayload });
  if (previo) return previo;

  const { itemsCalculados, subtotal, descuentoMonto, total } = calcularVenta({ items, cliente, descuentoTipo, descuentoValor });
  const importeMinor = aMinorPEN(total);
  if (importeMinor <= 0) throw fallo("El total neto de la venta debe ser mayor a cero");
  const folio = siguienteFolio();
  const ventaId = Number(db.prepare(`INSERT INTO ventas (folio, fecha, cliente_id, periodo_id, subtotal, descuento_tipo, descuento_valor, total, usuario_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(folio, fecha, cliente.id, periodoId, subtotal, descuentoMonto > 0 ? descuentoTipo : null, descuentoMonto > 0 ? Number(descuentoValor) : 0, total, usuarioId).lastInsertRowid);
  const insertarItem = db.prepare("INSERT INTO venta_items (venta_id, receta_grupo_id, nombre_producto, cantidad, precio_unitario, subtotal) VALUES (?, ?, ?, ?, ?, ?)");
  itemsCalculados.forEach((item) => insertarItem.run(ventaId, item.receta_grupo_id, item.nombre_producto, item.cantidad, item.precioUnitario, item.subtotal));
  congelarCostosVenta(ventaId, fecha);
  const costoVentaMinor = costoContableVentaMinor(ventaId);

  const evento = motor.ejecutar({
    entidadId, tipo: "emision_venta", fecha, descripcion: `Emisión venta folio ${folio}`, usuarioId,
    clave: `venta-emision-${ventaId}`,
    payload: { ventaId, entidadId, importeMinor, moneda: "PEN" },
    lineas: [
      { cuenta_contable_id: cuentaPlan(entidadId, "1201"), debe_minor: importeMinor, haber_minor: 0 },
      { cuenta_contable_id: cuentaPlan(entidadId, "4101"), debe_minor: 0, haber_minor: importeMinor },
      ...(costoVentaMinor ? [
        { cuenta_contable_id: cuentaPlan(entidadId, "5101"), debe_minor: costoVentaMinor, haber_minor: 0 },
        { cuenta_contable_id: cuentaPlan(entidadId, "1301"), debe_minor: 0, haber_minor: costoVentaMinor },
      ] : []),
    ],
  });
  const documentoId = Number(db.prepare(`INSERT INTO fin_documentos_cxc
    (entidad_id, venta_id, cliente_id, tipo_documento, fecha_emision, moneda, importe_original_minor, estado, evento_emision_id, creado_por)
    VALUES (?, ?, ?, 'venta', ?, 'PEN', ?, 'abierta', ?, ?)`).run(entidadId, ventaId, cliente.id, fecha, importeMinor, evento.id, usuarioId).lastInsertRowid);

  if (registrarPagos) registrarPagos({ ventaId, folio, total, pagos, turnoCajaId });
  db.prepare("INSERT INTO log_auditoria (usuario_id, entidad, entidad_id, accion, datos_antes, datos_despues) VALUES (?, 'venta', ?, 'crear', NULL, ?)")
    .run(usuarioId, ventaId, JSON.stringify({ items: itemsCalculados, pagos, documento_cxc_id: documentoId, evento_emision_id: evento.id }));
  const respuesta = { id: ventaId, folio, total, documento_cxc_id: documentoId, evento_emision_id: evento.id };
  if (claveIdempotencia) db.prepare("INSERT INTO ventas_claves_idempotencia (usuario_id, clave, hash_payload, respuesta_json) VALUES (?, ?, ?, ?)")
    .run(usuarioId, claveIdempotencia, hashPayload, JSON.stringify(respuesta));
  return respuesta;
});

// Una fecha de venta ya emitida no se actualiza directamente: el evento
// financiero confirmado es inmutable. Para corregirla se revierte la emisión
// original y se emite el mismo asiento con la fecha correcta. Los cobros no se
// tocan: representan cuándo ingresó realmente el dinero.
const corregirFechaVenta = db.transaction(({ ventaId, fecha, periodoId, usuarioId, clave }) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha || "")) throw fallo("La fecha debe tener el formato AAAA-MM-DD");

  const venta = db.prepare(`SELECT v.*, d.id documento_id, d.entidad_id, d.fecha_emision, d.evento_emision_id
    FROM ventas v JOIN fin_documentos_cxc d ON d.venta_id = v.id
    WHERE v.id = ? AND v.anulado = 0 AND COALESCE(v.es_saldo_inicial, 0) = 0`).get(ventaId);
  if (!venta) throw fallo("Venta no encontrada", 404);
  catalogos.exigirAcceso(venta.entidad_id, usuarioId, ["finanzas_admin"]);
  if (venta.fecha === fecha) return { venta_id: Number(ventaId), fecha, sin_cambios: true };
  const primerCobro = db.prepare(`SELECT MIN(e.fecha) AS fecha FROM fin_cobros c
    JOIN fin_eventos_financieros e ON e.id = c.evento_financiero_id
    WHERE c.documento_cxc_id = ? AND c.estado = 'confirmado'`).get(venta.documento_id);
  if (primerCobro?.fecha && fecha > primerCobro.fecha) {
    throw fallo(`La fecha de venta no puede ser posterior al primer cobro (${primerCobro.fecha}). Para ese caso, solicita una corrección del cobro.`, 409);
  }

  const eventoAnterior = db.prepare("SELECT * FROM fin_eventos_financieros WHERE id = ? AND entidad_id = ? AND tipo = 'emision_venta'").get(venta.evento_emision_id, venta.entidad_id);
  if (!eventoAnterior) throw fallo("El evento financiero de la venta no es válido", 409);
  const lineas = db.prepare(`SELECT l.cuenta_contable_id, l.cuenta_financiera_id, l.debe_minor, l.haber_minor
    FROM fin_lineas_asiento l JOIN fin_asientos_contables a ON a.id = l.asiento_id WHERE a.evento_id = ?`).all(eventoAnterior.id);
  if (!lineas.length) throw fallo("El asiento financiero de la venta está incompleto", 409);

  const antes = { venta: { id: venta.id, fecha: venta.fecha, periodo_id: venta.periodo_id }, evento_emision_id: eventoAnterior.id };
  motor.revertir({ entidadId: venta.entidad_id, eventoId: eventoAnterior.id, usuarioId, clave: `${clave}:reversion`, permitirVinculado: true });
  const evento = motor.ejecutar({
    entidadId: venta.entidad_id,
    tipo: "emision_venta",
    fecha,
    descripcion: `Corrección de fecha: emisión venta folio ${venta.folio}`,
    usuarioId,
    clave: `${clave}:emision`,
    payload: { ventaId: venta.id, fecha, correccionDe: eventoAnterior.id },
    lineas,
  });
  db.prepare("UPDATE ventas SET fecha = ?, periodo_id = ? WHERE id = ?").run(fecha, periodoId, venta.id);
  db.prepare("UPDATE fin_documentos_cxc SET fecha_emision = ?, evento_emision_id = ? WHERE id = ?").run(fecha, evento.id, venta.documento_id);
  const despues = { venta: { id: venta.id, fecha, periodo_id: periodoId }, evento_emision_id: evento.id, reversion_evento_id: eventoAnterior.id };
  db.prepare("INSERT INTO log_auditoria (usuario_id, entidad, entidad_id, accion, datos_antes, datos_despues) VALUES (?, 'venta', ?, 'corregir_fecha', ?, ?)")
    .run(usuarioId, venta.id, JSON.stringify(antes), JSON.stringify(despues));
  db.prepare("INSERT INTO fin_auditoria(entidad_id, usuario_id, accion, entidad_tabla, entidad_registro_id, datos_antes, datos_despues) VALUES (?, ?, 'actualizar', 'fin_documentos_cxc', ?, ?, ?)")
    .run(venta.entidad_id, usuarioId, venta.documento_id, JSON.stringify(antes), JSON.stringify(despues));
  return { venta_id: venta.id, fecha, evento_financiero_id: evento.id, reversion_evento_id: eventoAnterior.id };
});

module.exports = { emitirVenta, buscarVentaIdempotente, corregirFechaVenta, aMinorPEN };
