// src/routes/clientes.js
const express = require("express");
const { db } = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);

router.get("/", (req, res) => {
  const { q } = req.query;
  const clientes = q
    ? db.prepare("SELECT * FROM clientes WHERE activo = 1 AND nombre LIKE ? ORDER BY nombre").all(`%${q}%`)
    : db.prepare("SELECT * FROM clientes WHERE activo = 1 ORDER BY nombre").all();
  res.json(clientes);
});

router.post("/", requireRole("admin", "operador", "vendedor"), (req, res) => {
  const { nombre, tipo } = req.body;
  if (!nombre?.trim()) return res.status(400).json({ error: "El nombre es obligatorio" });

  const info = db.prepare(`
    INSERT INTO clientes (nombre, tipo, usuario_id) VALUES (?, ?, ?)
  `).run(nombre.trim(), tipo === "mayorista" ? "mayorista" : "minorista", req.usuario.id);

  res.status(201).json({ id: info.lastInsertRowid });
});

router.delete("/:id", requireRole("admin"), (req, res) => {
  const cliente = db.prepare("SELECT * FROM clientes WHERE id = ?").get(req.params.id);
  if (!cliente) return res.status(404).json({ error: "No existe" });
  db.prepare("UPDATE clientes SET activo = 0 WHERE id = ?").run(cliente.id); // soft delete
  res.json({ ok: true });
});

module.exports = router;
