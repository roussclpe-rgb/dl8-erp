const express = require("express");
const { db } = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");
const caja = require("../services/caja");

const router = express.Router();
router.use(requireAuth);

// ---------- Cajas (registros físicos) ----------

router.get("/", (req, res) => {
  const cajas = db.prepare("SELECT * FROM cajas WHERE activo = 1 ORDER BY nombre").all();
  const conEstado = cajas.map((c) => {
    const turno = caja.turnoAbierto(c.id);
    return { ...c, turnoAbiertoId: turno ? turno.id : null };
  });
  res.json(conEstado);
});

router.post("/", requireRole("admin"), (req, res) => {
  const { nombre } = req.body;
  if (!nombre?.trim()) return res.status(400).json({ error: "El nombre es obligatorio" });
  const info = db.prepare("INSERT INTO cajas (nombre) VALUES (?)").run(nombre.trim());
  res.status(201).json({ id: info.lastInsertRowid });
});

router.delete("/:id", requireRole("admin"), (req, res) => {
  const abierto = caja.turnoAbierto(req.params.id);
  if (abierto) {
    return res.status(409).json({ error: "No puedes desactivar una caja con un turno abierto. Ciérralo primero." });
  }
  db.prepare("UPDATE cajas SET activo = 0 WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// ---------- Turno actual de una caja ----------

router.get("/:id/turno-actual", (req, res) => {
  const turno = caja.turnoAbierto(req.params.id);
  if (!turno) return res.json(null);
  res.json({ ...turno, ...caja.resumenTurno(turno.id), efectivoEsperado: caja.efectivoEsperado(turno.id) });
});

router.post("/:id/abrir", requireRole("admin", "operador", "vendedor"), (req, res) => {
  const { monto_apertura, notas } = req.body;
  if (!(monto_apertura >= 0)) return res.status(400).json({ error: "monto_apertura debe ser 0 o mayor" });

  const cajaRow = db.prepare("SELECT * FROM cajas WHERE id = ? AND activo = 1").get(req.params.id);
  if (!cajaRow) return res.status(404).json({ error: "Caja no existe o está inactiva" });

  let turnoId;
  try {
    turnoId = caja.abrirTurno({ cajaId: req.params.id, montoApertura: monto_apertura, notas, usuarioId: req.usuario.id });
  } catch (e) {
    return res.status(e.status || 400).json({ error: e.message });
  }
  res.status(201).json({ id: turnoId });
});

// ---------- Turnos (historial + detalle + cierre) ----------

router.get("/turnos", (req, res) => {
  const { desde, hasta, caja_id } = req.query;
  let sql = `
    SELECT t.*, c.nombre AS caja_nombre,
           ua.nombre AS usuario_apertura_nombre, uc.nombre AS usuario_cierre_nombre
    FROM turnos_caja t
    JOIN cajas c ON c.id = t.caja_id
    JOIN usuarios ua ON ua.id = t.usuario_apertura_id
    LEFT JOIN usuarios uc ON uc.id = t.usuario_cierre_id
    WHERE date(t.fecha_apertura) >= ? AND date(t.fecha_apertura) <= ?
  `;
  const params = [desde || "0000-01-01", hasta || "9999-12-31"];
  if (caja_id) {
    sql += " AND t.caja_id = ?";
    params.push(caja_id);
  }
  sql += " ORDER BY t.fecha_apertura DESC, t.id DESC";
  res.json(db.prepare(sql).all(...params));
});

router.get("/turnos/:turnoId", (req, res) => {
  const turno = db.prepare(`
    SELECT t.*, c.nombre AS caja_nombre,
           ua.nombre AS usuario_apertura_nombre, uc.nombre AS usuario_cierre_nombre
    FROM turnos_caja t
    JOIN cajas c ON c.id = t.caja_id
    JOIN usuarios ua ON ua.id = t.usuario_apertura_id
    LEFT JOIN usuarios uc ON uc.id = t.usuario_cierre_id
    WHERE t.id = ?
  `).get(req.params.turnoId);
  if (!turno) return res.status(404).json({ error: "No existe" });
  res.json({ ...turno, ...caja.resumenTurno(turno.id) });
});

router.post("/turnos/:turnoId/cerrar", requireRole("admin", "operador", "vendedor"), (req, res) => {
  const { monto_contado, notas } = req.body;
  if (!(monto_contado >= 0)) return res.status(400).json({ error: "monto_contado debe ser 0 o mayor" });

  let resultado;
  try {
    resultado = caja.cerrarTurno({ turnoId: req.params.turnoId, montoContado: monto_contado, notas, usuarioId: req.usuario.id });
  } catch (e) {
    return res.status(e.status || 400).json({ error: e.message });
  }
  res.json(resultado);
});

// ---------- Movimientos manuales (ingresos / egresos) ----------
// Las ventas y cobros generan sus propios movimientos automáticamente desde
// routes/ventas.routes.v2.js; este endpoint es solo para dinero que entra o
// sale de caja por fuera de una venta (ej. compra menor, retiro a bóveda).

router.post("/movimientos", requireRole("admin", "operador", "vendedor"), (req, res) => {
  const { turno_id, tipo, monto, metodo_pago, motivo } = req.body;
  if (!["ingreso", "egreso"].includes(tipo)) {
    return res.status(400).json({ error: "Tipo inválido. Usa: ingreso o egreso" });
  }
  if (!(monto > 0) || !motivo?.trim()) {
    return res.status(400).json({ error: "Monto (mayor a 0) y motivo son obligatorios" });
  }

  const montoFirmado = tipo === "egreso" ? -Math.abs(monto) : Math.abs(monto);
  try {
    caja.registrarMovimiento({
      turnoId: turno_id,
      tipo,
      metodoPago: metodo_pago || "Efectivo",
      monto: montoFirmado,
      motivo,
      referenciaTipo: "manual",
      referenciaId: null,
      usuarioId: req.usuario.id,
      fecha: new Date().toISOString(),
    });
  } catch (e) {
    return res.status(e.status || 400).json({ error: e.message });
  }
  res.status(201).json({ ok: true });
});

router.get("/movimientos", (req, res) => {
  const { turno_id } = req.query;
  if (!turno_id) return res.status(400).json({ error: "turno_id es obligatorio" });
  res.json(db.prepare(`
    SELECT m.*, u.nombre AS usuario_nombre FROM movimientos_caja m
    JOIN usuarios u ON u.id = m.usuario_id
    WHERE m.turno_id = ?
    ORDER BY m.id DESC
  `).all(turno_id));
});

module.exports = router;
