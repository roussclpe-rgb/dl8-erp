const test = require("node:test");
const assert = require("node:assert/strict");

process.env.DB_PATH = ":memory:";
const { db, obtenerOCrearPeriodo } = require("../src/db");
const catalogos = require("../src/services/finanzas/catalogos");
const { calcularVenta } = require("../src/services/ventas");
const { emitirVenta, corregirFechaVenta } = require("../src/services/finanzas/ventas");

const usuarioId = Number(db.prepare("INSERT INTO usuarios(nombre,email,password_hash,rol_id) VALUES('Corrección','correccion-venta@test','x',1)").run().lastInsertRowid);

test("corrige la fecha de una venta sin cobros, reemplaza la emisión y deja auditoría", () => {
  const entidad = catalogos.crearEntidadFundacion({ codigo: "CORR_VTA", nombre: "Corrección de ventas", tipo: "empresa", fechaInicial: "2026-07-01", usuarioId }).entidad;
  const clienteId = Number(db.prepare("INSERT INTO clientes(nombre,tipo,usuario_id) VALUES('Cliente','minorista',?)").run(usuarioId).lastInsertRowid);
  const grupoId = 7101;
  db.prepare("INSERT INTO productos_venta(receta_grupo_id,precio_normal,precio_mayorista,usuario_id) VALUES(?,?,?,?)").run(grupoId, 10, 9, usuarioId);
  db.prepare("INSERT INTO recetas(grupo_id,version,nombre_producto,rendimiento,vigente,activo,usuario_id) VALUES(?,1,'Pan',1,1,1,?)").run(grupoId, usuarioId);
  const recetaId = db.prepare("SELECT id FROM recetas WHERE grupo_id=?").get(grupoId).id;
  const periodoId = obtenerOCrearPeriodo("2026-07-01").id;
  db.prepare("INSERT INTO producciones(receta_id,periodo_id,tandas,unidades_producidas,costo_materia_prima,costo_mano_obra,costo_indirectos,costo_total,costo_unidad,fecha,usuario_id) VALUES(?,?,1,2,0,0,0,0,0,'2026-07-01',?)").run(recetaId, periodoId, usuarioId);
  const cliente = db.prepare("SELECT * FROM clientes WHERE id=?").get(clienteId);
  const creada = emitirVenta({ entidadId: entidad.id, usuarioId, fecha: "2026-07-01", cliente, periodoId, items: [{ receta_grupo_id: grupoId, cantidad: 1 }], pagos: [], claveIdempotencia: "venta-original", payloadIdempotencia: { prueba: "original" }, calcularVenta });
  const eventoAnterior = db.prepare("SELECT evento_emision_id FROM fin_documentos_cxc WHERE venta_id=?").get(creada.id).evento_emision_id;

  const corregida = corregirFechaVenta({ ventaId: creada.id, fecha: "2026-07-02", periodoId: obtenerOCrearPeriodo("2026-07-02").id, usuarioId, clave: "corregir-fecha" });
  const venta = db.prepare("SELECT fecha FROM ventas WHERE id=?").get(creada.id);
  const documento = db.prepare("SELECT fecha_emision,evento_emision_id FROM fin_documentos_cxc WHERE venta_id=?").get(creada.id);

  assert.equal(venta.fecha, "2026-07-02");
  assert.equal(documento.fecha_emision, "2026-07-02");
  assert.notEqual(documento.evento_emision_id, eventoAnterior);
  assert.equal(corregida.reversion_evento_id, eventoAnterior);
  assert.equal(db.prepare("SELECT reversion_de_id FROM fin_eventos_financieros WHERE reversion_de_id=?").get(eventoAnterior).reversion_de_id, eventoAnterior);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM log_auditoria WHERE entidad='venta' AND entidad_id=? AND accion='corregir_fecha'").get(creada.id).n, 1);
});
