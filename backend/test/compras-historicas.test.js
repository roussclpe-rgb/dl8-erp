const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");

process.env.NODE_ENV = "development";
process.env.DB_PATH = ":memory:";
const { db } = require("../src/db");
const { generarToken } = require("../src/auth");
const catalogos = require("../src/services/finanzas/catalogos");

const admin = Number(db.prepare("INSERT INTO usuarios(nombre,email,password_hash,rol_id) VALUES('Historicos','historicos@test','x',1)").run().lastInsertRowid);
const entidad = catalogos.crearEntidadFundacion({ codigo: "HIST_CXP", nombre: "Compras historicas", tipo: "empresa", fechaInicial: "2026-07-01", usuarioId: admin }).entidad;
const proveedorUno = Number(db.prepare("INSERT INTO proveedores(nombre) VALUES('Proveedor histórico uno')").run().lastInsertRowid);
const proveedorDos = Number(db.prepare("INSERT INTO proveedores(nombre) VALUES('Proveedor histórico dos')").run().lastInsertRowid);
const ingredienteUno = Number(db.prepare("INSERT INTO ingredientes(nombre,unidad_base) VALUES('Harina histórica','kg')").run().lastInsertRowid);
const ingredienteDos = Number(db.prepare("INSERT INTO ingredientes(nombre,unidad_base) VALUES('Azúcar histórica','kg')").run().lastInsertRowid);
const periodoId = Number(db.prepare("INSERT INTO periodos(anio,mes,estado) VALUES(2026,7,'abierto')").run().lastInsertRowid);

const app = express();
app.use(express.json());
app.use("/api/compras", require("../src/routes/compras"));
let server;
let baseUrl;
test.before(async () => { server = await new Promise((resolve) => { const instance = app.listen(0, () => resolve(instance)); }); baseUrl = `http://127.0.0.1:${server.address().port}`; });
test.after(async () => new Promise((resolve) => server.close(resolve)));
const request = (path, options = {}) => fetch(`${baseUrl}${path}`, { method: options.method || "GET", headers: { Authorization: `Bearer ${generarToken({ id: admin, nombre: "Historicos", rol_nombre: "admin" })}`, "Content-Type": "application/json", ...(options.headers || {}) }, body: options.body });
const crearHistorica = ({ proveedor = proveedorUno, ingrediente = ingredienteUno, fecha = "2026-07-01", costo = 10 } = {}) => Number(db.prepare(`INSERT INTO lotes_compra
  (ingrediente_id,proveedor_id,periodo_id,fecha_compra,cantidad_comprada,unidad_compra,contenido_por_presentacion,cantidad_total_base,cantidad_restante,costo_total,costo_unidad_base,usuario_id)
  VALUES(?,?,?,?,1,'kg',1,1,1,?,?,?)`).run(ingrediente, proveedor, periodoId, fecha, costo, costo, admin).lastInsertRowid);
const crearFinanciera = async () => {
  const response = await request("/api/compras", { method: "POST", headers: { "Idempotency-Key": "financiera-historicos" }, body: JSON.stringify({ entidad_id: entidad.id, proveedor_id: proveedorUno, ingrediente_id: ingredienteUno, fecha_compra: "2026-07-01", cantidad_comprada: 1, unidad_compra: "kg", contenido_por_presentacion: 1, costo_total: 20 }) });
  assert.equal(response.status, 201);
  return response.json();
};

test("API separa compras históricas de financieras y no crea efectos retroactivos", async () => {
  const historicaId = crearHistorica();
  const antes = {
    documentos: db.prepare("SELECT COUNT(*) n FROM fin_documentos_cxp").get().n,
    eventos: db.prepare("SELECT COUNT(*) n FROM fin_eventos_financieros").get().n,
    asientos: db.prepare("SELECT COUNT(*) n FROM fin_asientos_contables").get().n,
    tesoreria: db.prepare("SELECT COUNT(*) n FROM fin_movimientos_tesoreria").get().n,
  };
  const financiera = await crearFinanciera();
  const compras = await (await request("/api/compras")).json();
  assert.ok(compras.some((row) => row.id === financiera.id && row.historico === 0 && row.documento_cxp_id));
  assert.ok(!compras.some((row) => row.id === historicaId));
  const historicas = await (await request("/api/compras/historicas")).json();
  const historica = historicas.find((row) => row.id === historicaId);
  assert.equal(historica.historico, true);
  assert.equal(historica.documento_cxp_id, null);
  assert.equal(historica.saldo_historico_inferible, false);
  assert.match(historica.advertencia_saldo_historico, /no se puede inferir/i);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM fin_documentos_cxp WHERE lote_compra_id=?").get(historicaId).n, 0);
  assert.deepEqual({
    documentos: db.prepare("SELECT COUNT(*) n FROM fin_documentos_cxp").get().n - 1,
    eventos: db.prepare("SELECT COUNT(*) n FROM fin_eventos_financieros WHERE tipo='emision_compra'").get().n - 1,
    asientos: db.prepare("SELECT COUNT(*) n FROM fin_asientos_contables").get().n - 1,
    tesoreria: db.prepare("SELECT COUNT(*) n FROM fin_movimientos_tesoreria").get().n,
  }, { documentos: antes.documentos, eventos: 0, asientos: antes.asientos, tesoreria: antes.tesoreria });
  assert.equal(db.prepare("SELECT COUNT(*) n FROM fin_lineas_asiento l JOIN fin_plan_cuentas p ON p.id=l.cuenta_contable_id WHERE p.codigo='2199'").get().n, 0);
});

test("históricos filtran por proveedor, fecha e ingrediente y solo ellos conservan edición legacy", async () => {
  const uno = crearHistorica({ proveedor: proveedorUno, ingrediente: ingredienteUno, fecha: "2026-07-02", costo: 5 });
  crearHistorica({ proveedor: proveedorDos, ingrediente: ingredienteDos, fecha: "2026-07-03", costo: 6 });
  const filtradas = await (await request(`/api/compras/historicas?proveedor_id=${proveedorUno}&ingrediente_id=${ingredienteUno}&fecha_desde=2026-07-02&fecha_hasta=2026-07-02`)).json();
  assert.deepEqual(filtradas.map((row) => row.id), [uno]);
  assert.equal((await request("/api/compras/historicas?fecha_desde=invalida")).status, 400);
  const antesFinanzas = db.prepare("SELECT COUNT(*) n FROM fin_eventos_financieros").get().n;
  const editarLegacy = await request(`/api/compras/${uno}`, { method: "PUT", body: JSON.stringify({ fecha_compra: "2026-07-02", cantidad_comprada: 1, unidad_compra: "kg", contenido_por_presentacion: 1, costo_total: 7 }) });
  assert.equal(editarLegacy.status, 200);
  assert.equal(db.prepare("SELECT costo_total FROM lotes_compra WHERE id=?").get(uno).costo_total, 7);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM fin_documentos_cxp WHERE lote_compra_id=?").get(uno).n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM fin_eventos_financieros").get().n, antesFinanzas);
  const financiera = db.prepare("SELECT lote_compra_id FROM fin_documentos_cxp LIMIT 1").get();
  assert.equal((await request(`/api/compras/${financiera.lote_compra_id}`, { method: "PUT", body: JSON.stringify({ costo_total: 99 }) })).status, 409);
});
