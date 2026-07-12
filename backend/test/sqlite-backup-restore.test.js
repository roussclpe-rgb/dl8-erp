const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Database = require("better-sqlite3");
const { backupDatabase, integrityCheck, restoreDatabase } = require("../scripts/sqlite-safety");

function temporaryWorkspace(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dl8-sqlite-safety-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function createDatabase(file, value) {
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.exec("CREATE TABLE datos(id INTEGER PRIMARY KEY, valor TEXT NOT NULL)");
  db.prepare("INSERT INTO datos(valor) VALUES(?)").run(value);
  return db;
}

test("backup usa la API SQLite, incluye datos confirmados en WAL y conserva solo 14 archivos", async (t) => {
  const directory = temporaryWorkspace(t);
  const source = path.join(directory, "source.sqlite");
  const backups = path.join(directory, "backups");
  const db = createDatabase(source, "inicial");
  db.prepare("INSERT INTO datos(valor) VALUES('confirmado-en-wal')").run();

  for (let index = 0; index < 16; index += 1) {
    await backupDatabase({ source, backupDirectory: backups, now: new Date(2026, 0, 1, 0, 0, index) });
  }
  db.close();

  const files = fs.readdirSync(backups).filter((name) => name.endsWith(".sqlite"));
  assert.equal(files.length, 14);
  const latest = path.join(backups, files.sort().at(-1));
  integrityCheck(latest);
  const copy = new Database(latest, { readonly: true });
  assert.deepEqual(copy.prepare("SELECT valor FROM datos ORDER BY id").all(), [
    { valor: "inicial" },
    { valor: "confirmado-en-wal" },
  ]);
  copy.close();
  integrityCheck(latest);
  assert.equal(fs.readdirSync(backups).some((name) => /-(wal|shm)$|\.tmp-/.test(name)), false);
});

test("restore valida, crea respaldo previo y reemplaza la base sin WAL o SHM residuales", async (t) => {
  const directory = temporaryWorkspace(t);
  const target = path.join(directory, "target.sqlite");
  const desired = path.join(directory, "desired.sqlite");
  const backups = path.join(directory, "backups");
  createDatabase(target, "anterior").close();
  createDatabase(desired, "restaurado").close();
  fs.writeFileSync(`${target}-wal`, "residuo");
  fs.writeFileSync(`${target}-shm`, "residuo");

  const result = await restoreDatabase({ backup: desired, target, backupDirectory: backups, verifyStopped: false });
  integrityCheck(target);
  const db = new Database(target, { readonly: true });
  assert.equal(db.prepare("SELECT valor FROM datos").get().valor, "restaurado");
  db.close();
  integrityCheck(target);
  assert.equal(fs.existsSync(result.preRestore), true);
  assert.equal(fs.existsSync(`${target}-wal`), false);
  assert.equal(fs.existsSync(`${target}-shm`), false);
});

test("restore aborta sin modificar el destino cuando el respaldo está corrupto", async (t) => {
  const directory = temporaryWorkspace(t);
  const target = path.join(directory, "target.sqlite");
  const corrupt = path.join(directory, "corrupt.sqlite");
  createDatabase(target, "intacto").close();
  fs.writeFileSync(corrupt, "esto no es sqlite");

  await assert.rejects(
    restoreDatabase({ backup: corrupt, target, backupDirectory: path.join(directory, "backups"), verifyStopped: false }),
  );
  const db = new Database(target, { readonly: true });
  assert.equal(db.prepare("SELECT valor FROM datos").get().valor, "intacto");
  db.close();
});
