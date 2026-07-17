const express = require("express");
const { db, obtenerOCrearPeriodo } = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");
const { exigirPeriodoAbierto } = require("../services/periodos");
const { consumir, agregarPorConteo, agregarInventarioInicial } = require("../services/fifo");

const router = express.Router();
router.use(requireAuth);

router.get("/", (req, res) => {
  const movs = db.prepare(`
    SELECT m.*, i.nombre AS ingrediente_nombre, u.nombre AS usuario_nombre
    FROM movimientos_inventario m
    JOIN ingredientes i ON i.id = m.ingrediente_id
    JOIN usuarios u ON u.id = m.usuario_id
    WHERE m.tipo IN ('merma', 'uso_externo', 'conteo_sobra', 'inventario_inicial')
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

router.post("/inventario-inicial", requireRole("admin", "operador"), (req, res) => {
  const { ingrediente_id, cantidad, costo_total, motivo, fecha } = req.body;
  if (!(Number(cantidad) > 0) || !(Number(costo_total) > 0) || !motivo?.trim()) return res.status(400).json({ error: "Cantidad, costo total y motivo son obligatorios" });
  const ingrediente = db.prepare("SELECT id FROM ingredientes WHERE id=? AND activo=1").get(ingrediente_id);
  if (!ingrediente) return res.status(404).json({ error: "Ingrediente no encontrado" });
  try {
    const periodo = obtenerOCrearPeriodo(fecha); exigirPeriodoAbierto(fecha);
    const loteId = agregarInventarioInicial({ ingredienteId: ingrediente_id, cantidadBase: Number(cantidad), costoTotal: Number(costo_total), motivo: motivo.trim(), usuarioId: req.usuario.id, fecha, periodoId: periodo.id });
    res.status(201).json({ ok: true, lote_id: loteId });
  } catch (error) { res.status(error.status || 400).json({ error: error.message }); }
});

module.exports = router;
