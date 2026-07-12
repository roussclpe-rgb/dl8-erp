const fs = require("fs");
const path = require("path");
const net = require("net");
const crypto = require("crypto");
const Database = require("better-sqlite3");

const BACKUP_LIMIT = 14;

function resolveFile(filePath) {
  if (!filePath) throw new Error("Debes indicar una ruta SQLite explícita.");
  return path.resolve(filePath);
}

function integrityCheck(filePath, { cleanupSidecars = true } = {}) {
  const resolved = resolveFile(filePath);
  if (!fs.existsSync(resolved)) throw new Error(`No existe la base SQLite: ${resolved}`);
  const db = new Database(resolved, { readonly: true, fileMustExist: true });
  try {
    const rows = db.pragma("integrity_check");
    if (rows.length !== 1 || rows[0].integrity_check !== "ok") {
      throw new Error(`La base SQLite no superó integrity_check: ${JSON.stringify(rows)}`);
    }
    return true;
  } finally {
    db.close();
    if (cleanupSidecars) {
      removeIfExists(`${resolved}-wal`);
      removeIfExists(`${resolved}-shm`);
    }
  }
}

function timestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function removeIfExists(filePath) {
  if (fs.existsSync(filePath)) fs.rmSync(filePath, { force: true });
}

function pruneBackups(directory, limit = BACKUP_LIMIT) {
  const files = fs.readdirSync(directory)
    .filter((name) => /^data-\d{4}-\d{2}-\d{2}-\d{6}(?:-pre-restore)?\.sqlite$/.test(name))
    .map((name) => ({ name, path: path.join(directory, name), mtime: fs.statSync(path.join(directory, name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  for (const old of files.slice(limit)) removeIfExists(old.path);
}

async function backupDatabase({ source, backupDirectory, label = "data", keep = BACKUP_LIMIT, now = new Date() }) {
  const sourcePath = resolveFile(source);
  const directory = path.resolve(backupDirectory || path.join(path.dirname(sourcePath), "backups"));
  if (!fs.existsSync(sourcePath)) throw new Error(`No existe la base a respaldar: ${sourcePath}`);
  integrityCheck(sourcePath, { cleanupSidecars: false });
  fs.mkdirSync(directory, { recursive: true });

  const finalPath = path.join(directory, `${label}-${timestamp(now)}.sqlite`);
  const tempPath = `${finalPath}.tmp-${crypto.randomUUID()}`;
  const sourceDb = new Database(sourcePath, { fileMustExist: true });
  try {
    await sourceDb.backup(tempPath);
  } finally {
    sourceDb.close();
  }

  try {
    integrityCheck(tempPath);
    fs.renameSync(tempPath, finalPath);
    integrityCheck(finalPath);
    pruneBackups(directory, keep);
    return finalPath;
  } catch (error) {
    removeIfExists(tempPath);
    throw error;
  }
}

function isPortOpen(port, host = "127.0.0.1", timeoutMs = 500) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host });
    const finish = (open) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

async function requireStopped(ports = [3001, 5173]) {
  const checks = await Promise.all(ports.map(async (port) => ({ port, open: await isPortOpen(port) })));
  const occupied = checks.filter((check) => check.open).map((check) => check.port);
  if (occupied.length) throw new Error(`Detén backend y frontend antes de restaurar. Puertos ocupados: ${occupied.join(", ")}`);
}

async function restoreDatabase({ backup, target, backupDirectory, verifyStopped = true, ports = [3001, 5173] }) {
  const backupPath = resolveFile(backup);
  const targetPath = resolveFile(target);
  if (backupPath === targetPath) throw new Error("El respaldo y la base de destino no pueden ser el mismo archivo.");
  if (verifyStopped) await requireStopped(ports);
  integrityCheck(backupPath);
  if (!fs.existsSync(targetPath)) throw new Error(`No existe la base de destino: ${targetPath}`);
  integrityCheck(targetPath);

  const directory = path.resolve(backupDirectory || path.join(path.dirname(targetPath), "backups"));
  const preRestore = await backupDatabase({ source: targetPath, backupDirectory: directory, label: "data-pre-restore" });
  const staged = `${targetPath}.restore-${crypto.randomUUID()}`;
  const previous = `${targetPath}.previous-${crypto.randomUUID()}`;

  fs.copyFileSync(backupPath, staged, fs.constants.COPYFILE_EXCL);
  integrityCheck(staged);

  try {
    fs.renameSync(targetPath, previous);
    try {
      fs.renameSync(staged, targetPath);
      removeIfExists(`${targetPath}-wal`);
      removeIfExists(`${targetPath}-shm`);
      integrityCheck(targetPath);
      removeIfExists(previous);
      return { restored: targetPath, preRestore };
    } catch (error) {
      removeIfExists(targetPath);
      fs.renameSync(previous, targetPath);
      throw error;
    }
  } finally {
    removeIfExists(staged);
    if (fs.existsSync(previous) && !fs.existsSync(targetPath)) fs.renameSync(previous, targetPath);
  }
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index];
    if (!key?.startsWith("--") || rest[index + 1] == null) throw new Error(`Argumento inválido: ${key || "vacío"}`);
    options[key.slice(2)] = rest[index + 1];
  }
  return { command, options };
}

async function main(argv = process.argv.slice(2)) {
  const { command, options } = parseArgs(argv);
  if (command === "backup") {
    const file = await backupDatabase({ source: options.source, backupDirectory: options.directory });
    console.log(`Respaldo SQLite verificado: ${file}`);
    return;
  }
  if (command === "restore") {
    const result = await restoreDatabase({ backup: options.backup, target: options.target, backupDirectory: options.directory });
    console.log(`Restauración SQLite verificada: ${result.restored}`);
    console.log(`Respaldo previo: ${result.preRestore}`);
    return;
  }
  throw new Error("Uso: node scripts/sqlite-safety.js backup --source <db> --directory <carpeta> | restore --backup <db> --target <db> --directory <carpeta>");
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`ERROR: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { BACKUP_LIMIT, backupDatabase, integrityCheck, isPortOpen, pruneBackups, requireStopped, restoreDatabase };
