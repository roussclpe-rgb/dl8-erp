// src/routes/ventas.js
const express = require("express");
const crypto = require("crypto");
const { db, obtenerOCrearPeriodo } = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");
const { exigirPeriodoAbierto } = require("../services/periodos");
const { calcularVenta } = require("../services/ventas");
const caja = require("../services/caja");

const router = express.Router();
router.use(requireAuth);

function siguienteFolio() {
  return db.prepare("SELECT COALESCE(MAX(folio), 0) + 1 AS folio FROM ventas").get().folio;
}

function saldoVenta(ventaId) {
  const venta = db.prepare("SELECT total FROM ventas WHERE id = ?").get(ventaId);
  const pagado = db
    .prepare("SELECT COALESCE(SUM(monto), 0) AS total FROM pagos WHERE venta_id = ?")
    .get(ventaId).total;
  return venta.total - pagado;
}

function hashPagoHttp(ventaId, pagos, turnoCajaId) {
  return crypto.createHash("sha256")
    .update(JSON.stringify({ venta_id: Number(ventaId), pagos, turno_caja_id: turnoCajaId || null }))
    .digest("hex");
}

// Si la venta/cobro trae un turno_caja_id, exige que ese turno esté abierto
// ANTES de tocar la base de datos (falla rápido, con mensaje claro, en vez
// de abortar a mitad de una transacción de venta ya iniciada).
function validarTurnoSiAplica(turnoCajaId) {
  if (!turnoCajaId) return null;
  const turno = caja.turnoAbiertoPorId(turnoCajaId);
  if (!turno) {
    const err = new Error("El turno de caja indicado no está abierto. Abre la caja antes de registrar el cobro.");
    err.status = 409;
    throw err;
  }
  return turno;
}
router.get("/", (req, res) => {
  const ventas = db.prepare(`
    SELECT v.*, c.nombre AS cliente_nombre
    FROM ventas v JOIN clientes c ON c.id = v.cliente_id
    WHERE v.anulado = 0
    ORDER BY v.fecha DESC, v.id DESC
  `).all();
  res.json(ventas.map((v) => ({ ...v, saldo: saldoVenta(v.id) })));
});

router.get("/pendientes", (req, res) => {
  const ventas = db.prepare(`
    SELECT v.*, c.nombre AS cliente_nombre
    FROM ventas v JOIN clientes c ON c.id = v.cliente_id
    WHERE v.anulado = 0
  `).all();
  const conSaldo = ventas.map((v) => ({ ...v, saldo: saldoVenta(v.id) }));
  res.json(conSaldo.filter((v) => v.saldo > 0.01));
});

router.get("/:id", (req, res) => {
  const venta = db.prepare(`
    SELECT v.*, c.nombre AS cliente_nombre FROM ventas v
    JOIN clientes c ON c.id = v.cliente_id WHERE v.id = ?
  `).get(req.params.id);
  if (!venta) return res.status(404).json({ error: "No existe" });
  const items = db.prepare("SELECT * FROM venta_items WHERE venta_id = ?").all(venta.id);
  const pagos = db.prepare("SELECT * FROM pagos WHERE venta_id = ?").all(venta.id);
  res.json({ ...venta, saldo: saldoVenta(venta.id), items, pagos });
});

// body: { cliente_id, fecha, items: [{ receta_grupo_id, cantidad }], pagos?: [{ monto, metodoPago }] }
router.post("/", requireRole("admin", "operador", "vendedor"), (req, res) => {
  const { cliente_id, fecha, items, pagos = [], turno_caja_id, descuento_tipo, descuento_valor } = req.body;

  if (!cliente_id || !fecha || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "cliente_id, fecha e items son obligatorios" });
  }

  // Validación de seguridad: evita cantidades negativas, cero o inválidas
for (const it of items) {
  if (!it.receta_grupo_id || !(Number(it.cantidad) > 0)) {
    return res.status(400).json({
      error: "Cada producto debe tener una cantidad mayor a 0"
    });
  }
}

  const cliente = db.prepare("SELECT * FROM clientes WHERE id = ? AND activo = 1").get(cliente_id);
  if (!cliente) return res.status(400).json({ error: "Cliente no existe o está inactivo" });

  let periodo;
  try {
    periodo = exigirPeriodoAbierto(fecha);
    validarTurnoSiAplica(turno_caja_id);
  } catch (e) {
    return res.status(e.status || 400).json({ error: e.message });
  }

  // Cálculo (precio + validación de stock) + inserciones + log, todo en una
  // sola transacción: si el stock no alcanza a mitad de camino, better-sqlite3
  // revierte todo automáticamente, igual que en producciones.js.
  const crearVenta = db.transaction(() => {
    const { itemsCalculados, subtotal, descuentoMonto, total } = calcularVenta({
      items,
      cliente,
      descuentoTipo: descuento_tipo,
      descuentoValor: descuento_valor,
    });

    const folio = siguienteFolio();
    const info = db.prepare(`
      INSERT INTO ventas (folio, fecha, cliente_id, periodo_id, subtotal, descuento_tipo, descuento_valor, total, usuario_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      folio,
      fecha,
      cliente_id,
      periodo.id,
      subtotal,
      descuentoMonto > 0 ? descuento_tipo : null,
      descuentoMonto > 0 ? Number(descuento_valor) : 0,
      total,
      req.usuario.id
    );
    const ventaId = info.lastInsertRowid;

    const insItem = db.prepare(`
      INSERT INTO venta_items (venta_id, receta_grupo_id, nombre_producto, cantidad, precio_unitario, subtotal)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    itemsCalculados.forEach((it) =>
      insItem.run(ventaId, it.receta_grupo_id, it.nombre_producto, it.cantidad, it.precioUnitario, it.subtotal)
    );

    const insPago = db.prepare(`
      INSERT INTO pagos (venta_id, monto, metodo_pago, fecha, usuario_id) VALUES (?, ?, ?, ?, ?)
    `);
    pagos
      .filter((p) => p.monto > 0)
      .forEach((p) => {
        const pagoId = Number(insPago.run(ventaId, p.monto, p.metodoPago, fecha, req.usuario.id).lastInsertRowid);
        if (turno_caja_id) {
          const evento = caja.registrarCobroVenta({
            turnoId: turno_caja_id,
            ventaId,
            pagoId,
            tipo: "venta",
            metodoPago: p.metodoPago,
            monto: p.monto,
            motivo: `Venta folio ${folio} — ${cliente.nombre}`,
            referenciaTipo: "venta",
            referenciaId: ventaId,
            usuarioId: req.usuario.id,
            fecha,
          });
          db.prepare("UPDATE pagos SET evento_financiero_id = ? WHERE id = ?").run(evento.id, pagoId);
        }
      });

    db.prepare(`
      INSERT INTO log_auditoria (usuario_id, entidad, entidad_id, accion, datos_antes, datos_despues)
      VALUES (?, 'venta', ?, 'crear', NULL, ?)
    `).run(req.usuario.id, ventaId, JSON.stringify({ items: itemsCalculados, pagos }));

    return { id: ventaId, folio, total };
  });

  let resultado;
  try {
    resultado = crearVenta();
  } catch (e) {
    return res.status(e.status || 400).json({ error: e.message });
  }

  res.status(201).json(resultado);
});

// Anular en vez de borrar, igual que producciones. El stock se "devuelve"
// solo (stockDisponible ignora ventas con anulado = 1), no hay que tocar nada más.
router.post("/:id/anular", requireRole("admin"), (req, res) => {
  const venta = db.prepare("SELECT * FROM ventas WHERE id = ?").get(req.params.id);
  if (!venta) return res.status(404).json({ error: "No existe" });
  if (venta.anulado) return res.status(409).json({ error: "Esta venta ya estaba anulada" });

  try {
    exigirPeriodoAbierto(venta.fecha);
  } catch (e) {
    return res.status(e.status || 400).json({ error: e.message });
  }

  const anular = db.transaction(() => {
    db.prepare("UPDATE ventas SET anulado = 1 WHERE id = ?").run(venta.id);
    db.prepare(`
      INSERT INTO log_auditoria (usuario_id, entidad, entidad_id, accion, datos_antes, datos_despues)
      VALUES (?, 'venta', ?, 'anular', ?, NULL)
    `).run(req.usuario.id, venta.id, JSON.stringify(venta));
  });
  anular();

  res.json({ ok: true });
});

// Cobrar saldo pendiente de una venta ya existente.
// body: { pagos: [{ monto, metodoPago }], turno_caja_id? }
router.post("/:id/pagos", requireRole("admin", "operador", "vendedor"), (req, res) => {
  const venta = db.prepare("SELECT * FROM ventas WHERE id = ? AND anulado = 0").get(req.params.id);
  if (!venta) return res.status(404).json({ error: "Venta no encontrada" });

  const { pagos = [], turno_caja_id } = req.body;
  const hoy = new Date().toISOString().slice(0, 10);
  const claveIdempotencia = req.get("Idempotency-Key")?.trim();
  const hashPayload = claveIdempotencia ? hashPagoHttp(venta.id, pagos, turno_caja_id) : null;

  if (claveIdempotencia) {
    const previo = db.prepare("SELECT hash_payload, respuesta_json FROM pagos_claves_idempotencia WHERE usuario_id = ? AND clave = ?").get(req.usuario.id, claveIdempotencia);
    if (previo) {
      if (previo.hash_payload !== hashPayload) return res.status(409).json({ error: "La clave de idempotencia se usó con otro payload" });
      return res.json(JSON.parse(previo.respuesta_json));
    }
  }

  try {
    validarTurnoSiAplica(turno_caja_id);
  } catch (e) {
    return res.status(e.status || 400).json({ error: e.message });
  }

  const registrar = db.transaction(() => {
    const insPago = db.prepare(`
      INSERT INTO pagos (venta_id, monto, metodo_pago, fecha, usuario_id) VALUES (?, ?, ?, ?, ?)
    `);
    pagos
          .filter((p) => p.monto > 0)
          .forEach((p) => {
            const pagoId = Number(insPago.run(venta.id, p.monto, p.metodoPago, hoy, req.usuario.id).lastInsertRowid);
            if (turno_caja_id) {
              const evento = caja.registrarCobroVenta({
                turnoId: turno_caja_id,
                ventaId: venta.id,
                pagoId,
                tipo: "cobro",
                metodoPago: p.metodoPago,
                monto: p.monto,
                motivo: `Cobro venta folio ${venta.folio}`,
                referenciaTipo: "venta",
                referenciaId: venta.id,
                usuarioId: req.usuario.id,
                fecha: hoy,
              });
              db.prepare("UPDATE pagos SET evento_financiero_id = ? WHERE id = ?").run(evento.id, pagoId);
            }
          });
    const resultado = { saldo: saldoVenta(venta.id) };
    if (claveIdempotencia) {
      db.prepare("INSERT INTO pagos_claves_idempotencia (venta_id, usuario_id, clave, hash_payload, respuesta_json) VALUES (?, ?, ?, ?, ?)")
        .run(venta.id, req.usuario.id, claveIdempotencia, hashPayload, JSON.stringify(resultado));
    }
    return resultado;
  });
  let resultado;
  try {
    resultado = registrar();
  } catch (e) {
    return res.status(e.status || 400).json({ error: e.message });
  }

  res.json(resultado);
});

module.exports = router;
