const express = require("express");
const { db } = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");
const { costoEstimadoReceta } = require("../services/costeo");

const router = express.Router();
router.use(requireAuth);

function nutricionReceta(items, rendimiento) {
  const total = items.reduce((acum, item) => {
    const factor = Number(item.cantidad_base) / 100;
    acum.calorias += Number(item.calorias_por_100 || 0) * factor;
    acum.proteinas += Number(item.proteinas_por_100 || 0) * factor;
    acum.carbohidratos += Number(item.carbohidratos_por_100 || 0) * factor;
    acum.grasas += Number(item.grasas_por_100 || 0) * factor;
    acum.fibra += Number(item.fibra_por_100 || 0) * factor;
    acum.sodio += Number(item.sodio_por_100 || 0) * factor;
    return acum;
  }, { calorias: 0, proteinas: 0, carbohidratos: 0, grasas: 0, fibra: 0, sodio: 0 });
  const porUnidad = Object.fromEntries(Object.entries(total).map(([clave, valor]) => [clave, valor / Number(rendimiento)]));
  return { total, porUnidad };
}

router.get("/", (req, res) => {
  const recetas = db.prepare("SELECT * FROM recetas WHERE vigente = 1 AND activo = 1 ORDER BY nombre_producto").all();
  const conCosto = recetas.map((r) => {
    const items = db.prepare(`
      SELECT ri.*, i.nombre AS ingrediente_nombre, i.unidad_base, i.calorias_por_100, i.proteinas_por_100, i.carbohidratos_por_100, i.grasas_por_100, i.fibra_por_100, i.sodio_por_100
      FROM receta_items ri JOIN ingredientes i ON i.id = ri.ingrediente_id
      WHERE ri.receta_id = ?
    `).all(r.id);
    const costo = costoEstimadoReceta(r.id);
    return { ...r, items, nutricion: nutricionReceta(items, r.rendimiento), costoMateriaPrima: costo.costoMateriaPrima, costoManoObra: costo.costoManoObra, incompleto: costo.incompleto };
  });
  res.json(conCosto);
});

router.get("/:id/historial", (req, res) => {
  const receta = db.prepare("SELECT * FROM recetas WHERE id = ?").get(req.params.id);
  if (!receta) return res.status(404).json({ error: "No existe" });
  res.json(db.prepare("SELECT * FROM recetas WHERE grupo_id = ? ORDER BY version DESC").all(receta.grupo_id));
});

router.post("/", requireRole("admin", "operador"), (req, res) => {
  const { nombre_producto, rendimiento, minutos_mano_obra, items } = req.body;
  if (!nombre_producto?.trim() || !rendimiento || rendimiento <= 0 || !items?.length) {
    return res.status(400).json({ error: "Nombre, rendimiento e ingredientes son obligatorios" });
  }

  const crearReceta = db.transaction(() => {
    const insReceta = db.prepare(`
      INSERT INTO recetas (grupo_id, version, nombre_producto, rendimiento, minutos_mano_obra, usuario_id)
      VALUES (0, 1, ?, ?, ?, ?)
    `).run(nombre_producto, rendimiento, minutos_mano_obra || 0, req.usuario.id);
    const recetaId = insReceta.lastInsertRowid;
    db.prepare("UPDATE recetas SET grupo_id = ? WHERE id = ?").run(recetaId, recetaId); // grupo_id = su propio id inicial

    const insItem = db.prepare("INSERT INTO receta_items (receta_id, ingrediente_id, cantidad_base) VALUES (?, ?, ?)");
    for (const it of items) insItem.run(recetaId, it.ingrediente_id, it.cantidad_base);

    return recetaId;
  });

  const recetaId = crearReceta();
  res.status(201).json({ id: recetaId });
});

// "Editar" una receta en realidad crea una versión nueva y marca la anterior
// como no vigente. Las producciones pasadas siguen apuntando a la versión
// que realmente se usó, así que su costo histórico nunca cambia.
router.put("/:id", requireRole("admin", "operador"), (req, res) => {
  const anterior = db.prepare("SELECT * FROM recetas WHERE id = ?").get(req.params.id);
  if (!anterior) return res.status(404).json({ error: "No existe" });
  const { nombre_producto, rendimiento, minutos_mano_obra, items } = req.body;
  if (!items?.length) return res.status(400).json({ error: "La receta necesita al menos un ingrediente" });

  const maxVersion = db.prepare("SELECT MAX(version) AS v FROM recetas WHERE grupo_id = ?").get(anterior.grupo_id).v;

  const editarReceta = db.transaction(() => {
    const insReceta = db.prepare(`
      INSERT INTO recetas (grupo_id, version, nombre_producto, rendimiento, minutos_mano_obra, usuario_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(anterior.grupo_id, maxVersion + 1, nombre_producto ?? anterior.nombre_producto,
           rendimiento ?? anterior.rendimiento, minutos_mano_obra ?? anterior.minutos_mano_obra, req.usuario.id);
    const nuevaId = insReceta.lastInsertRowid;

    const insItem = db.prepare("INSERT INTO receta_items (receta_id, ingrediente_id, cantidad_base) VALUES (?, ?, ?)");
    for (const it of items) insItem.run(nuevaId, it.ingrediente_id, it.cantidad_base);

    db.prepare("UPDATE recetas SET vigente = 0 WHERE id = ?").run(anterior.id);

    return nuevaId;
  });

  const nuevaId = editarReceta();
  res.json({ id: nuevaId, version: maxVersion + 1 });
});

router.delete("/:id", requireRole("admin"), (req, res) => {
  const receta = db.prepare("SELECT * FROM recetas WHERE id = ?").get(req.params.id);
  if (!receta) return res.status(404).json({ error: "No existe" });
  const usada = db.prepare("SELECT COUNT(*) AS n FROM producciones WHERE receta_id IN (SELECT id FROM recetas WHERE grupo_id = ?)").get(receta.grupo_id).n;
  if (usada > 0) {
    return res.status(409).json({ error: "Esta receta tiene producciones históricas. Se desactiva en vez de borrarse para no perder el historial." });
  }
  db.prepare("UPDATE recetas SET activo = 0 WHERE grupo_id = ?").run(receta.grupo_id);
  res.json({ ok: true });
});

module.exports = router;
