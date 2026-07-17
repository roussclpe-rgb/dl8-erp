const test = require("node:test");
const assert = require("node:assert/strict");

process.env.DB_PATH = ":memory:";
const { db, obtenerOCrearPeriodo } = require("../src/db");
const { analizarFactibilidadProduccion, crearListaCompraFaltantes } = require("../src/services/factibilidad-produccion");

const usuarioId = Number(db.prepare("INSERT INTO usuarios(nombre,email,password_hash,rol_id) VALUES('Factibilidad','factibilidad@test','x',1)").run().lastInsertRowid);
const periodoId = obtenerOCrearPeriodo("2026-07-01").id;
let secuencia = 0;

function ingrediente(nombre, stock, unidad = "g") {
  const id = Number(db.prepare("INSERT INTO ingredientes(nombre,unidad_base) VALUES(?,?)").run(`${nombre} ${++secuencia}`, unidad).lastInsertRowid);
  if (stock) db.prepare(`INSERT INTO lotes_compra(ingrediente_id,periodo_id,fecha_compra,cantidad_comprada,unidad_compra,contenido_por_presentacion,cantidad_total_base,cantidad_restante,costo_total,costo_unidad_base,usuario_id)
    VALUES(?,?,'2026-07-01',?,'g',1,?,?,?,1,?)`).run(id, periodoId, stock, stock, stock, stock, usuarioId);
  return id;
}

function receta(nombre, rendimiento, items) {
  const id = Number(db.prepare("INSERT INTO recetas(grupo_id,nombre_producto,rendimiento,usuario_id) VALUES(?,?,?,?)").run(9000 + ++secuencia, nombre, rendimiento, usuarioId).lastInsertRowid);
  for (const [ingredienteId, cantidad] of items) db.prepare("INSERT INTO receta_items(receta_id,ingrediente_id,cantidad_base) VALUES(?,?,?)").run(id, ingredienteId, cantidad);
  return id;
}

test("analiza tandas posibles, limitante y faltantes en unidades base FIFO", () => {
  const harina = ingrediente("Harina", 25);
  const levadura = ingrediente("Levadura", 1);
  const recetaId = receta("Pan factible", 12, [[harina, 10], [levadura, 2]]);
  const fila = analizarFactibilidadProduccion().find((item) => item.receta_id === recetaId);
  assert.equal(fila.tandas_posibles, 0);
  assert.equal(fila.unidades_posibles, 0);
  assert.equal(fila.estado, "stock_insuficiente");
  assert.equal(fila.ingrediente_limitante.ingrediente_id, levadura);
  assert.deepEqual(fila.faltantes, [{ ingrediente_id: levadura, nombre: fila.faltantes[0].nombre, unidad_base: "g", cantidad_base: 1 }]);
});

test("genera una lista agregada para una tanda de cada receta insuficiente", () => {
  const azucar = ingrediente("Azúcar", 3);
  const recetaA = receta("Galletas A", 10, [[azucar, 5]]);
  const recetaB = receta("Galletas B", 8, [[azucar, 4]]);
  const lista = crearListaCompraFaltantes({ usuarioId });
  const item = lista.items.find((actual) => actual.ingrediente_id === azucar);
  assert.equal(lista.recetas_insuficientes >= 2, true);
  assert.equal(item.cantidad_base, 6);
  assert.equal(db.prepare("SELECT cantidad_base FROM lista_compra_produccion_items WHERE lista_id=? AND ingrediente_id=?").get(lista.id, azucar).cantidad_base, 6);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM log_auditoria WHERE entidad='lista_compra_produccion' AND entidad_id=?").get(lista.id).n, 1);
  assert.ok(analizarFactibilidadProduccion().some((actual) => actual.receta_id === recetaA));
  assert.ok(analizarFactibilidadProduccion().some((actual) => actual.receta_id === recetaB));
});
