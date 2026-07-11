const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");

process.env.NODE_ENV = "development";
process.env.DB_PATH = ":memory:";
const { db } = require("../src/db");
const { generarToken } = require("../src/auth");
const catalogos = require("../src/services/finanzas/catalogos");

const admin = Number(db.prepare("INSERT INTO usuarios(nombre,email,password_hash,rol_id) VALUES('Notas CxP','notas-cxp@test','x',1)").run().lastInsertRowid);
const entidad = catalogos.crearEntidadFundacion({ codigo: "NOTAS_CXP", nombre: "Notas credito CxP", tipo: "empresa", fechaInicial: "2026-07-01", usuarioId: admin }).entidad;
const proveedorId = Number(db.prepare("INSERT INTO proveedores(nombre) VALUES('Proveedor notas')").run().lastInsertRowid);
const proveedorIncorrectoId = Number(db.prepare("INSERT INTO proveedores(nombre) VALUES('Proveedor incorrecto')").run().lastInsertRowid);
const ingredienteId = Number(db.prepare("INSERT INTO ingredientes(nombre,unidad_base) VALUES('Ingrediente notas','kg')").run().lastInsertRowid);

const app = express();
app.use(express.json());
app.use("/api/compras", require("../src/routes/compras"));
let server;
let baseUrl;
test.before(async () => {
  server = await new Promise((resolve) => { const instance = app.listen(0, () => resolve(instance)); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => new Promise((resolve) => server.close(resolve)));

const post = (path, body = {}, key) => fetch(`${baseUrl}${path}`, {
  method: "POST",
  headers: { Authorization: `Bearer ${generarToken({ id: admin, nombre: "Notas CxP", rol_nombre: "admin" })}`, "Content-Type": "application/json", ...(key ? { "Idempotency-Key": key } : {}) },
  body: JSON.stringify(body),
});
let secuencia = 0;
async function compra(total = 100, cantidad = 10) {
  const response = await post("/api/compras", {
    entidad_id: entidad.id, proveedor_id: proveedorId, ingrediente_id: ingredienteId, fecha_compra: "2026-07-01",
    cantidad_comprada: cantidad, unidad_compra: "kg", contenido_por_presentacion: 1, costo_total: total,
  }, `nota-compra-${++secuencia}`);
  assert.equal(response.status, 201);
  return response.json();
}
function cuerpoNota(documentoId, cantidadBase, importe, extras = {}) {
  return { entidad_id: entidad.id, proveedor_id: proveedorId, cantidad_base: cantidadBase, importe, fecha: "2026-07-01", ...extras };
}
async function nota(documentoId, cantidadBase, importe, key, extras = {}) {
  return post(`/api/compras/documentos-cxp/${documentoId}/notas-credito`, cuerpoNota(documentoId, cantidadBase, importe, extras), key);
}

test("devolucion parcial crea documento correctivo independiente, asiento, inventario y CxP parcial", async () => {
  const compraNueva = await compra();
  const response = await nota(compraNueva.documento_cxp_id, 4, 40, "nota-parcial");
  assert.equal(response.status, 201);
  const resultado = await response.json();
  assert.deepEqual(Object.assign({}, resultado), { nota_credito_id: resultado.nota_credito_id, evento_financiero_id: resultado.evento_financiero_id, saldo_minor: 6000, saldo: 60, estado_cxp: "parcial" });
  const notaDb = db.prepare("SELECT * FROM fin_notas_credito_cxp WHERE id=?").get(resultado.nota_credito_id);
  assert.equal(notaDb.documento_cxp_id, compraNueva.documento_cxp_id);
  assert.equal(notaDb.entidad_id, entidad.id);
  assert.equal(notaDb.cantidad_base, 4);
  assert.equal(notaDb.importe_minor, 4000);
  assert.deepEqual(db.prepare("SELECT tipo,reversion_de_id FROM fin_eventos_financieros WHERE id=?").get(resultado.evento_financiero_id), { tipo: "nota_credito_compra", reversion_de_id: null });
  assert.deepEqual(db.prepare(`SELECT pc.codigo,l.debe_minor,l.haber_minor FROM fin_lineas_asiento l
    JOIN fin_asientos_contables a ON a.id=l.asiento_id JOIN fin_plan_cuentas pc ON pc.id=l.cuenta_contable_id
    WHERE a.evento_id=? ORDER BY pc.codigo`).all(resultado.evento_financiero_id), [
    { codigo: "1301", debe_minor: 0, haber_minor: 4000 }, { codigo: "2101", debe_minor: 4000, haber_minor: 0 },
  ]);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM fin_movimientos_tesoreria WHERE evento_id=?").get(resultado.evento_financiero_id).n, 0);
  assert.deepEqual(db.prepare("SELECT cantidad_base,costo_unidad_base,referencia_tipo,referencia_id FROM movimientos_inventario WHERE referencia_tipo='nota_credito_cxp' AND referencia_id=?").get(resultado.nota_credito_id), { cantidad_base: -4, costo_unidad_base: 10, referencia_tipo: "nota_credito_cxp", referencia_id: resultado.nota_credito_id });
  assert.equal(db.prepare("SELECT cantidad_restante FROM lotes_compra WHERE id=?").get(notaDb.lote_compra_id).cantidad_restante, 6);
  assert.equal(db.prepare("SELECT estado FROM fin_documentos_cxp WHERE id=?").get(compraNueva.documento_cxp_id).estado, "parcial");
});

test("devolucion total agota inventario y saldo CxP; una segunda devolucion queda bloqueada", async () => {
  const compraNueva = await compra(50, 5);
  const primera = await nota(compraNueva.documento_cxp_id, 5, 50, "nota-total");
  assert.equal(primera.status, 201);
  assert.equal((await primera.json()).estado_cxp, "pagada");
  assert.equal(db.prepare("SELECT cantidad_restante FROM lotes_compra WHERE id=?").get(compraNueva.id).cantidad_restante, 0);
  assert.equal(db.prepare("SELECT estado FROM fin_documentos_cxp WHERE id=?").get(compraNueva.documento_cxp_id).estado, "pagada");
  assert.equal((await nota(compraNueva.documento_cxp_id, 1, 1, "nota-doble")).status, 409);
});

test("rechaza excesos de inventario y saldo, documento inexistente, proveedor y entidad incorrectos", async () => {
  const compraNueva = await compra();
  assert.equal((await nota(compraNueva.documento_cxp_id, 11, 10, "nota-exceso-inventario")).status, 409);
  assert.equal((await nota(compraNueva.documento_cxp_id, 1, 101, "nota-exceso-saldo")).status, 409);
  assert.equal((await nota(999999, 1, 1, "nota-inexistente")).status, 404);
  assert.equal((await nota(compraNueva.documento_cxp_id, 1, 1, "nota-proveedor", { proveedor_id: proveedorIncorrectoId })).status, 409);
  assert.equal((await nota(compraNueva.documento_cxp_id, 1, 1, "nota-entidad", { entidad_id: entidad.id + 999 })).status, 409);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM fin_notas_credito_cxp WHERE documento_cxp_id=?").get(compraNueva.documento_cxp_id).n, 0);
});

test("idempotencia devuelve la misma nota y rollback deja intactos evento, nota, CxP e inventario", async () => {
  const compraIdempotente = await compra();
  const primero = await nota(compraIdempotente.documento_cxp_id, 2, 20, "nota-idempotente");
  const resultado = await primero.json();
  const segundo = await nota(compraIdempotente.documento_cxp_id, 2, 20, "nota-idempotente");
  assert.equal(primero.status, 201);
  assert.equal(segundo.status, 201);
  assert.deepEqual(await segundo.json(), resultado);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM fin_notas_credito_cxp WHERE documento_cxp_id=?").get(compraIdempotente.documento_cxp_id).n, 1);
  assert.equal((await nota(compraIdempotente.documento_cxp_id, 3, 30, "nota-idempotente")).status, 409);

  const compraFallo = await compra();
  const antesEventos = db.prepare("SELECT COUNT(*) n FROM fin_eventos_financieros WHERE tipo='nota_credito_compra'").get().n;
  db.exec("CREATE TRIGGER fallo_movimiento_nota BEFORE INSERT ON movimientos_inventario WHEN NEW.referencia_tipo='nota_credito_cxp' BEGIN SELECT RAISE(ABORT,'fallo inducido'); END");
  assert.equal((await nota(compraFallo.documento_cxp_id, 2, 20, "nota-rollback")).status, 400);
  db.exec("DROP TRIGGER fallo_movimiento_nota");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM fin_notas_credito_cxp WHERE documento_cxp_id=?").get(compraFallo.documento_cxp_id).n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM fin_eventos_financieros WHERE tipo='nota_credito_compra'").get().n, antesEventos);
  assert.equal(db.prepare("SELECT cantidad_restante FROM lotes_compra WHERE id=?").get(compraFallo.id).cantidad_restante, 10);
  assert.equal(db.prepare("SELECT estado FROM fin_documentos_cxp WHERE id=?").get(compraFallo.documento_cxp_id).estado, "abierta");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM correcciones_cxp_claves_idempotencia WHERE clave='nota-rollback'").get().n, 0);
});

test("restricciones SQL preservan vinculos, limites e inmutabilidad de la nota", async () => {
  const compraNueva = await compra();
  const resultado = await (await nota(compraNueva.documento_cxp_id, 2, 20, "nota-sql")).json();
  const notaDb = db.prepare("SELECT * FROM fin_notas_credito_cxp WHERE id=?").get(resultado.nota_credito_id);
  assert.throws(() => db.prepare("UPDATE fin_notas_credito_cxp SET importe_minor=1 WHERE id=?").run(notaDb.id), /inmutables/);
  assert.throws(() => db.prepare("DELETE FROM fin_notas_credito_cxp WHERE id=?").run(notaDb.id), /no se eliminan/);
  assert.throws(() => db.prepare(`INSERT INTO fin_notas_credito_cxp
    (documento_cxp_id,entidad_id,lote_compra_id,evento_financiero_id,cantidad_base,importe_minor,fecha,creado_por)
    VALUES(?,?,?,?,?,?,?,?)`).run(compraNueva.documento_cxp_id, entidad.id + 1, notaDb.lote_compra_id, resultado.evento_financiero_id, 1, 1, "2026-07-01", admin), /no coincide|no debita/);
});
