const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
process.env.DB_PATH = ":memory:";
process.env.NODE_ENV = "development";
const { db, obtenerOCrearPeriodo } = require("../src/db");
const { generarToken } = require("../src/auth");
const catalogos = require("../src/services/finanzas/catalogos");
const politicas = require("../src/services/finanzas/politicas");

const admin = Number(db.prepare("INSERT INTO usuarios(nombre,email,password_hash,rol_id) VALUES('Objetivos','objetivos@test','x',1)").run().lastInsertRowid);
const token = generarToken({ id: admin, nombre: "Objetivos", rol_nombre: "admin" });
const app = express(); app.use(express.json()); app.use("/api/objetivos-negocio", require("../src/routes/objetivos-negocio")); app.use((err, req, res, next) => res.status(err.status || 500).json({ error: err.message }));
let server, baseUrl;
test.before(async () => { server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); }); baseUrl = `http://127.0.0.1:${server.address().port}`; });
test.after(async () => new Promise((resolve) => server.close(resolve)));
const request = (path, options = {}) => fetch(`${baseUrl}/api/objetivos-negocio${path}`, { ...options, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...options.headers } });

test("crea objetivos, calcula facturación, unidades y utilidad bruta sin usar finanzas", async () => {
  const periodo = obtenerOCrearPeriodo("2026-07-10");
  const cliente = Number(db.prepare("INSERT INTO clientes(nombre,usuario_id) VALUES('Cliente objetivo',?)").run(admin).lastInsertRowid);
  const receta = Number(db.prepare("INSERT INTO recetas(grupo_id,nombre_producto,rendimiento,usuario_id) VALUES(101,'Pan',4,?)").run(admin).lastInsertRowid);
  const venta = Number(db.prepare("INSERT INTO ventas(folio,fecha,cliente_id,periodo_id,subtotal,total,usuario_id) VALUES(9001,'2026-07-10',?,?,?,?,?)").run(cliente, periodo.id, 100, 100, admin).lastInsertRowid);
  const item = Number(db.prepare("INSERT INTO venta_items(venta_id,receta_grupo_id,nombre_producto,cantidad,precio_unitario,subtotal) VALUES(?,?,?,?,?,?)").run(venta, 1, "Pan", 4, 25, 100).lastInsertRowid);
  db.prepare("INSERT INTO producciones(receta_id,periodo_id,tandas,unidades_producidas,costo_materia_prima,costo_mano_obra,costo_indirectos,costo_total,costo_unidad,fecha,usuario_id) VALUES(?, ?,1,4,0,0,0,0,0,'2026-07-10',?)").run(receta, periodo.id, admin);
  const produccion = db.prepare("SELECT id FROM producciones ORDER BY id DESC").get().id;
  db.prepare("INSERT INTO venta_item_costos(venta_item_id,produccion_id,cantidad,costo_unidad) VALUES(?,?,4,10)").run(item, produccion);
  for (const [tipo, esperado] of [["facturacion", 100], ["unidades_vendidas", 4], ["utilidad_bruta", 60]]) {
    const r = await request("/", { method: "POST", body: JSON.stringify({ nombre: `Meta ${tipo}`, tipo, valor_objetivo: esperado + 100, fecha_inicio: "2026-07-01", fecha_fin: "2026-07-31", observaciones: "Seguimiento comercial" }) });
    assert.equal(r.status, 201); assert.equal((await r.json()).avance_actual, esperado);
  }
});

test("valida fechas, valores y permite cancelar un objetivo", async () => {
  let r = await request("/", { method: "POST", body: JSON.stringify({ nombre: "x", tipo: "otro", valor_objetivo: 0, fecha_inicio: "2026-08-02", fecha_fin: "2026-08-01" }) });
  assert.equal(r.status, 400);
  r = await request("/", { method: "POST", body: JSON.stringify({ nombre: "Ventas semanales", tipo: "facturacion", valor_objetivo: 500, fecha_inicio: "2026-08-01", fecha_fin: "2026-08-31" }) });
  const creado = await r.json();
  r = await request(`/${creado.id}/estado`, { method: "PATCH", body: JSON.stringify({ estado: "cancelado" }) });
  assert.equal(r.status, 200); assert.equal((await r.json()).estado, "cancelado");
});

test("proyecta el cierre por ritmo real, filtra por producto o vendedor y solo simula una política", async () => {
  const objetivo = await request("/", { method: "POST", body: JSON.stringify({ nombre: "Pan por vendedor", tipo: "unidades_vendidas", valor_objetivo: 20, fecha_inicio: "2026-07-01", fecha_fin: "2026-07-31", producto_id: 1, vendedor_id: admin }) });
  const datos = await objetivo.json();
  assert.equal(datos.avance_actual, 4);
  assert.ok(datos.ritmo_diario > 0);
  assert.ok(datos.proyeccion_cierre > datos.avance_actual);
  const opciones = await request("/opciones");
  assert.equal((await opciones.json()).productos.some((x) => x.id === 1), true);

  const entidad = catalogos.crearEntidadFundacion({ codigo: "OBJ", nombre: "Entidad objetivos", tipo: "empresa", fechaInicial: "2026-07-01", usuarioId: admin }).entidad;
  const bolsillo = catalogos.crearBolsillo({ entidadId: entidad.id, codigo: "MKT", nombre: "Marketing", tipo: "operacion", usuarioId: admin });
  politicas.crear({ entidadId: entidad.id, nombre: "Distribución comercial", usuarioId: admin, activar: true, predeterminada: true, reglas: [{ nombre: "Marketing", base: "ingreso", tipo: "porcentaje", valor_minor: 10000, bolsillo_id: bolsillo.id }] });
  const facturacion = await request("/", { method: "POST", body: JSON.stringify({ nombre: "Facturación proyectada", tipo: "facturacion", valor_objetivo: 1000, fecha_inicio: "2026-07-01", fecha_fin: "2026-07-31", entidad_id: entidad.id }) });
  const creada = await facturacion.json();
  const simulacion = await request(`/${creada.id}/simulacion-politica`);
  const resultado = await simulacion.json();
  assert.equal(resultado.disponible, true);
  assert.equal(resultado.solo_simulacion, true);
  assert.equal(resultado.distribucion[0].nombre, "Marketing");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM fin_eventos_financieros WHERE entidad_id=?").get(entidad.id).n, 0);
  const simulador = await request(`/${creada.id}/simulador`, { method: "POST", body: JSON.stringify({ valor_objetivo: 1500 }) });
  const simuladorData = await simulador.json();
  assert.equal(simuladorData.valor_objetivo, 1500);
  assert.equal(simuladorData.impacto_financiero.solo_simulacion, true);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM fin_eventos_financieros WHERE entidad_id=?").get(entidad.id).n, 0);
  const dashboard = await request("/dashboard");
  const tablero = await dashboard.json();
  assert.ok(tablero.resumen.activos >= 1);
  assert.ok(Array.isArray(tablero.tendencia));

  const sinPolitica = catalogos.crearEntidadFundacion({ codigo: "NOP", nombre: "Sin política", tipo: "empresa", fechaInicial: "2026-07-01", usuarioId: admin }).entidad;
  const sinConfiguracion = await request("/", { method: "POST", body: JSON.stringify({ nombre: "Sin configuración", tipo: "facturacion", valor_objetivo: 500, fecha_inicio: "2026-07-01", fecha_fin: "2026-07-31", entidad_id: sinPolitica.id }) });
  const respuestaSinPolitica = await request(`/${(await sinConfiguracion.json()).id}/simulacion-politica`);
  const sinResultado = await respuestaSinPolitica.json();
  assert.equal(sinResultado.disponible, false);
  assert.match(sinResultado.mensaje, /No hay una política financiera activa/);
});
