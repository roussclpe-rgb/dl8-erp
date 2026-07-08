const express = require("express");
const { db, obtenerOCrearPeriodo } = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");
const { exigirPeriodoAbierto } = require("../services/periodos");
const { factorConversion, unidadesCompatibles } = require("../services/unidades");

const router = express.Router();
router.use(requireAuth);

router.get("/", (req, res) => {
  const lotes = db.prepare(`
    SELECT l.*, i.nombre AS ingrediente_nombre, i.unidad_base, p.nombre AS proveedor_nombre
    FROM lotes_compra l
    JOIN ingredientes i ON i.id = l.ingrediente_id
    LEFT JOIN proveedores p ON p.id = l.proveedor_id
    WHERE l.anulado = 0
    ORDER BY l.fecha_compra DESC, l.id DESC
  `).all();
  res.json(lotes);
});

router.get("/unidades-compatibles/:ingredienteId", (req, res) => {
  const ing = db.prepare("SELECT * FROM ingredientes WHERE id = ?").get(req.params.ingredienteId);
  if (!ing) return res.status(404).json({ error: "Ingrediente no existe" });
  res.json(unidadesCompatibles(ing.unidad_base));
});

// Valida que los campos numéricos obligatorios sean estrictamente positivos.
// `!cantidad` por sí solo acepta negativos (!(-5) === false), así que se
// compara numéricamente en vez de solo chequear "truthy".
function validarNumerosPositivos({ cantidad_comprada, contenido_por_presentacion, costo_total }) {
  if (!(cantidad_comprada > 0) || !(contenido_por_presentacion > 0) || !(costo_total > 0)) {
    const err = new Error("cantidad_comprada, contenido_por_presentacion y costo_total deben ser mayores a 0");
    err.status = 400;
    throw err;
  }
}

function calcularTotales(ing, body) {
  const { cantidad_comprada, unidad_compra, contenido_por_presentacion, costo_total } = body;
  const factor = factorConversion(ing.unidad_base, unidad_compra);
  const cantidad_total_base = cantidad_comprada * contenido_por_presentacion * factor;
  const costo_unidad_base = costo_total / cantidad_total_base;
  return { cantidad_total_base, costo_unidad_base };
}

router.post("/", requireRole("admin", "operador"), (req, res) => {
  const { ingrediente_id, proveedor_id, fecha_compra, fecha_vencimiento, presentacion,
          cantidad_comprada, unidad_compra, contenido_por_presentacion, costo_total } = req.body;

  const ing = db.prepare("SELECT * FROM ingredientes WHERE id = ?").get(ingrediente_id);
  if (!ing) return res.status(400).json({ error: "Ingrediente no existe" });
  if (!unidad_compra) return res.status(400).json({ error: "Falta unidad_compra" });

  try {
    validarNumerosPositivos(req.body);
  } catch (e) {
    return res.status(e.status || 400).json({ error: e.message });
  }

  let totales;
  try {
    totales = calcularTotales(ing, req.body);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  let periodo;
  try {
    periodo = exigirPeriodoAbierto(fecha_compra);
  } catch (e) {
    return res.status(e.status || 400).json({ error: e.message });
  }

  // El lote y su movimiento de inventario deben crearse juntos o no crearse:
  // envolver en una transacción evita un lote sin su rastro de auditoría.
  const registrarCompra = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO lotes_compra
        (ingrediente_id, proveedor_id, periodo_id, fecha_compra, fecha_vencimiento, presentacion,
         cantidad_comprada, unidad_compra, contenido_por_presentacion, cantidad_total_base, cantidad_restante,
         costo_total, costo_unidad_base, usuario_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      ingrediente_id, proveedor_id || null, periodo.id, fecha_compra, fecha_vencimiento || null, presentacion || null,
      cantidad_comprada, unidad_compra, contenido_por_presentacion, totales.cantidad_total_base, totales.cantidad_total_base,
      costo_total, totales.costo_unidad_base, req.usuario.id
    );

    db.prepare(`
      INSERT INTO movimientos_inventario
        (ingrediente_id, tipo, cantidad_base, costo_unidad_base, referencia_tipo, referencia_id, motivo, usuario_id, fecha, periodo_id)
      VALUES (?, 'compra', ?, ?, 'lote_compra', ?, 'Compra registrada', ?, ?, ?)
    `).run(ingrediente_id, totales.cantidad_total_base, totales.costo_unidad_base, info.lastInsertRowid, req.usuario.id, fecha_compra, periodo.id);

    return info;
  });

  const info = registrarCompra();
  res.status(201).json({ id: info.lastInsertRowid, ...totales });
});

// Editar una compra: solo si el periodo de su fecha (la vieja Y la nueva) está abierto.
// Si el lote ya fue parcialmente consumido, no se permite reducir por debajo de lo consumido.
router.put("/:id", requireRole("admin", "operador"), (req, res) => {
  const lote = db.prepare("SELECT * FROM lotes_compra WHERE id = ?").get(req.params.id);
  if (!lote) return res.status(404).json({ error: "No existe" });

  try {
    exigirPeriodoAbierto(lote.fecha_compra);
    exigirPeriodoAbierto(req.body.fecha_compra || lote.fecha_compra);
  } catch (e) {
    return res.status(e.status || 400).json({ error: e.message });
  }

  const ing = db.prepare("SELECT * FROM ingredientes WHERE id = ?").get(lote.ingrediente_id);
  const consumido = lote.cantidad_total_base - lote.cantidad_restante;
  const body = { ...lote, ...req.body };

  try {
    validarNumerosPositivos(body);
  } catch (e) {
    return res.status(e.status || 400).json({ error: e.message });
  }

  let totales;
  try {
    totales = calcularTotales(ing, body);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  if (totales.cantidad_total_base < consumido - 0.0001) {
    return res.status(409).json({
      error: `Ya se consumieron ${consumido.toFixed(2)} ${ing.unidad_base} de este lote. No puedes editarlo para que quede por debajo de eso.`
    });
  }

  const periodoNuevo = obtenerOCrearPeriodo(body.fecha_compra);

  const editarCompra = db.transaction(() => {
    db.prepare(`
      UPDATE lotes_compra SET
        proveedor_id=?, periodo_id=?, fecha_compra=?, fecha_vencimiento=?, presentacion=?,
        cantidad_comprada=?, unidad_compra=?, contenido_por_presentacion=?, cantidad_total_base=?,
        cantidad_restante=?, costo_total=?, costo_unidad_base=?
      WHERE id=?
    `).run(
      body.proveedor_id ?? lote.proveedor_id, periodoNuevo.id, body.fecha_compra, body.fecha_vencimiento ?? lote.fecha_vencimiento,
      body.presentacion ?? lote.presentacion, body.cantidad_comprada, body.unidad_compra, body.contenido_por_presentacion,
      totales.cantidad_total_base, totales.cantidad_total_base - consumido, body.costo_total, totales.costo_unidad_base, req.params.id
    );

    db.prepare(`INSERT INTO log_auditoria (usuario_id, entidad, entidad_id, accion, datos_antes, datos_despues) VALUES (?, 'lote_compra', ?, 'editar', ?, ?)`)
      .run(req.usuario.id, req.params.id, JSON.stringify(lote), JSON.stringify(body));
  });
  editarCompra();

  res.json({ ok: true, ...totales });
});

module.exports = router;
