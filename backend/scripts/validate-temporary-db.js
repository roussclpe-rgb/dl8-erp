const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const Database = require("better-sqlite3");

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dl8-migraciones-"));
const databasePath = path.join(directory, "fresh.sqlite");

function initialize(run) {
  const result = spawnSync(process.execPath, ["-e", "const {db}=require('./src/db'); db.close();"], {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, DB_PATH: databasePath, NODE_ENV: "development" },
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(`Falló inicialización temporal ${run}: ${result.stderr || result.stdout}`);
}

try {
  initialize(1);
  initialize(2);
  const db = new Database(databasePath, { readonly: true, fileMustExist: true });
  const integrity = db.pragma("integrity_check")[0].integrity_check;
  const foreignKeyViolations = db.pragma("foreign_key_check").length;
  const tables = db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table'").get().n;
  db.close();
  if (integrity !== "ok" || foreignKeyViolations !== 0) throw new Error(`Validación fallida: integrity=${integrity}, fk=${foreignKeyViolations}`);
  console.log(JSON.stringify({ initializations: 2, tables, integrity, foreign_key_violations: foreignKeyViolations, temporary_database: true }));
} finally {
  const resolved = path.resolve(directory);
  const temporaryRoot = path.resolve(os.tmpdir());
  if (!resolved.startsWith(`${temporaryRoot}${path.sep}`)) throw new Error("Se rechazó eliminar una ruta fuera del directorio temporal");
  fs.rmSync(resolved, { recursive: true, force: true });
}
