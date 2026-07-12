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

  const evento = motor.ejecutar({
    entidadId, tipo: "emision_venta", fecha, descripcion: `Emisión venta folio ${folio}`, usuarioId,
    clave: `venta-emision-${ventaId}`,
    payload: { ventaId, entidadId, importeMinor, moneda: "PEN" },
    lineas: [
      { cuenta_contable_id: cuentaPlan(entidadId, "1201"), debe_minor: importeMinor, haber_minor: 0 },
      { cuenta_contable_id: cuentaPlan(entidadId, "4101"), debe_minor: 0, haber_minor: importeMinor },
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

module.exports = { emitirVenta, buscarVentaIdempotente, aMinorPEN };
