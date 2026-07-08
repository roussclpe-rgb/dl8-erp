const express = require("express");
const { db } = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);

router.get("/", (req, res) => {
  res.json(db.prepare("SELECT * FROM proveedores WHERE activo = 1 ORDER BY nombre").all());
});

router.post("/", requireRole("admin", "operador"), (req, res) => {
  const { nombre, contacto, telefono, email, notas } = req.body;
  if (!nombre?.trim()) return res.status(400).json({ error: "El nombre es obligatorio" });
  const info = db.prepare("INSERT INTO proveedores (nombre, contacto, telefono, email, notas) VALUES (?, ?, ?, ?, ?)")
    .run(nombre, contacto || null, telefono || null, email || null, notas || null);
  res.status(201).json({ id: info.lastInsertRowid });
});

router.put("/:id", requireRole("admin", "operador"), (req, res) => {
  const antes = db.prepare("SELECT * FROM proveedores WHERE id = ?").get(req.params.id);
  if (!antes) return res.status(404).json({ error: "No existe" });
  const { nombre, contacto, telefono, email, notas } = req.body;
  db.prepare("UPDATE proveedores SET nombre=?, contacto=?, telefono=?, email=?, notas=? WHERE id=?")
    .run(nombre ?? antes.nombre, contacto ?? antes.contacto, telefono ?? antes.telefono, email ?? antes.email, notas ?? antes.notas, req.params.id);
  db.prepare(`INSERT INTO log_auditoria (usuario_id, entidad, entidad_id, accion, datos_antes, datos_despues) VALUES (?, 'proveedor', ?, 'editar', ?, ?)`)
    .run(req.usuario.id, req.params.id, JSON.stringify(antes), JSON.stringify(req.body));
  res.json({ ok: true });
});

router.delete("/:id", requireRole("admin"), (req, res) => {
  // Baja lógica: nunca se borra un proveedor con historial de compras asociado
  db.prepare("UPDATE proveedores SET activo = 0 WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
