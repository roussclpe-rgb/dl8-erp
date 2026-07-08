const express = require("express");
const { db } = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);

router.get("/", (req, res) => {
  res.json({
    costosIndirectos: db.prepare("SELECT * FROM config_costos WHERE activo = 1").all(),
    manoObra: db.prepare("SELECT * FROM config_mano_obra WHERE activo = 1 ORDER BY id DESC LIMIT 1").get() || null,
  });
});

router.post("/indirectos", requireRole("admin"), (req, res) => {
  const { nombre, tipo, valor, unidades_estimadas_mes } = req.body;
  if (!["por_tanda", "por_unidad", "mensual_prorrateado"].includes(tipo)) {
    return res.status(400).json({ error: "Tipo inválido" });
  }
  if (!(valor >= 0)) {
    return res.status(400).json({ error: "valor debe ser mayor o igual a 0" });
  }
  if (tipo === "mensual_prorrateado" && !(unidades_estimadas_mes > 0)) {
    return res.status(400).json({ error: "Los costos mensuales necesitan unidades_estimadas_mes > 0 para prorratearse" });
  }
  const info = db.prepare("INSERT INTO config_costos (nombre, tipo, valor, unidades_estimadas_mes) VALUES (?, ?, ?, ?)")
    .run(nombre, tipo, valor, unidades_estimadas_mes || null);
  res.status(201).json({ id: info.lastInsertRowid });
});

router.delete("/indirectos/:id", requireRole("admin"), (req, res) => {
  db.prepare("UPDATE config_costos SET activo = 0 WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

router.post("/mano-obra", requireRole("admin"), (req, res) => {
  const { costo_por_hora, nombre } = req.body;
  if (!(costo_por_hora > 0)) return res.status(400).json({ error: "costo_por_hora debe ser mayor a 0" });
  const registrarManoObra = db.transaction(() => {
    db.prepare("UPDATE config_mano_obra SET activo = 0").run(); // solo una config vigente a la vez
    return db.prepare("INSERT INTO config_mano_obra (nombre, costo_por_hora) VALUES (?, ?)")
      .run(nombre || "Costo por hora estándar", costo_por_hora);
  });
  const info = registrarManoObra();
  res.status(201).json({ id: info.lastInsertRowid });
});

module.exports = router;
