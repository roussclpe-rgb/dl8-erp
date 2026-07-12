const express = require("express");
const { db, obtenerOCrearPeriodo } = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");
const { exigirPeriodoAbierto } = require("../services/periodos");
const { consumir, agregarPorConteo } = require("../services/fifo");

const router = express.Router();
router.use(requireAuth);

router.get("/", (req, res) => {
  const movs = db.prepare(`
    SELECT m.*, i.nombre AS ingrediente_nombre, u.nombre AS usuario_nombre
    FROM movimientos_inventario m
    JOIN ingredientes i ON i.id = m.ingrediente_id
    JOIN usuarios u ON u.id = m.usuario_id
    WHERE m.tipo IN ('merma', 'uso_externo', 'conteo_sobra')
    ORDER BY m.fecha DESC, m.id DESC
  `).all();
  res.json(movs);
});

router.post("/", requireRole("admin", "operador"), (req, res) => {
  const { ingrediente_id, tipo, cantidad, motivo, fecha } = req.body;
  if (!["merma", "uso_externo", "sobra"].includes(tipo)) {
    return res.status(400).json({ error: "Tipo inválido. Usa: merma, uso_externo o sobra" });
  }
  if (!(Number(cantidad) > 0) || !motivo?.trim()) {
  return res.status(400).json({
    error: "Cantidad y motivo son obligatorios"
  });
}
  const ing = db.prepare("SELECT * FROM ingredientes WHERE id = ?").get(ingrediente_id);
  if (!ing) return res.status(400).json({ error: "Ingrediente no existe" });

  let periodo;
  try {
    periodo = obtenerOCrearPeriodo(fecha);
    exigirPeriodoAbierto(fecha);
  } catch (e) {
    return res.status(e.status || 400).json({ error: e.message });
  }

  if (tipo === "sobra") {
    const loteId = agregarPorConteo({ ingredienteId: ingrediente_id, cantidadBase: cantidad, motivo, usuarioId: req.usuario.id, fecha, periodoId: periodo.id });
    return res.status(201).json({ ok: true, loteId });
  }

  const tipoMov = tipo === "merma" ? "merma" : "uso_externo";
  const { costoTotal, faltante, consumos } = consumir({
    ingredienteId: ingrediente_id, cantidadBase: cantidad, tipo: tipoMov, motivo,
    referenciaTipo: "ajuste", referenciaId: null, usuarioId: req.usuario.id, fecha, periodoId: periodo.id,
  });
  if (faltante > 0.0001) {
    return res.status(409).json({ error: `No hay suficiente stock de "${ing.nombre}" para registrar este ajuste (faltan ${faltante.toFixed(2)} ${ing.unidad_base}).` });
  }
  res.status(201).json({ ok: true, costoTotal, consumos });
});

module.exports = router;
