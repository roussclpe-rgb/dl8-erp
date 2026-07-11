const express = require("express");
const { db, obtenerOCrearPeriodo } = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");
const { exigirPeriodoAbierto } = require("../services/periodos");
const { factorConversion, unidadesCompatibles } = require("../services/unidades");
const { emitirCompra, buscarCompraIdempotente } = require("../services/finanzas/compras");
const { registrarPagoCxP, buscarPagoCxPIdempotente } = require("../services/finanzas/pagos-cxp");
const { listarDocumentosCxP, detalleDocumentoCxP, listarComprasHistoricas } = require("../services/finanzas/consultas-cxp");
const { anularCompraIdempotente, revertirPago, registrarNotaCredito } = require("../services/finanzas/correcciones-cxp");

const router = express.Router();
router.use(requireAuth);

router.get("/", (req, res) => {
  const lotes = db.prepare(`SELECT l.*,i.nombre ingrediente_nombre,i.unidad_base,p.nombre proveedor_nombre,
    d.id documento_cxp_id,d.estado estado_cxp,0 historico
    FROM lotes_compra l JOIN ingredientes i ON i.id=l.ingrediente_id
    LEFT JOIN proveedores p ON p.id=l.proveedor_id JOIN fin_documentos_cxp d ON d.lote_compra_id=l.id
    WHERE l.anulado=0 ORDER BY l.fecha_compra DESC,l.id DESC`).all();
  res.json(lotes);
});

router.get("/unidades-compatibles/:ingredienteId", (req, res) => {
  const ingrediente = db.prepare("SELECT * FROM ingredientes WHERE id=?").get(req.params.ingredienteId);
  if (!ingrediente) return res.status(404).json({ error: "Ingrediente no existe" });
  res.json(unidadesCompatibles(ingrediente.unidad_base));
});

router.get("/documentos-cxp", (req, res) => {
  try { res.json(listarDocumentosCxP({ entidadId: req.query.entidad_id, usuarioId: req.usuario.id, filtros: req.query })); }
  catch (error) { res.status(error.status || 400).json({ error: error.status ? error.message : "No se pudo listar las CxP" }); }
});
router.get("/documentos-cxp/:id", (req, res) => {
  try { res.json(detalleDocumentoCxP({ documentoId: req.params.id, usuarioId: req.usuario.id })); }
  catch (error) { res.status(error.status || 400).json({ error: error.status ? error.message : "No se pudo obtener la CxP" }); }
});
router.get("/historicas", (req, res) => {
  try { res.json(listarComprasHistoricas({ usuarioId: req.usuario.id, filtros: req.query })); }
  catch (error) { res.status(error.status || 400).json({ error: error.status ? error.message : "No se pudo listar las compras historicas" }); }
});

const validarNumerosPositivos = ({ cantidad_comprada, contenido_por_presentacion, costo_total }) => {
  if (!(cantidad_comprada > 0) || !(contenido_por_presentacion > 0) || !(costo_total > 0)) {
    const error = new Error("cantidad_comprada, contenido_por_presentacion y costo_total deben ser mayores a 0");
    error.status = 400;
    throw error;
  }
};
const calcularTotales = (ingrediente, body) => {
  const factor = factorConversion(ingrediente.unidad_base, body.unidad_compra);
  const cantidad_total_base = body.cantidad_comprada * body.contenido_por_presentacion * factor;
  return { cantidad_total_base, costo_unidad_base: body.costo_total / cantidad_total_base };
};

router.post("/", requireRole("admin", "operador"), (req, res) => {
  const claveIdempotencia = req.get("Idempotency-Key")?.trim();
  try {
    const previo = buscarCompraIdempotente({ usuarioId: req.usuario.id, clave: claveIdempotencia, payload: req.body });
    if (previo) return res.status(201).json(previo);
    res.status(201).json(emitirCompra({ entidadId: Number(req.body.entidad_id), usuarioId: req.usuario.id, payload: req.body, claveIdempotencia }));
  } catch (error) { res.status(error.status || 400).json({ error: error.status ? error.message : "No se pudo confirmar la compra" }); }
});
router.post("/pagos", requireRole("admin", "operador"), (req, res) => {
  const claveIdempotencia = req.get("Idempotency-Key")?.trim();
  try {
    const previo = buscarPagoCxPIdempotente({ usuarioId: req.usuario.id, clave: claveIdempotencia, payload: req.body });
    if (previo) return res.status(201).json(previo);
    const resultado = registrarPagoCxP({ entidadId: Number(req.body.entidad_id), proveedorId: Number(req.body.proveedor_id), cuentaFinancieraId: Number(req.body.cuenta_financiera_id), bolsilloId: Number(req.body.bolsillo_id), metodoPago: req.body.metodo_pago, turnoCajaId: req.body.turno_caja_id || null, fecha: req.body.fecha, monto: req.body.monto, aplicaciones: req.body.aplicaciones, usuarioId: req.usuario.id, claveIdempotencia, payloadIdempotencia: req.body });
    res.status(201).json(resultado);
  } catch (error) { res.status(error.status || 400).json({ error: error.status ? error.message : "No se pudo registrar el pago CxP" }); }
});
router.post("/documentos-cxp/:id/notas-credito", requireRole("admin"), (req, res) => {
  try { res.status(201).json(registrarNotaCredito({ documentoId: +req.params.id, entidadId: Number(req.body.entidad_id), proveedorId: Number(req.body.proveedor_id), cantidadBase: req.body.cantidad_base, importe: req.body.importe, fecha: req.body.fecha, usuarioId: req.usuario.id, clave: req.get("Idempotency-Key") })); }
  catch (error) { res.status(error.status || 400).json({ error: error.status ? error.message : "No se pudo registrar la nota de credito" }); }
});
router.post("/:id/anular", requireRole("admin"), (req, res) => {
  try { res.json(anularCompraIdempotente({ loteId: +req.params.id, usuarioId: req.usuario.id, clave: req.get("Idempotency-Key") })); }
  catch (error) { res.status(error.status || 400).json({ error: error.status ? error.message : "No se pudo anular la compra" }); }
});
router.post("/pagos/:id/reversiones", requireRole("admin"), (req, res) => {
  try { res.json(revertirPago({ pagoId: +req.params.id, usuarioId: req.usuario.id, clave: req.get("Idempotency-Key") })); }
  catch (error) { res.status(error.status || 400).json({ error: error.status ? error.message : "No se pudo revertir el pago" }); }
});

router.put("/:id", requireRole("admin", "operador"), (req, res) => {
  const lote = db.prepare("SELECT * FROM lotes_compra WHERE id=?").get(req.params.id);
  if (!lote) return res.status(404).json({ error: "No existe" });
  if (db.prepare("SELECT 1 FROM fin_documentos_cxp WHERE lote_compra_id=?").get(lote.id)) return res.status(409).json({ error: "La compra tiene una CxP confirmada y no puede editarse directamente" });
  try {
    exigirPeriodoAbierto(lote.fecha_compra);
    exigirPeriodoAbierto(req.body.fecha_compra || lote.fecha_compra);
    const ingrediente = db.prepare("SELECT * FROM ingredientes WHERE id=?").get(lote.ingrediente_id);
    const consumido = lote.cantidad_total_base - lote.cantidad_restante;
    const body = { ...lote, ...req.body };
    validarNumerosPositivos(body);
    const totales = calcularTotales(ingrediente, body);
    if (totales.cantidad_total_base < consumido - 0.0001) return res.status(409).json({ error: `Ya se consumieron ${consumido.toFixed(2)} ${ingrediente.unidad_base} de este lote.` });
    const periodoNuevo = obtenerOCrearPeriodo(body.fecha_compra);
    db.transaction(() => {
      db.prepare(`UPDATE lotes_compra SET proveedor_id=?,periodo_id=?,fecha_compra=?,fecha_vencimiento=?,presentacion=?,cantidad_comprada=?,unidad_compra=?,contenido_por_presentacion=?,cantidad_total_base=?,cantidad_restante=?,costo_total=?,costo_unidad_base=? WHERE id=?`).run(body.proveedor_id ?? lote.proveedor_id, periodoNuevo.id, body.fecha_compra, body.fecha_vencimiento ?? lote.fecha_vencimiento, body.presentacion ?? lote.presentacion, body.cantidad_comprada, body.unidad_compra, body.contenido_por_presentacion, totales.cantidad_total_base, totales.cantidad_total_base - consumido, body.costo_total, totales.costo_unidad_base, lote.id);
      db.prepare("INSERT INTO log_auditoria(usuario_id,entidad,entidad_id,accion,datos_antes,datos_despues) VALUES(?,'lote_compra',?,'editar',?,?)").run(req.usuario.id, lote.id, JSON.stringify(lote), JSON.stringify(body));
    })();
    res.json({ ok: true, ...totales });
  } catch (error) { res.status(error.status || 400).json({ error: error.message }); }
});

module.exports = router;
