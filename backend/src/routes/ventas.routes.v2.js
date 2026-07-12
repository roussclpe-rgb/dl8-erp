// src/routes/ventas.js
const express = require("express");
const { db } = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");
const { exigirPeriodoAbierto } = require("../services/periodos");
const { calcularVenta } = require("../services/ventas");
const caja = require("../services/caja");
const { emitirVenta, buscarVentaIdempotente } = require("../services/finanzas/ventas");
const { registrarCobrosVenta, buscarPagoIdempotente, saldoDocumento, anularVentaSinCobros } = require("../services/finanzas/cobros-cxc");
const { hashCanonico } = require("../services/finanzas/idempotencia");

const router = express.Router();
router.use(requireAuth);

function saldoVenta(ventaId) {
  const venta = db.prepare("SELECT total FROM ventas WHERE id = ?").get(ventaId);
  const documento = db.prepare("SELECT id,entidad_id,estado,importe_original_minor FROM fin_documentos_cxc WHERE venta_id=?").get(ventaId);
  if (documento) {
    const saldo = saldoDocumento(documento.id);
    return { saldo: saldo.saldoMinor / 100, estado_cxc: documento.estado, historico: false, documento_cxc_id: documento.id, entidad_id: documento.entidad_id };
  }
  const pagado = db
    .prepare("SELECT COALESCE(SUM(monto), 0) AS total FROM pagos WHERE venta_id = ?")
    .get(ventaId).total;
  return { saldo: venta.total - pagado, estado_cxc: null, historico: true, documento_cxc_id: null };
}

function hashPagoHttp(ventaId, pagos, turnoCajaId) {
  return hashCanonico({ venta_id: Number(ventaId), pagos, turno_caja_id: turnoCajaId || null });
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
  res.json(ventas.map((v) => ({ ...v, ...saldoVenta(v.id) })));
});

router.get("/pendientes", (req, res) => {
  const ventas = db.prepare(`
    SELECT v.*, c.nombre AS cliente_nombre
    FROM ventas v JOIN clientes c ON c.id = v.cliente_id
    WHERE v.anulado = 0
  `).all();
  const conSaldo = ventas.map((v) => ({ ...v, ...saldoVenta(v.id) }));
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
  res.json({ ...venta, ...saldoVenta(venta.id), items, pagos });
});

// body: { cliente_id, fecha, items: [{ receta_grupo_id, cantidad }], pagos?: [{ monto, metodoPago }] }
router.post("/", requireRole("admin", "operador", "vendedor"), (req, res) => {
  const { cliente_id, entidad_id, fecha, items, pagos = [], turno_caja_id, descuento_tipo, descuento_valor } = req.body;
  const claveIdempotencia = req.get("Idempotency-Key")?.trim();

  try {
    const previo = buscarVentaIdempotente({ usuarioId: req.usuario.id, clave: claveIdempotencia, payload: req.body });
    if (previo) return res.status(201).json(previo);
  } catch (e) {
    return res.status(e.status || 400).json({ error: e.message });
  }

  if (!cliente_id || !entidad_id || !fecha || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "entidad_id, cliente_id, fecha e items son obligatorios" });
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
    const turno = validarTurnoSiAplica(turno_caja_id);
    if (turno) {
      const cajaTurno = caja.cajaConfigurada(turno.caja_id);
      if (Number(cajaTurno.entidad_id) !== Number(entidad_id)) {
        const error = new Error("El turno de caja no pertenece a la entidad económica de la venta");
        error.status = 409;
        throw error;
      }
    }
  } catch (e) {
    return res.status(e.status || 400).json({ error: e.message });
  }

  let resultado;
  try {
    resultado = emitirVenta({
      entidadId: Number(entidad_id), usuarioId: req.usuario.id, fecha, cliente, periodoId: periodo.id,
      items, descuentoTipo: descuento_tipo, descuentoValor: descuento_valor, pagos, turnoCajaId: turno_caja_id,
      claveIdempotencia, payloadIdempotencia: req.body, calcularVenta,
      registrarPagos: ({ ventaId, pagos: pagosVenta, turnoCajaId }) => pagosVenta.length
        ? registrarCobrosVenta({ ventaId, pagos: pagosVenta, turnoCajaId, usuarioId: req.usuario.id, fecha })
        : null,
    });
  } catch (e) {
    return res.status(e.status || 400).json({ error: e.status ? e.message : "No se pudo confirmar la venta" });
  }

  res.status(201).json(resultado);
});

// Anular en vez de borrar, igual que producciones. El stock se "devuelve"
// solo (stockDisponible ignora ventas con anulado = 1), no hay que tocar nada más.
router.post("/:id/anular", requireRole("admin"), (req, res) => {
  const venta = db.prepare("SELECT * FROM ventas WHERE id = ?").get(req.params.id);
  if (!venta) return res.status(404).json({ error: "No existe" });
  if (db.prepare("SELECT 1 FROM fin_documentos_cxc WHERE venta_id=?").get(venta.id)) {
    try {
      return res.json(anularVentaSinCobros({ ventaId: venta.id, usuarioId: req.usuario.id }));
    } catch (e) {
      return res.status(e.status || 400).json({ error: e.status ? e.message : "No se pudo anular la venta" });
    }
  }

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
  const { pagos = [], turno_caja_id } = req.body;
  const hoy = new Date().toISOString().slice(0, 10);
  const claveIdempotencia = req.get("Idempotency-Key")?.trim();
  try {
    const previo = buscarPagoIdempotente({ usuarioId: req.usuario.id, clave: claveIdempotencia, ventaId: req.params.id, pagos, turnoCajaId: turno_caja_id });
    if (previo) return res.json(previo);
  } catch (e) {
    return res.status(e.status || 400).json({ error: e.message });
  }

  const venta = db.prepare("SELECT * FROM ventas WHERE id = ? AND anulado = 0").get(req.params.id);
  if (!venta) return res.status(404).json({ error: "Venta no encontrada" });
  const hashPayload = claveIdempotencia ? hashPagoHttp(venta.id, pagos, turno_caja_id) : null;

  if (db.prepare("SELECT 1 FROM fin_documentos_cxc WHERE venta_id=?").get(venta.id)) {
    try {
      return res.json(registrarCobrosVenta({ ventaId: venta.id, pagos, turnoCajaId: turno_caja_id, usuarioId: req.usuario.id, fecha: hoy, claveIdempotencia }));
    } catch (e) {
      return res.status(e.status || 400).json({ error: e.status ? e.message : "No se pudo registrar el cobro" });
    }
  }

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
    const resultado = { saldo: saldoVenta(venta.id).saldo };
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
