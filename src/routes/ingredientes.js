const express = require("express");
const { db } = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");
const { stockIngrediente, costoPromedioActual } = require("../services/fifo");
const { UNIDADES_BASE_PERMITIDAS } = require("../services/unidades");

const router = express.Router();
router.use(requireAuth);

router.get("/", (req, res) => {
  const ingredientes = db.prepare("SELECT * FROM ingredientes WHERE activo = 1 ORDER BY nombre").all();
  const conStock = ingredientes.map((i) => {
    const stock = stockIngrediente(i.id);
    return {
      ...i,
      stock,
      costoPromedio: costoPromedioActual(i.id),
      bajoMinimo: i.stock_minimo > 0 && stock < i.stock_minimo,
    };
  });
  res.json(conStock);
});

router.post("/", requireRole("admin", "operador"), (req, res) => {
  const { nombre, unidad_base, stock_minimo, dias_cobertura_deseados } = req.body;
  if (!nombre?.trim()) return res.status(400).json({ error: "El nombre es obligatorio" });
  if (!UNIDADES_BASE_PERMITIDAS.includes(unidad_base)) {
    return res.status(400).json({ error: `Unidad base inválida. Usa una de: ${UNIDADES_BASE_PERMITIDAS.join(", ")}` });
  }
  const info = db.prepare(`
    INSERT INTO ingredientes (nombre, unidad_base, stock_minimo, dias_cobertura_deseados)
    VALUES (?, ?, ?, ?)
  `).run(nombre, unidad_base, stock_minimo || 0, dias_cobertura_deseados || 7);
  res.status(201).json({ id: info.lastInsertRowid });
});

router.put("/:id", requireRole("admin", "operador"), (req, res) => {
  const antes = db.prepare("SELECT * FROM ingredientes WHERE id = ?").get(req.params.id);
  if (!antes) return res.status(404).json({ error: "No existe" });
  const { nombre, unidad_base, stock_minimo, dias_cobertura_deseados } = req.body;

  // Cambiar la unidad base de un ingrediente con historial de compras ya
  // registrado invalidaría todos los costos pasados: se bloquea.
  if (unidad_base && unidad_base !== antes.unidad_base) {
    const tieneLotes = db.prepare("SELECT COUNT(*) AS n FROM lotes_compra WHERE ingrediente_id = ?").get(req.params.id).n;
    if (tieneLotes > 0) {
      return res.status(409).json({ error: "No se puede cambiar la unidad base: ya tiene compras registradas con la unidad anterior." });
    }
  }

  db.prepare(`
    UPDATE ingredientes SET nombre=?, unidad_base=?, stock_minimo=?, dias_cobertura_deseados=?, actualizado_en=datetime('now')
    WHERE id=?
  `).run(nombre ?? antes.nombre, unidad_base ?? antes.unidad_base, stock_minimo ?? antes.stock_minimo,
         dias_cobertura_deseados ?? antes.dias_cobertura_deseados, req.params.id);

  db.prepare(`INSERT INTO log_auditoria (usuario_id, entidad, entidad_id, accion, datos_antes, datos_despues) VALUES (?, 'ingrediente', ?, 'editar', ?, ?)`)
    .run(req.usuario.id, req.params.id, JSON.stringify(antes), JSON.stringify(req.body));
  res.json({ ok: true });
});

router.delete("/:id", requireRole("admin"), (req, res) => {
  const usadoEnReceta = db.prepare("SELECT COUNT(*) AS n FROM receta_items WHERE ingrediente_id = ?").get(req.params.id).n;
  if (usadoEnReceta > 0) {
    return res.status(409).json({ error: "Este ingrediente está usado en una o más recetas. Edítalas antes de desactivarlo." });
  }
  db.prepare("UPDATE ingredientes SET activo = 0 WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
