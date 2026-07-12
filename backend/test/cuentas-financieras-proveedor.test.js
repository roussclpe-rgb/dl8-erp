const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");

process.env.DB_PATH = ":memory:";
process.env.NODE_ENV = "development";
const { db } = require("../src/db");
const catalogos = require("../src/services/finanzas/catalogos");
const { cuentaCompatible } = require("../src/services/finanzas/cuentas-financieras");
const { migrarProveedorCuentaFinanciera } = require("../src/migrations/cuentas-financieras-proveedor");

const admin = Number(db.prepare("INSERT INTO usuarios(nombre,email,password_hash,rol_id)VALUES('Proveedor cuenta','proveedor-cuenta@test','x',1)").run().lastInsertRowid);
const entidad = catalogos.crearEntidadFundacion({ codigo: "PROVEEDORES_CF", nombre: "Proveedores CF", tipo: "empresa", fechaInicial: "2026-07-01", usuarioId: admin }).entidad;
const plan = (codigo) => db.prepare("SELECT id FROM fin_plan_cuentas WHERE entidad_id=? AND codigo=?").get(entidad.id, codigo).id;

test("Yape, Plin y banco tienen proveedores explícitos y no se confunden", () => {
  const yape = catalogos.crearCuentaFinanciera({ entidadId: entidad.id, cuentaContableId: plan("1103"), codigo: "YAPE", nombre: "Cobros móvil", tipo: "billetera", proveedor: "yape", usuarioId: admin });
  const plin = catalogos.crearCuentaFinanciera({ entidadId: entidad.id, cuentaContableId: plan("1103"), codigo: "PLIN", nombre: "Cobros móvil", tipo: "billetera", proveedor: "plin", usuarioId: admin });
  const banco = catalogos.crearCuentaFinanciera({ entidadId: entidad.id, cuentaContableId: plan("1102"), codigo: "BANCO", nombre: "Cuenta corriente", tipo: "banco", proveedor: "banco", usuarioId: admin });
  assert.equal(cuentaCompatible(yape, "Yape"), true);
  assert.equal(cuentaCompatible(yape, "Plin"), false);
  assert.equal(cuentaCompatible(plin, "Plin"), true);
  assert.equal(cuentaCompatible(banco, "Yape"), false);
  assert.throws(() => catalogos.actualizarCuentaFinanciera({ entidadId: entidad.id, id: banco.id, cuentaContableId: plan("1102"), codigo: "BANCO", nombre: "Cuenta corriente", tipo: "banco", proveedor: "yape", usuarioId: admin }), /proveedor/);
});

test("la migración antigua es idempotente y no adivina la marca desde el nombre", () => {
  const legacy = new Database(":memory:");
  legacy.exec("CREATE TABLE fin_cuentas_financieras(id INTEGER PRIMARY KEY,tipo TEXT NOT NULL,nombre TEXT NOT NULL); INSERT INTO fin_cuentas_financieras VALUES(1,'billetera','Yape textual'),(2,'banco','Banco')");
  assert.equal(migrarProveedorCuentaFinanciera(legacy), true);
  assert.equal(migrarProveedorCuentaFinanciera(legacy), false);
  assert.deepEqual(legacy.prepare("SELECT id,proveedor FROM fin_cuentas_financieras ORDER BY id").all(), [
    { id: 1, proveedor: "otra_billetera" },
    { id: 2, proveedor: "banco" },
  ]);
  legacy.close();
});
