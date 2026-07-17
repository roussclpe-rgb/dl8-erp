const test = require("node:test");
const assert = require("node:assert/strict");

process.env.DB_PATH = ":memory:";
const { db } = require("../src/db");
const catalogos = require("../src/services/finanzas/catalogos");
const { crearSaldoInicialCxC, editarSaldoInicialCxC } = require("../src/services/finanzas/saldos-iniciales-cxc");

const usuarioId = Number(db.prepare("INSERT INTO usuarios(nombre,email,password_hash,rol_id) VALUES('Edición CxC','edicion-cxc@test','x',1)").run().lastInsertRowid);

function entidad(codigo) {
  return catalogos.crearEntidadFundacion({ codigo, nombre: codigo, tipo: "empresa", fechaInicial: "2026-07-01", usuarioId }).entidad;
}

test("edita un saldo inicial sin cobros, reemplaza su emisión y deja auditoría", () => {
  const empresa = entidad("EDCXC1");
  const creado = crearSaldoInicialCxC({ entidadId: empresa.id, clienteNombre: "Cliente anterior", monto: 120, fecha: "2026-07-01", descripcion: "Original", usuarioId, clave: "crear-edicion" });
  const anterior = db.prepare("SELECT evento_emision_id,cliente_id,importe_original_minor FROM fin_documentos_cxc WHERE id=?").get(creado.documento_cxc_id);
  const editado = editarSaldoInicialCxC({ entidadId: empresa.id, ventaId: creado.venta_id, clienteNombre: "Cliente actualizado", monto: 180.5, fecha: "2026-07-02", descripcion: "Corregido", usuarioId, clave: "editar-edicion" });
  const documento = db.prepare("SELECT * FROM fin_documentos_cxc WHERE id=?").get(creado.documento_cxc_id);
  assert.equal(documento.importe_original_minor, 18050);
  assert.equal(documento.fecha_emision, "2026-07-02");
  assert.notEqual(documento.evento_emision_id, anterior.evento_emision_id);
  assert.equal(db.prepare("SELECT reversion_de_id FROM fin_eventos_financieros WHERE reversion_de_id=?").get(anterior.evento_emision_id).reversion_de_id, anterior.evento_emision_id);
  assert.equal(db.prepare("SELECT nombre FROM clientes WHERE id=?").get(documento.cliente_id).nombre, "Cliente actualizado");
  assert.equal(editado.saldo, 180.5);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM fin_auditoria WHERE entidad_tabla='fin_documentos_cxc' AND entidad_registro_id=? AND accion='actualizar'").get(documento.id).n, 1);
});

test("no permite editar una venta normal como saldo inicial", () => {
  const empresa = entidad("EDCXC2");
  assert.throws(() => editarSaldoInicialCxC({ entidadId: empresa.id, ventaId: 99999, clienteNombre: "No aplica", monto: 10, fecha: "2026-07-01", usuarioId, clave: "editar-normal" }), /Solo se pueden editar/);
});
