const { db } = require("../../db");
const { exigirPeriodoAbierto } = require("../periodos");
const { factorConversion } = require("../unidades");
const catalogos = require("./catalogos");
const motor = require("./motor");
const { aMinorPEN } = require("./montos");
const { hashCanonico } = require("./idempotencia");

const fallo = (message, status = 400) => Object.assign(new Error(message), { status });

function compraIdempotente({ usuarioId, clave, hashPayload }) {
  if (!clave) return null;
  const previo = db.prepare("SELECT hash_payload,respuesta_json FROM compras_claves_idempotencia WHERE usuario_id=? AND clave=?").get(usuarioId, clave);
  if (!previo) return null;
  if (previo.hash_payload !== hashPayload) throw fallo("La clave de idempotencia se usó con otro payload", 409);
  return JSON.parse(previo.respuesta_json);
}

function buscarCompraIdempotente({ usuarioId, clave, payload }) {
  if (!clave) return null;
  return compraIdempotente({ usuarioId, clave, hashPayload: hashCanonico(payload) });
}

function cuentaPlan(entidadId, codigo) {
  const cuenta = db.prepare("SELECT id FROM fin_plan_cuentas WHERE entidad_id=? AND codigo=? AND estado='activa' AND permite_movimiento=1").get(entidadId, codigo);
  if (!cuenta) throw fallo("La entidad no tiene la cuenta contable requerida para compras", 409);
  return cuenta.id;
}

const emitirCompra = db.transaction(({ entidadId, usuarioId, payload, claveIdempotencia }) => {
  catalogos.exigirAcceso(entidadId, usuarioId, ["finanzas_admin", "finanzas_operador", "finanzas_personal_propietario"]);
  const hashPayload = claveIdempotencia ? hashCanonico(payload) : null;
  const previo = compraIdempotente({ usuarioId, clave: claveIdempotencia, hashPayload });
  if (previo) return previo;

  const { ingrediente_id, proveedor_id, fecha_compra, fecha_vencimiento, presentacion, cantidad_comprada, unidad_compra, contenido_por_presentacion, costo_total } = payload;
  if (!ingrediente_id || !proveedor_id || !fecha_compra || !unidad_compra) throw fallo("entidad_id, proveedor_id, ingrediente_id, fecha_compra y unidad_compra son obligatorios");
  if (!(Number(cantidad_comprada) > 0) || !(Number(contenido_por_presentacion) > 0) || !(Number(costo_total) > 0)) {
    throw fallo("cantidad_comprada, contenido_por_presentacion y costo_total deben ser mayores a 0");
  }
  const ingrediente = db.prepare("SELECT * FROM ingredientes WHERE id=? AND activo=1").get(ingrediente_id);
  if (!ingrediente) throw fallo("Ingrediente no existe o está inactivo");
  const proveedor = db.prepare("SELECT * FROM proveedores WHERE id=? AND activo=1").get(proveedor_id);
  if (!proveedor) throw fallo("Proveedor no existe o está inactivo");
  const factor = factorConversion(ingrediente.unidad_base, unidad_compra);
  const cantidadTotalBase = Number(cantidad_comprada) * Number(contenido_por_presentacion) * factor;
  if (!Number.isFinite(cantidadTotalBase) || cantidadTotalBase <= 0) throw fallo("La cantidad total de la compra no es válida");
  const costoTotal = Number(costo_total);
  const importeMinor = aMinorPEN(costoTotal);
  if (importeMinor <= 0) throw fallo("El importe financiero de la compra debe ser mayor a cero");
  const periodo = exigirPeriodoAbierto(fecha_compra);

  const loteId = Number(db.prepare(`INSERT INTO lotes_compra
    (ingrediente_id,proveedor_id,entidad_id,periodo_id,fecha_compra,fecha_vencimiento,presentacion,cantidad_comprada,unidad_compra,contenido_por_presentacion,cantidad_total_base,cantidad_restante,costo_total,costo_unidad_base,usuario_id)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    ingrediente.id, proveedor.id, entidadId, periodo.id, fecha_compra, fecha_vencimiento || null, presentacion || null,
    Number(cantidad_comprada), unidad_compra, Number(contenido_por_presentacion), cantidadTotalBase, cantidadTotalBase,
    costoTotal, costoTotal / cantidadTotalBase, usuarioId
  ).lastInsertRowid);
  db.prepare(`INSERT INTO movimientos_inventario
    (ingrediente_id,tipo,cantidad_base,costo_unidad_base,referencia_tipo,referencia_id,motivo,usuario_id,fecha,periodo_id)
    VALUES(?,'compra',?,?,'lote_compra',?,'Compra registrada',?,?,?)`)
    .run(ingrediente.id, cantidadTotalBase, costoTotal / cantidadTotalBase, loteId, usuarioId, fecha_compra, periodo.id);

  const evento = motor.ejecutar({
    entidadId, tipo: "emision_compra", fecha: fecha_compra, descripcion: `Emisión compra lote ${loteId}`,
    usuarioId, clave: `compra-emision-${loteId}`,
    payload: { loteCompraId: loteId, entidadId, proveedorId: proveedor.id, importeMinor, moneda: "PEN" },
    lineas: [
      { cuenta_contable_id: cuentaPlan(entidadId, "1301"), debe_minor: importeMinor, haber_minor: 0 },
      { cuenta_contable_id: cuentaPlan(entidadId, "2101"), debe_minor: 0, haber_minor: importeMinor },
    ],
  });
  const documentoId = Number(db.prepare(`INSERT INTO fin_documentos_cxp
    (entidad_id,lote_compra_id,proveedor_id,tipo_documento,fecha_emision,fecha_vencimiento,moneda,importe_original_minor,estado,evento_emision_id,creado_por)
    VALUES(?,?,?,'compra',?,?,'PEN',?,'abierta',?,?)`).run(
    entidadId, loteId, proveedor.id, fecha_compra, fecha_vencimiento || null, importeMinor, evento.id, usuarioId
  ).lastInsertRowid);
  db.prepare("INSERT INTO log_auditoria(usuario_id,entidad,entidad_id,accion,datos_antes,datos_despues) VALUES(?,'lote_compra',?,'crear',NULL,?)")
    .run(usuarioId, loteId, JSON.stringify({ documento_cxp_id: documentoId, evento_emision_id: evento.id, entidad_id: entidadId }));
  const respuesta = { id: loteId, cantidad_total_base: cantidadTotalBase, costo_unidad_base: costoTotal / cantidadTotalBase, documento_cxp_id: documentoId, evento_emision_id: evento.id };
  if (claveIdempotencia) db.prepare("INSERT INTO compras_claves_idempotencia(usuario_id,clave,hash_payload,respuesta_json) VALUES(?,?,?,?)")
    .run(usuarioId, claveIdempotencia, hashPayload, JSON.stringify(respuesta));
  return respuesta;
});

module.exports = { emitirCompra, buscarCompraIdempotente };
