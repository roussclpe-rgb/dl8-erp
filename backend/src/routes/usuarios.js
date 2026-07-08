const express = require("express");
const { db } = require("../db");
const { hashPassword } = require("../auth");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);

router.get("/", requireRole("admin"), (req, res) => {
  const usuarios = db.prepare(`
    SELECT u.id, u.nombre, u.email, u.activo, u.creado_en, r.nombre AS rol
    FROM usuarios u JOIN roles r ON r.id = u.rol_id ORDER BY u.id
  `).all();
  res.json(usuarios);
});

router.post("/", requireRole("admin"), (req, res) => {
  const { nombre, email, password, rol } = req.body;
  if (!nombre || !email || !password || !rol) return res.status(400).json({ error: "Faltan campos" });
  if (password.length < 8) return res.status(400).json({ error: "La contraseña debe tener al menos 8 caracteres" });
  const rolRow = db.prepare("SELECT id FROM roles WHERE nombre = ?").get(rol);
  if (!rolRow) return res.status(400).json({ error: "Rol inválido. Usa: admin, operador o lectura" });

  try {
    const info = db.prepare("INSERT INTO usuarios (nombre, email, password_hash, rol_id) VALUES (?, ?, ?, ?)")
      .run(nombre, email, hashPassword(password), rolRow.id);
    res.status(201).json({ id: info.lastInsertRowid });
  } catch (e) {
    if (String(e).includes("UNIQUE")) return res.status(409).json({ error: "Ese email ya está registrado" });
    throw e;
  }
});

router.patch("/:id/estado", requireRole("admin"), (req, res) => {
  const { activo } = req.body;
  db.prepare("UPDATE usuarios SET activo = ? WHERE id = ?").run(activo ? 1 : 0, req.params.id);
  res.json({ ok: true });
});

module.exports = router;
