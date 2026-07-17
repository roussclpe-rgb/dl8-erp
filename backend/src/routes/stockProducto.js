const express = require("express");
const { db } = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");
const { exigirPeriodoAbierto } = require("../services/periodos");

const router = express.Router();
router.use(requireAuth);

router.post("/existencias", requireRole("admin", "operador"), (req, res) => {
  const { grupo_receta_id, cantidad, costo_unidad = 0, motivo, fecha } = req.body;
  if (!(Number(cantidad) > 0)) return res.status(400).json({ error: "La cantidad debe ser mayor a 0" });
  if (!(Number(costo_unidad) >= 0)) return res.status(400).json({ error: "El costo por unidad no puede ser negativo" });
  if (!db.prepare("SELECT 1 FROM recetas WHERE grupo_id = ? AND vigente = 1 AND activo = 1").get(grupo_receta_id)) {
    return res.status(400).json({ error: "Producto no existe o no está activo" });
  }
  let periodo;
  try { periodo = exigirPeriodoAbierto(fecha); }
  catch (e) { return res.status(e.status || 400).json({ error: e.message }); }
  const info = db.prepare(`INSERT INTO existencias_producto_terminado
    (grupo_receta_id, cantidad, costo_unidad, motivo, fecha, periodo_id, usuario_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(grupo_receta_id, cantidad, costo_unidad, motivo?.trim() || "Stock existente", fecha, periodo.id, req.usuario.id);
  res.status(201).json({ id: info.lastInsertRowid });
});

module.exports = router;
