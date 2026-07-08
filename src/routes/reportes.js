const express = require("express");
const { db } = require("../db");
const { requireAuth } = require("../middleware/auth");
const { sugerenciasCompra } = require("../services/sugerencias");

const router = express.Router();
router.use(requireAuth);

// Cuánto vale hoy todo lo que tienes en inventario (ingredientes), a costo FIFO real.
router.get("/valorizacion-inventario", (req, res) => {
  const filas = db.prepare(`
    SELECT i.id, i.nombre, i.unidad_base,
           COALESCE(SUM(l.cantidad_restante), 0) AS stock,
           COALESCE(SUM(l.cantidad_restante * l.costo_unidad_base), 0) AS valor
    FROM ingredientes i
    LEFT JOIN lotes_compra l ON l.ingrediente_id = i.id AND l.anulado = 0
    WHERE i.activo = 1
    GROUP BY i.id
    ORDER BY valor DESC
  `).all();
  const total = filas.reduce((s, f) => s + f.valor, 0);
  res.json({ items: filas, valorTotal: total });
});

// Mermas (de ingredientes y de producto terminado) dentro de un rango de fechas
router.get("/mermas", (req, res) => {
  const { desde, hasta } = req.query;
  const mermasIngredientes = db.prepare(`
    SELECT m.fecha, i.nombre AS item, 'ingrediente' AS clase, -m.cantidad_base AS cantidad, m.motivo, m.costo_unidad_base * -m.cantidad_base AS costo_estimado
    FROM movimientos_inventario m JOIN ingredientes i ON i.id = m.ingrediente_id
    WHERE m.tipo = 'merma' AND m.fecha BETWEEN ? AND ?
  `).all(desde || "0000-01-01", hasta || "9999-12-31");
  const mermasProducto = db.prepare(`
    SELECT fecha, 'producto terminado' AS item, 'producto' AS clase, cantidad, motivo, NULL AS costo_estimado
    FROM mermas_producto WHERE fecha BETWEEN ? AND ?
  `).all(desde || "0000-01-01", hasta || "9999-12-31");
  res.json([...mermasIngredientes, ...mermasProducto].sort((a, b) => (a.fecha < b.fecha ? 1 : -1)));
});

// Rotación simple: cuánto se consumió de cada ingrediente en los últimos N días
router.get("/rotacion", (req, res) => {
  const dias = parseInt(req.query.dias) || 30;
  const filas = db.prepare(`
    SELECT i.nombre, i.unidad_base, COALESCE(SUM(-m.cantidad_base), 0) AS consumido
    FROM ingredientes i
    LEFT JOIN movimientos_inventario m ON m.ingrediente_id = i.id
      AND m.cantidad_base < 0 AND m.tipo IN ('consumo_produccion', 'merma', 'uso_externo')
      AND m.fecha >= date('now', ?)
    WHERE i.activo = 1
    GROUP BY i.id
    ORDER BY consumido DESC
  `).all(`-${dias} days`);
  res.json(filas);
});

router.get("/sugerencias-compra", (req, res) => {
  res.json(sugerenciasCompra());
});

module.exports = router;
