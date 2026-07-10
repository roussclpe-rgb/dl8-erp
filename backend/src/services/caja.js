const { db } = require("../db");

// Métodos de pago soportados: mismo dominio que pagos.metodo_pago (ventas.js),
// para no introducir un segundo catálogo de métodos que se pueda desincronizar.
const METODOS_PAGO = ["Efectivo", "Yape", "Transferencia", "Tarjeta"];

function turnoAbierto(cajaId) {
  return db.prepare("SELECT * FROM turnos_caja WHERE caja_id = ? AND estado = 'abierto'").get(cajaId);
}

function turnoAbiertoPorId(turnoId) {
  return db.prepare("SELECT * FROM turnos_caja WHERE id = ? AND estado = 'abierto'").get(turnoId);
}

// Resumen de un turno: movimientos, totales por método de pago e ingresos/egresos.
// La apertura se contabiliza como un ingreso en efectivo (así el efectivo
// esperado al cierre = suma de movimientos con metodo_pago = 'Efectivo').
function resumenTurno(turnoId) {
  const movimientos = db.prepare(`
    SELECT m.*, u.nombre AS usuario_nombre FROM movimientos_caja m
    JOIN usuarios u ON u.id = m.usuario_id
    WHERE m.turno_id = ? ORDER BY m.id
  `).all(turnoId);

  const porMetodo = {};
  let totalIngresos = 0;
  let totalEgresos = 0;
  for (const m of movimientos) {
    const key = m.metodo_pago || "Otro";
    porMetodo[key] = (porMetodo[key] || 0) + m.monto;
    if (m.monto >= 0) totalIngresos += m.monto;
    else totalEgresos += Math.abs(m.monto);
  }

  return { movimientos, porMetodo, totalIngresos, totalEgresos };
}

// Efectivo que debería haber físicamente en la caja: todo movimiento cuyo
// método de pago es Efectivo, incluida la apertura.
function efectivoEsperado(turnoId) {
  const row = db.prepare(`
    SELECT COALESCE(SUM(monto), 0) AS total FROM movimientos_caja
    WHERE turno_id = ? AND metodo_pago = 'Efectivo'
  `).get(turnoId);
  return row.total;
}

const abrirTurno = db.transaction(({ cajaId, montoApertura, notas, usuarioId }) => {
  // El índice único idx_turno_abierto_unico también protege esto a nivel de
  // BD ante condiciones de carrera; esta verificación solo da un mensaje
  // legible en el caso normal (sin carrera).
  if (turnoAbierto(cajaId)) {
    const err = new Error("Esta caja ya tiene un turno abierto. Ciérralo antes de abrir uno nuevo.");
    err.status = 409;
    throw err;
  }

  const info = db.prepare(`
    INSERT INTO turnos_caja (caja_id, monto_apertura, notas_apertura, usuario_apertura_id)
    VALUES (?, ?, ?, ?)
  `).run(cajaId, montoApertura, notas || null, usuarioId);
  const turnoId = info.lastInsertRowid;

  db.prepare(`
    INSERT INTO movimientos_caja (turno_id, tipo, metodo_pago, monto, motivo, referencia_tipo, usuario_id)
    VALUES (?, 'apertura', 'Efectivo', ?, 'Apertura de caja', 'manual', ?)
  `).run(turnoId, montoApertura, usuarioId);

  return turnoId;
});

// Registra un movimiento sobre un turno abierto. Usado tanto por ingresos y
// egresos manuales (routes/caja.js) como por la integración con ventas
// (routes/ventas.routes.v2.js): cada pago de una venta o de un cobro genera
// aquí un movimiento con referencia a la venta que lo originó.
const registrarMovimiento = db.transaction(({ turnoId, tipo, metodoPago, monto, motivo, referenciaTipo, referenciaId, usuarioId, fecha }) => {
  const turno = turnoAbiertoPorId(turnoId);
  if (!turno) {
    const err = new Error("El turno de caja indicado no existe o ya está cerrado.");
    err.status = 409;
    throw err;
  }
  if (metodoPago && !METODOS_PAGO.includes(metodoPago)) {
    const err = new Error(`Método de pago inválido. Usa uno de: ${METODOS_PAGO.join(", ")}`);
    err.status = 400;
    throw err;
  }

  db.prepare(`
    INSERT INTO movimientos_caja (turno_id, tipo, metodo_pago, monto, motivo, referencia_tipo, referencia_id, usuario_id, fecha)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(turnoId, tipo, metodoPago || null, monto, motivo || null, referenciaTipo || null, referenciaId || null, usuarioId, fecha || new Date().toISOString());
});

const cerrarTurno = db.transaction(({ turnoId, montoContado, notas, usuarioId }) => {
  const turno = turnoAbiertoPorId(turnoId);
  if (!turno) {
    const err = new Error("Este turno ya está cerrado o no existe.");
    err.status = 409;
    throw err;
  }

  const esperado = efectivoEsperado(turnoId);
  const diferencia = montoContado - esperado;

  db.prepare(`
    UPDATE turnos_caja SET
      estado = 'cerrado', monto_cierre_esperado = ?, monto_cierre_contado = ?, diferencia = ?,
      notas_cierre = ?, usuario_cierre_id = ?, fecha_cierre = datetime('now')
    WHERE id = ?
  `).run(esperado, montoContado, diferencia, notas || null, usuarioId, turnoId);

  // El movimiento de cierre no mueve dinero (monto 0): es solo un marcador
  // de auditoría dentro del propio historial de movimientos del turno.
  db.prepare(`
    INSERT INTO movimientos_caja (turno_id, tipo, metodo_pago, monto, motivo, referencia_tipo, usuario_id)
    VALUES (?, 'cierre', 'Efectivo', 0, 'Cierre de caja', 'manual', ?)
  `).run(turnoId, usuarioId);

  return { turnoId, esperado, contado: montoContado, diferencia };
});

module.exports = {
  METODOS_PAGO,
  turnoAbierto,
  turnoAbiertoPorId,
  resumenTurno,
  efectivoEsperado,
  abrirTurno,
  registrarMovimiento,
  cerrarTurno,
};
