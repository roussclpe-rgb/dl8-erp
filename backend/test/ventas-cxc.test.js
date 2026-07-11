const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");

process.env.NODE_ENV = "development";
process.env.DB_PATH = ":memory:";
const { db } = require("../src/db");
const { generarToken } = require("../src/auth");
const catalogos = require("../src/services/finanzas/catalogos");

const admin = Number(db.prepare("INSERT INTO usuarios(nombre,email,password_hash,rol_id)VALUES('CxC','cxc@test','x',1)").run().lastInsertRowid);
const sinAcceso = Number(db.prepare("INSERT INTO usuarios(nombre,email,password_hash,rol_id)VALUES('Sin acceso','sin-cxc@test','x',1)").run().lastInsertRowid);
const entidad = catalogos.crearEntidadFundacion({ codigo: "CXC_HTTP", nombre: "CxC HTTP", tipo: "empresa", fechaInicial: "2026-07-01", usuarioId: admin }).entidad;
const clienteId = Number(db.prepare("INSERT INTO clientes(nombre,tipo,usuario_id) VALUES('Cliente CxC','minorista',?)").run(admin).lastInsertRowid);
const grupoId = 9001;
db.prepare("INSERT INTO productos_venta(receta_grupo_id,precio_normal,precio_mayorista,usuario_id) VALUES(?,?,?,?)").run(grupoId, 10.005, 9, admin);
db.prepare("INSERT INTO recetas(grupo_id,version,nombre_producto,rendimiento,vigente,activo,usuario_id) VALUES(?,1,'Pan CxC',1,1,1,?)").run(grupoId, admin);
const recetaId = db.prepare("SELECT id FROM recetas WHERE grupo_id=?").get(grupoId).id;
const periodoId = Number(db.prepare("INSERT INTO periodos(anio,mes,estado) VALUES(2026,7,'abierto')").run().lastInsertRowid);
db.prepare("INSERT INTO producciones(receta_id,periodo_id,tandas,unidades_producidas,costo_materia_prima,costo_mano_obra,costo_indirectos,costo_total,costo_unidad,fecha,usuario_id) VALUES(?,?,1,10,0,0,0,0,0,'2026-07-01',?)").run(recetaId, periodoId, admin);

const app = express();
app.use(express.json());
app.use("/api/ventas", require("../src/routes/ventas.routes.v2"));
let server, baseUrl;
test.before(async () => { server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); }); baseUrl = `http://127.0.0.1:${server.address().port}`; });
test.after(async () => new Promise((resolve) => server.close(resolve)));
const token = (id, nombre) => generarToken({ id, nombre, rol_nombre: "admin" });
const pedir = (body, key, auth = token(admin, "CxC")) => fetch(`${baseUrl}/api/ventas`, { method: "POST", headers: { Authorization: `Bearer ${auth}`, "Content-Type": "application/json", ...(key ? { "Idempotency-Key": key } : {}) }, body: JSON.stringify(body) });
const payload = { entidad_id: entidad.id, cliente_id: clienteId, fecha: "2026-07-01", items: [{ receta_grupo_id: grupoId, cantidad: 1 }], pagos: [] };

test("venta nueva emite una CxC y asiento 1201/4101 sin tesorería", async () => {
  const response = await pedir(payload, "venta-cxc-1");
  assert.equal(response.status, 201);
  const venta = await response.json();
  const documento = db.prepare("SELECT * FROM fin_documentos_cxc WHERE venta_id=?").get(venta.id);
  assert.equal(documento.importe_original_minor, 1001);
  assert.equal(documento.estado, "abierta");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM fin_documentos_cxc WHERE venta_id=?").get(venta.id).n, 1);
  const lineas = db.prepare("SELECT pc.codigo,l.debe_minor,l.haber_minor FROM fin_lineas_asiento l JOIN fin_asientos_contables a ON a.id=l.asiento_id JOIN fin_plan_cuentas pc ON pc.id=l.cuenta_contable_id WHERE a.evento_id=? ORDER BY pc.codigo").all(documento.evento_emision_id);
  assert.deepEqual(lineas, [{ codigo: "1201", debe_minor: 1001, haber_minor: 0 }, { codigo: "4101", debe_minor: 0, haber_minor: 1001 }]);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM fin_movimientos_tesoreria WHERE evento_id=?").get(documento.evento_emision_id).n, 0);
  assert.throws(() => db.prepare(`INSERT INTO fin_documentos_cxc
    (entidad_id,venta_id,cliente_id,tipo_documento,fecha_emision,importe_original_minor,evento_emision_id,creado_por)
    VALUES(?,?,?,'venta','2026-07-01',?,?,?)`).run(entidad.id, venta.id, clienteId, 1001, documento.evento_emision_id, admin), /UNIQUE/);
});

test("idempotencia HTTP no duplica y rechaza payload distinto", async () => {
  const primero = await pedir(payload, "venta-cxc-2");
  const resultado = await primero.json();
  const segundo = await pedir(payload, "venta-cxc-2");
  assert.equal(segundo.status, 201);
  assert.deepEqual(await segundo.json(), resultado);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM ventas WHERE id=?").get(resultado.id).n, 1);
  const conflicto = await pedir({ ...payload, items: [{ receta_grupo_id: grupoId, cantidad: 2 }] }, "venta-cxc-2");
  assert.equal(conflicto.status, 409);
});

test("rechaza entidad inválida, sin acceso y período financiero cerrado; rollback ante fallo", async () => {
  assert.equal((await pedir({ ...payload, entidad_id: 999999 }, "entidad-invalida")).status, 403);
  assert.equal((await pedir(payload, "sin-acceso", token(sinAcceso, "Sin acceso"))).status, 403);
  db.prepare("UPDATE fin_periodos SET estado='cerrado' WHERE entidad_id=?").run(entidad.id);
  assert.equal((await pedir(payload, "periodo-cerrado")).status, 409);
  db.prepare("UPDATE fin_periodos SET estado='abierto' WHERE entidad_id=?").run(entidad.id);
  const antes = db.prepare("SELECT COUNT(*) n FROM ventas").get().n;
  db.exec("CREATE TRIGGER fallo_cxc BEFORE INSERT ON fin_documentos_cxc BEGIN SELECT RAISE(ABORT,'fallo inducido'); END");
  assert.equal((await pedir(payload, "fallo-cxc")).status, 400);
  db.exec("DROP TRIGGER fallo_cxc");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM ventas").get().n, antes);
});
