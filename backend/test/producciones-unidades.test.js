const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");

process.env.DB_PATH = ":memory:";
process.env.NODE_ENV = "development";
const { db, obtenerOCrearPeriodo } = require("../src/db");
const { generarToken } = require("../src/auth");
const { normalizarCantidadProduccion } = require("../src/services/producciones");

const admin = Number(db.prepare("INSERT INTO usuarios(nombre,email,password_hash,rol_id)VALUES('Producción','produccion-unidades@test','x',1)").run().lastInsertRowid);
const token = generarToken({ id: admin, nombre: "Producción", rol_nombre: "admin" });
const periodo = obtenerOCrearPeriodo("2026-07-01");
let secuencia = 0;

function ingredienteConStock(stock) {
  const id = Number(db.prepare("INSERT INTO ingredientes(nombre,unidad_base)VALUES(?, 'g')").run(`Ingrediente ${++secuencia}`).lastInsertRowid);
  if (stock > 0) db.prepare(`INSERT INTO lotes_compra(ingrediente_id,periodo_id,fecha_compra,cantidad_comprada,unidad_compra,contenido_por_presentacion,cantidad_total_base,cantidad_restante,costo_total,costo_unidad_base,usuario_id)
    VALUES(?,?,'2026-07-01',?,'g',1,?,?,?,1,?)`).run(id, periodo.id, stock, stock, stock, stock, admin);
  return id;
}

function receta({ rendimiento = 10, insumos = [{ stock: 100, cantidad: 2 }] } = {}) {
  const grupo = 8000 + ++secuencia;
  const recetaId = Number(db.prepare("INSERT INTO recetas(grupo_id,nombre_producto,rendimiento,usuario_id)VALUES(?,?,?,?)").run(grupo, `Producto ${grupo}`, rendimiento, admin).lastInsertRowid);
  const ingredientes = insumos.map(({ stock, cantidad }) => {
    const ingredienteId = ingredienteConStock(stock);
    db.prepare("INSERT INTO receta_items(receta_id,ingrediente_id,cantidad_base)VALUES(?,?,?)").run(recetaId, ingredienteId, cantidad);
    return ingredienteId;
  });
  return { recetaId, ingredientes };
}

const app = express();
app.use(express.json());
app.use("/api/producciones", require("../src/routes/producciones"));
let server; let baseUrl;
test.before(async () => { server = await new Promise((resolve) => { const instance = app.listen(0, () => resolve(instance)); }); baseUrl = `http://127.0.0.1:${server.address().port}`; });
test.after(async () => new Promise((resolve) => server.close(resolve)));
const crear = (body) => fetch(`${baseUrl}/api/producciones`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ fecha: "2026-07-01", ...body }) });

test("producción por tandas descuenta insumos y registra unidades correctas", async () => {
  const preparada = receta({ rendimiento: 10, insumos: [{ stock: 20, cantidad: 2 }] });
  const response = await crear({ receta_id: preparada.recetaId, modo: "tandas", tandas: 2 });
  assert.equal(response.status, 201);
  const data = await response.json();
  assert.equal(data.unidadesProducidas, 20);
  const produccion = db.prepare("SELECT tandas,unidades_producidas FROM producciones WHERE id=?").get(data.id);
  assert.deepEqual(produccion, { tandas: 2, unidades_producidas: 20 });
  assert.equal(db.prepare("SELECT cantidad_restante FROM lotes_compra WHERE ingrediente_id=?").get(preparada.ingredientes[0]).cantidad_restante, 16);
});

test("producción por unidades admite tandas fraccionarias y usa rendimiento", async () => {
  const preparada = receta({ rendimiento: 10, insumos: [{ stock: 20, cantidad: 2 }] });
  const response = await crear({ receta_id: preparada.recetaId, modo: "unidades", unidades: 15 });
  assert.equal(response.status, 201);
  const data = await response.json();
  const produccion = db.prepare("SELECT tandas,unidades_producidas FROM producciones WHERE id=?").get(data.id);
  assert.deepEqual(produccion, { tandas: 1.5, unidades_producidas: 15 });
  assert.equal(db.prepare("SELECT cantidad_restante FROM lotes_compra WHERE ingrediente_id=?").get(preparada.ingredientes[0]).cantidad_restante, 17);
});

test("rechaza rendimiento y cantidades inválidas sin producir NaN o infinitos", async () => {
  assert.throws(() => normalizarCantidadProduccion({ modo: "unidades", unidades: 10, rendimiento: 0 }), /rendimiento/);
  assert.throws(() => normalizarCantidadProduccion({ modo: "tandas", tandas: Infinity, rendimiento: 10 }), /tandas/);
  const preparada = receta();
  assert.equal((await crear({ receta_id: preparada.recetaId, modo: "unidades", unidades: 0 })).status, 400);
});

test("stock insuficiente no deja producción ni consumo parcial", async () => {
  const preparada = receta({ rendimiento: 10, insumos: [{ stock: 1, cantidad: 2 }] });
  const produccionesAntes = db.prepare("SELECT COUNT(*) n FROM producciones").get().n;
  const movimientosAntes = db.prepare("SELECT COUNT(*) n FROM movimientos_inventario").get().n;
  const response = await crear({ receta_id: preparada.recetaId, modo: "tandas", tandas: 1 });
  assert.equal(response.status, 409);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM producciones").get().n, produccionesAntes);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM movimientos_inventario").get().n, movimientosAntes);
  assert.equal(db.prepare("SELECT cantidad_restante FROM lotes_compra WHERE ingrediente_id=?").get(preparada.ingredientes[0]).cantidad_restante, 1);
});

test("si falla un insumo posterior, revierte el descuento del primero", async () => {
  const preparada = receta({ rendimiento: 10, insumos: [{ stock: 10, cantidad: 2 }, { stock: 0, cantidad: 1 }] });
  const response = await crear({ receta_id: preparada.recetaId, modo: "unidades", unidades: 10 });
  assert.equal(response.status, 409);
  assert.equal(db.prepare("SELECT cantidad_restante FROM lotes_compra WHERE ingrediente_id=?").get(preparada.ingredientes[0]).cantidad_restante, 10);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM movimientos_inventario WHERE ingrediente_id IN (?,?)").get(...preparada.ingredientes).n, 0);
});
