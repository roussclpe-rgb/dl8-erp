const { db, obtenerOCrearPeriodo } = require("../../db");
const catalogos = require("./catalogos");
const motor = require("./motor");
const { aMinorPEN } = require("./montos");
const fallo = (message, status = 400) => Object.assign(new Error(message), { status });

const crearSaldoInicialCxC = db.transaction(({ entidadId, clienteNombre, monto, fecha, descripcion, usuarioId, clave }) => {
  catalogos.exigirAcceso(entidadId, usuarioId, ["finanzas_admin", "finanzas_personal_propietario"]);
  const importeMinor = aMinorPEN(monto);
  if (!clienteNombre?.trim() || importeMinor <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(fecha || "")) throw fallo("Cliente, fecha y monto válido son obligatorios");
  const [anio, mes] = fecha.slice(0, 7).split("-").map(Number);
  if (!db.prepare("SELECT 1 FROM fin_periodos WHERE entidad_id=? AND anio=? AND mes=? AND estado='abierto'").get(entidadId, anio, mes)) throw fallo("El período financiero no está abierto", 409);
  let cliente = db.prepare("SELECT * FROM clientes WHERE lower(nombre)=lower(?) AND activo=1").get(clienteNombre.trim());
  if (!cliente) { const id = Number(db.prepare("INSERT INTO clientes(nombre,tipo,usuario_id) VALUES(?,?,?)").run(clienteNombre.trim(), "minorista", usuarioId).lastInsertRowid); cliente = db.prepare("SELECT * FROM clientes WHERE id=?").get(id); }
  const periodo = obtenerOCrearPeriodo(fecha);
  const folio = db.prepare("SELECT COALESCE(MAX(folio),0)+1 folio FROM ventas").get().folio;
  const ventaId = Number(db.prepare("INSERT INTO ventas(folio,fecha,cliente_id,periodo_id,subtotal,total,usuario_id,es_saldo_inicial) VALUES(?,?,?,?,?,?,?,1)").run(folio, fecha, cliente.id, periodo.id, 0, 0, usuarioId).lastInsertRowid);
  const cuenta = (codigo) => { const r = db.prepare("SELECT id FROM fin_plan_cuentas WHERE entidad_id=? AND codigo=? AND estado='activa'").get(entidadId, codigo); if (!r) throw fallo("Falta configurar el plan de cuentas", 409); return r.id; };
  const evento = motor.ejecutar({ entidadId, tipo: "saldo_inicial", fecha, descripcion: descripcion?.trim() || `Saldo inicial por cobrar: ${cliente.nombre}`, usuarioId, clave, payload: { entidadId, clienteId: cliente.id, importeMinor, fecha }, lineas: [{ cuenta_contable_id: cuenta("1201"), debe_minor: importeMinor, haber_minor: 0 }, { cuenta_contable_id: cuenta("3901"), debe_minor: 0, haber_minor: importeMinor }] });
  const documentoId = Number(db.prepare("INSERT INTO fin_documentos_cxc(entidad_id,venta_id,cliente_id,tipo_documento,fecha_emision,moneda,importe_original_minor,estado,evento_emision_id,creado_por) VALUES(?,?,?,'venta',?,'PEN',?,'abierta',?,?)").run(entidadId, ventaId, cliente.id, fecha, importeMinor, evento.id, usuarioId).lastInsertRowid);
  return { venta_id: ventaId, documento_cxc_id: documentoId, cliente: cliente.nombre, saldo: importeMinor / 100 };
});

const editarSaldoInicialCxC = db.transaction(({ entidadId, ventaId, clienteNombre, monto, fecha, descripcion, usuarioId, clave }) => {
  catalogos.exigirAcceso(entidadId, usuarioId, ["finanzas_admin", "finanzas_personal_propietario"]);
  const importeMinor = aMinorPEN(monto);
  if (!clienteNombre?.trim() || importeMinor <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(fecha || "")) throw fallo("Cliente, fecha y monto válido son obligatorios");
  const registro = db.prepare(`SELECT v.*, d.id documento_id, d.entidad_id, d.cliente_id documento_cliente_id, d.fecha_emision, d.importe_original_minor, d.evento_emision_id, d.estado
    FROM ventas v JOIN fin_documentos_cxc d ON d.venta_id=v.id WHERE v.id=? AND d.entidad_id=? AND v.es_saldo_inicial=1 AND v.anulado=0`).get(ventaId, entidadId);
  if (!registro) throw fallo("Solo se pueden editar saldos iniciales por cobrar de esta entidad", 404);
  if (db.prepare("SELECT 1 FROM fin_aplicaciones_cxc WHERE documento_cxc_id=? AND estado='confirmada' LIMIT 1").get(registro.documento_id)) throw fallo("No se puede editar este saldo inicial porque ya tiene cobros aplicados. Primero revierte los cobros.", 409);
  const [anio, mes] = fecha.slice(0, 7).split("-").map(Number);
  if (!db.prepare("SELECT 1 FROM fin_periodos WHERE entidad_id=? AND anio=? AND mes=? AND estado='abierto'").get(entidadId, anio, mes)) throw fallo("El período financiero no está abierto", 409);
  const periodo = obtenerOCrearPeriodo(fecha);
  const eventoAnterior = db.prepare("SELECT * FROM fin_eventos_financieros WHERE id=? AND entidad_id=? AND tipo='saldo_inicial'").get(registro.evento_emision_id, entidadId);
  if (!eventoAnterior) throw fallo("El evento financiero del saldo inicial no es válido", 409);
  let cliente = db.prepare("SELECT * FROM clientes WHERE lower(nombre)=lower(?) AND activo=1").get(clienteNombre.trim());
  if (!cliente) { const id = Number(db.prepare("INSERT INTO clientes(nombre,tipo,usuario_id) VALUES(?,?,?)").run(clienteNombre.trim(), "minorista", usuarioId).lastInsertRowid); cliente = db.prepare("SELECT * FROM clientes WHERE id=?").get(id); }
  const cuenta = db.prepare("SELECT id FROM fin_plan_cuentas WHERE entidad_id=? AND codigo=? AND estado='activa'");
  const cuentaCxC = cuenta.get(entidadId, "1201"); const cuentaSaldoInicial = cuenta.get(entidadId, "3901");
  if (!cuentaCxC || !cuentaSaldoInicial) throw fallo("Falta configurar el plan de cuentas", 409);
  const antes = { venta: registro, documento: db.prepare("SELECT * FROM fin_documentos_cxc WHERE id=?").get(registro.documento_id), evento: eventoAnterior };
  motor.revertir({ entidadId, eventoId: eventoAnterior.id, usuarioId, clave: `${clave}:reversion`, permitirVinculado: true });
  const evento = motor.ejecutar({ entidadId, tipo: "saldo_inicial", fecha, descripcion: descripcion?.trim() || `Saldo inicial por cobrar: ${cliente.nombre}`, usuarioId, clave: `${clave}:emision`, payload: { entidadId, ventaId: Number(ventaId), clienteId: cliente.id, importeMinor, fecha, edicionDe: eventoAnterior.id }, lineas: [{ cuenta_contable_id: cuentaCxC.id, debe_minor: importeMinor, haber_minor: 0 }, { cuenta_contable_id: cuentaSaldoInicial.id, debe_minor: 0, haber_minor: importeMinor }] });
  db.prepare("UPDATE ventas SET cliente_id=?, fecha=?, periodo_id=? WHERE id=?").run(cliente.id, fecha, periodo.id, ventaId);
  db.prepare("UPDATE fin_documentos_cxc SET cliente_id=?, fecha_emision=?, importe_original_minor=?, estado='abierta', evento_emision_id=? WHERE id=?").run(cliente.id, fecha, importeMinor, evento.id, registro.documento_id);
  const despues = { venta: db.prepare("SELECT * FROM ventas WHERE id=?").get(ventaId), documento: db.prepare("SELECT * FROM fin_documentos_cxc WHERE id=?").get(registro.documento_id), evento_id: evento.id, reversion_evento_id: eventoAnterior.id };
  db.prepare("INSERT INTO fin_auditoria(entidad_id,usuario_id,accion,entidad_tabla,entidad_registro_id,datos_antes,datos_despues) VALUES(?,?,'actualizar','fin_documentos_cxc',?,?,?)").run(entidadId, usuarioId, registro.documento_id, JSON.stringify(antes), JSON.stringify(despues));
  return { venta_id: Number(ventaId), documento_cxc_id: registro.documento_id, cliente: cliente.nombre, saldo: importeMinor / 100, evento_financiero_id: evento.id };
});
module.exports = { crearSaldoInicialCxC, editarSaldoInicialCxC };
