const express = require("express");
const { db, obtenerOCrearPeriodo } = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");
const { exigirPeriodoAbierto } = require("../services/periodos");
const { revertir } = require("../services/fifo");
const { calcularProduccion, normalizarCantidadProduccion } = require("../services/producciones");
const { analizarFactibilidadProduccion, crearListaCompraFaltantes } = require("../services/factibilidad-produccion");

const router = express.Router();
router.use(requireAuth);

router.get("/", (req, res) => {
  const producciones = db.prepare(`
    SELECT p.*, r.nombre_producto, r.version
    FROM producciones p JOIN recetas r ON r.id = p.receta_id
    WHERE p.anulado = 0
    ORDER BY p.fecha DESC, p.id DESC
  `).all();
  res.json(producciones);
});

router.get("/factibilidad", (req, res) => {
  res.json(analizarFactibilidadProduccion());
});

router.post("/faltantes/lista-compra", requireRole("admin", "operador"), (req, res) => {
  try { res.status(201).json(crearListaCompraFaltantes({ usuarioId: req.usuario.id })); }
  catch (error) { res.status(error.status || 400).json({ error: error.message }); }
});

router.post("/", requireRole("admin", "operador"), (req, res) => {
  const { receta_id, tandas, unidades, modo = "tandas", fecha } = req.body;
  const receta = db.prepare("SELECT * FROM recetas WHERE id = ?").get(receta_id);
  if (!receta) return res.status(400).json({ error: "Receta no existe" });
  let tandasFinales;
  try { tandasFinales = normalizarCantidadProduccion({ modo, tandas, unidades, rendimiento: receta.rendimiento }).tandas; }
  catch (error) { return res.status(error.status || 400).json({ error: error.message }); }

  const items = db.prepare("SELECT * FROM receta_items WHERE receta_id = ?").all(receta_id);

  let periodo;
  try {
    periodo = exigirPeriodoAbierto(fecha);
  } catch (e) {
    return res.status(e.status || 400).json({ error: e.message });
  }

  // Todo el flujo (consumo de materia prima + insert de la producción + log
  // de auditoría) vive en una sola transacción: si algo falla a mitad de
  // camino, better-sqlite3 revierte todo automáticamente.
  const crearProduccion = db.transaction(() => {
    const resultado = calcularProduccion({ receta, items, tandas: tandasFinales, fecha, periodoId: periodo.id, usuarioId: req.usuario.id });

    const consumosJson = JSON.stringify(resultado.consumosTotales);
    const info = db.prepare(`
      INSERT INTO producciones
        (receta_id, periodo_id, tandas, unidades_producidas, costo_materia_prima, costo_mano_obra, costo_indirectos, costo_total, costo_unidad, fecha, usuario_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(receta_id, periodo.id, tandasFinales, resultado.unidadesProducidas, resultado.costoMateriaPrima,
           resultado.costoManoObra, resultado.costoIndirectos, resultado.costoTotal, resultado.costoUnidad, fecha, req.usuario.id);

    // Guardamos el detalle de consumo en log_auditoria para poder revertirlo si se edita/anula después
    db.prepare(`INSERT INTO log_auditoria (usuario_id, entidad, entidad_id, accion, datos_antes, datos_despues) VALUES (?, 'produccion', ?, 'crear', NULL, ?)`)
      .run(req.usuario.id, info.lastInsertRowid, consumosJson);

    return { id: info.lastInsertRowid, ...resultado };
  });

  let resultado;
  try {
    resultado = crearProduccion();
  } catch (e) {
    return res.status(e.status || 400).json({ error: e.message });
  }

  res.status(201).json(resultado);
});

// Editar producción = anular la anterior (revierte su consumo) + registrar una nueva.
// Solo permitido si el periodo (viejo y nuevo) sigue abierto.
router.put("/:id", requireRole("admin", "operador"), (req, res) => {
  const anterior = db.prepare("SELECT * FROM producciones WHERE id = ?").get(req.params.id);
  if (!anterior) return res.status(404).json({ error: "No existe" });

  try {
    exigirPeriodoAbierto(anterior.fecha);
    exigirPeriodoAbierto(req.body.fecha || anterior.fecha);
  } catch (e) {
    return res.status(e.status || 400).json({ error: e.message });
  }

  // IMPORTANTE: se busca el log de consumo más reciente para esta producción,
  // sin filtrar por accion='crear'. Si se filtrara solo por 'crear', una
  // producción editada una segunda vez no encontraría su log (porque la
  // primera edición lo guardó con accion='editar') y el revertir() de abajo
  // nunca se ejecutaría: la materia prima consumida por esa versión se
  // perdería del inventario para siempre. Por eso se toma el ÚLTIMO log de
  // esta entidad, sin importar qué acción lo generó.
  const logConsumo = db.prepare(`
    SELECT datos_despues FROM log_auditoria WHERE entidad = 'produccion' AND entidad_id = ? ORDER BY id DESC LIMIT 1
  `).get(anterior.id);
  const consumosAnteriores = logConsumo ? JSON.parse(logConsumo.datos_despues) : [];

  const receta_id = req.body.receta_id || anterior.receta_id;
  const tandas = Number(req.body.tandas) || Number(anterior.tandas);
  const fecha = req.body.fecha || anterior.fecha;
  const receta = db.prepare("SELECT * FROM recetas WHERE id = ?").get(receta_id);
  if (!receta) return res.status(400).json({ error: "Receta no existe" });
  const items = db.prepare("SELECT * FROM receta_items WHERE receta_id = ?").all(receta_id);
  const periodo = obtenerOCrearPeriodo(fecha);

  // Reversión + anulación de la vieja + cálculo y creación de la nueva, todo
  // en una sola transacción atómica.
  const editarProduccion = db.transaction(() => {
    for (const c of consumosAnteriores) {
      revertir({
        consumos: c.consumos, ingredienteId: c.ingredienteId, referenciaTipo: "produccion",
        referenciaId: anterior.id, usuarioId: req.usuario.id, fecha, periodoId: anterior.periodo_id,
        motivo: "Reversión por edición de producción",
      });
    }
    db.prepare("UPDATE producciones SET anulado = 1 WHERE id = ?").run(anterior.id);

    const resultado = calcularProduccion({ receta, items, tandas, fecha, periodoId: periodo.id, usuarioId: req.usuario.id });

    const info = db.prepare(`
      INSERT INTO producciones
        (receta_id, periodo_id, tandas, unidades_producidas, costo_materia_prima, costo_mano_obra, costo_indirectos, costo_total, costo_unidad, fecha, usuario_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(receta_id, periodo.id, tandas, resultado.unidadesProducidas, resultado.costoMateriaPrima,
           resultado.costoManoObra, resultado.costoIndirectos, resultado.costoTotal, resultado.costoUnidad, fecha, req.usuario.id);

    db.prepare(`INSERT INTO log_auditoria (usuario_id, entidad, entidad_id, accion, datos_antes, datos_despues) VALUES (?, 'produccion', ?, 'editar', ?, ?)`)
      .run(req.usuario.id, info.lastInsertRowid, JSON.stringify(anterior), JSON.stringify(resultado.consumosTotales));

    return { id: info.lastInsertRowid, reemplazaA: anterior.id, ...resultado };
  });

  let resultado;
  try {
    resultado = editarProduccion();
  } catch (e) {
    return res.status(e.status || 400).json({ error: e.message });
  }

  res.json(resultado);
});

module.exports = router;
