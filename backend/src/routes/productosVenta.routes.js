// src/routes/productosVenta.js
const express = require("express");
const { db } = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");
const { stockDisponible } = require("../services/ventas");

const router = express.Router();
router.use(requireAuth);

// Recetas vigentes que ya tienen precio de venta asignado, con su stock.
router.get("/", (req, res) => {
  const filas = db.prepare(`
    SELECT pv.*, r.nombre_producto
    FROM productos_venta pv
    JOIN recetas r ON r.grupo_id = pv.receta_grupo_id AND r.vigente = 1
    WHERE pv.activo = 1
    ORDER BY r.nombre_producto
  `).all();

  res.json(filas.map((f) => ({ ...f, stockDisponible: stockDisponible(f.receta_grupo_id) })));
});

// Recetas vigentes que TODAVÍA no tienen precio asignado (para el selector
// "agregar producto al catálogo de ventas").
router.get("/sin-precio", (req, res) => {
  const filas = db.prepare(`
    SELECT r.grupo_id AS receta_grupo_id, r.nombre_producto
    FROM recetas r
    WHERE r.vigente = 1 AND r.activo = 1
      AND r.grupo_id NOT IN (SELECT receta_grupo_id FROM productos_venta)
    ORDER BY r.nombre_producto
  `).all();
  res.json(filas);
});

router.post("/", requireRole("admin", "operador"), (req, res) => {
  const { receta_grupo_id, precio_normal, precio_mayorista } = req.body;

  const receta = db.prepare("SELECT * FROM recetas WHERE grupo_id = ? AND vigente = 1").get(receta_grupo_id);
  if (!receta) return res.status(400).json({ error: "La receta no existe o no está vigente" });

  if (precio_normal == null || precio_mayorista == null) {
    return res.status(400).json({ error: "precio_normal y precio_mayorista son obligatorios" });
  }

  const info = db.prepare(`
    INSERT INTO productos_venta (receta_grupo_id, precio_normal, precio_mayorista, usuario_id)
    VALUES (?, ?, ?, ?)
  `).run(receta_grupo_id, precio_normal, precio_mayorista, req.usuario.id);

  res.status(201).json({ id: info.lastInsertRowid });
});

router.put("/:grupoId", requireRole("admin", "operador"), (req, res) => {
  const { precio_normal, precio_mayorista } = req.body;
  const existe = db.prepare("SELECT * FROM productos_venta WHERE receta_grupo_id = ?").get(req.params.grupoId);
  if (!existe) return res.status(404).json({ error: "No existe precio para este producto" });

  db.prepare(`
    UPDATE productos_venta SET precio_normal = ?, precio_mayorista = ? WHERE receta_grupo_id = ?
  `).run(precio_normal ?? existe.precio_normal, precio_mayorista ?? existe.precio_mayorista, req.params.grupoId);

  res.json({ ok: true });
});

module.exports = router;
