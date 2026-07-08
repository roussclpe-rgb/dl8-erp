const { db, obtenerOCrearPeriodo, periodoEstaAbierto } = require("../db");

// Lanza un error legible si la fecha dada cae en un periodo cerrado.
// Se usa antes de CUALQUIER creación, edición o borrado que afecte esa fecha.
function exigirPeriodoAbierto(fechaISO) {
  const periodo = obtenerOCrearPeriodo(fechaISO);
  if (!periodoEstaAbierto(periodo)) {
    const err = new Error(
      `El periodo ${periodo.mes}/${periodo.anio} ya está cerrado. Registra esto como un ajuste nuevo en el periodo actual en vez de editar el histórico.`
    );
    err.status = 409;
    throw err;
  }
  return periodo;
}

function cerrarPeriodo(anio, mes, usuarioId) {
  const periodo = db.prepare("SELECT * FROM periodos WHERE anio = ? AND mes = ?").get(anio, mes);
  if (!periodo) {
    const err = new Error("Ese periodo no existe todavía (no hay movimientos registrados en él).");
    err.status = 404;
    throw err;
  }
  if (periodo.estado === "cerrado") {
    const err = new Error("Ese periodo ya estaba cerrado.");
    err.status = 409;
    throw err;
  }
  db.prepare("UPDATE periodos SET estado = 'cerrado', cerrado_por = ?, cerrado_en = datetime('now') WHERE id = ?")
    .run(usuarioId, periodo.id);
  return db.prepare("SELECT * FROM periodos WHERE id = ?").get(periodo.id);
}

function listarPeriodos() {
  return db.prepare("SELECT * FROM periodos ORDER BY anio DESC, mes DESC").all();
}

module.exports = { exigirPeriodoAbierto, cerrarPeriodo, listarPeriodos };
