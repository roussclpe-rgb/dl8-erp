const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "..", "data.sqlite");
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

const schema = fs.readFileSync(path.join(__dirname, "..", "schema.sql"), "utf8");
db.exec(schema);

try {
  const esquemaFinanzas = fs.readFileSync(path.join(__dirname, "..", "finanzas-schema.sql"), "utf8");
  db.exec(esquemaFinanzas);
} catch (e) {
  db.close();
  throw new Error("No se pudo cargar el esquema financiero. Revisa backend/finanzas-schema.sql.");
}
// Asegura que exista el periodo del mes actual (u otro, según fecha) abierto.
function obtenerOCrearPeriodo(fechaISO) {
  const [anio, mes] = fechaISO.slice(0, 7).split("-").map(Number);
  let periodo = db.prepare("SELECT * FROM periodos WHERE anio = ? AND mes = ?").get(anio, mes);
  if (!periodo) {
    const info = db.prepare("INSERT INTO periodos (anio, mes, estado) VALUES (?, ?, 'abierto')").run(anio, mes);
    periodo = db.prepare("SELECT * FROM periodos WHERE id = ?").get(info.lastInsertRowid);
  }
  return periodo;
}

function periodoEstaAbierto(periodo) {
  return periodo.estado === "abierto";
}

module.exports = { db, obtenerOCrearPeriodo, periodoEstaAbierto };
