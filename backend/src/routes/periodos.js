const express = require("express");
const { requireAuth, requireRole } = require("../middleware/auth");
const { cerrarPeriodo, listarPeriodos } = require("../services/periodos");

const router = express.Router();
router.use(requireAuth);

router.get("/", (req, res) => res.json(listarPeriodos()));

router.post("/cerrar", requireRole("admin"), (req, res) => {
  const { anio, mes } = req.body;
  try {
    const periodo = cerrarPeriodo(anio, mes, req.usuario.id);
    res.json(periodo);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});

module.exports = router;
