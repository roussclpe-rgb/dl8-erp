const express = require("express");
const { db } = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");
const { exigirPeriodoAbierto } = require("../services/periodos");

const router = express.Router();
router.use(requireAuth);

// Stock de producto terminado = producido - mermado, agrupado por receta (grupo_id, no versión)
router.get("/stock-producto/:grupoRecetaId", (req, res) => {
  const grupoId = req.params.grupoRecetaId;
  const producido = db.prepare(`
    SELECT COALESCE(SUM(p.unidades_producidas), 0) AS total
    FROM producciones p JOIN recetas r ON r.id = p.receta_id
    WHERE r.grupo_id = ? AND p.anulado = 0
  `).get(grupoId).total;
  const mermado = db.prepare("SELECT COALESCE(SUM(cantidad), 0) AS total FROM mermas_producto WHERE grupo_receta_id = ?").get(grupoId).total;
  res.json({ producido, mermado, stock: producido - mermado });
});

router.get("/", (req, res) => {
  res.json(db.prepare(`
    SELECT m.*, u.nombre AS usuario_nombre
    FROM mermas_producto m JOIN usuarios u ON u.id = m.usuario_id
    ORDER BY m.fecha DESC, m.id DESC
  `).all());
});

router.post("/", requireRole("admin", "operador"), (req, res) => {
  const { grupo_receta_id, produccion_id, cantidad, motivo, fecha } = req.body;
  if (!cantidad || cantidad <= 0 || !motivo?.trim()) return res.status(400).json({ error: "Cantidad y motivo son obligatorios" });

  let periodo;
  try {
    periodo = exigirPeriodoAbierto(fecha);
  } catch (e) {
    return res.status(e.status || 400).json({ error: e.message });
  }

  const producido = db.prepare(`
    SELECT COALESCE(SUM(p.unidades_producidas), 0) AS total FROM producciones p JOIN recetas r ON r.id = p.receta_id
    WHERE r.grupo_id = ? AND p.anulado = 0
  `).get(grupo_receta_id).total;
  const mermado = db.prepare("SELECT COALESCE(SUM(cantidad), 0) AS total FROM mermas_producto WHERE grupo_receta_id = ?").get(grupo_receta_id).total;
  if (cantidad > producido - mermado) {
    return res.status(409).json({ error: "No puedes mermar más de lo que tienes en stock de producto terminado." });
  }

  const info = db.prepare(`
    INSERT INTO mermas_producto (produccion_id, grupo_receta_id, cantidad, motivo, fecha, periodo_id, usuario_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(produccion_id || null, grupo_receta_id, cantidad, motivo, fecha, periodo.id, req.usuario.id);

  res.status(201).json({ id: info.lastInsertRowid });
});

module.exports = router;
