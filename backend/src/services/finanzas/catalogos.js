const { db } = require("../../db");
const { normalizarProveedor } = require("./cuentas-financieras");

const ROLES_FINANCIEROS = ["finanzas_admin", "finanzas_operador", "finanzas_lector", "finanzas_personal_propietario", "finanzas_auditor_personal"];
const ESTADOS = ["activa", "bloqueada", "inactiva"];
const NATURALEZAS = ["activo", "pasivo", "patrimonio", "ingreso", "costo", "gasto"];
const SUBTIPOS = ["efectivo_equivalente", "custodia_tercero", "fondos_procesador", "cuentas_por_cobrar", "inventario", "otro_activo", "cuentas_por_pagar", "otro_pasivo", "capital", "resultados_acumulados", "saldo_inicial", "ingreso_operativo", "otro_ingreso", "costo_ventas", "otro_costo", "gasto_operativo", "gasto_financiero", "otro_gasto"];
const TIPOS_CUENTA_FINANCIERA = ["caja", "banco", "billetera", "procesador", "custodia_tercero", "transito"];
const TIPOS_BOLSILLO = ["sin_asignar", "operacion", "reserva", "impuestos", "otro"];
const PLAN_MINIMO = [
  ["1101", "Caja", "activo", "efectivo_equivalente"], ["1102", "Bancos", "activo", "efectivo_equivalente"],
  ["1103", "Billeteras digitales", "activo", "efectivo_equivalente"], ["1104", "Fondos en custodia de terceros", "activo", "custodia_tercero"],
  ["1105", "Fondos en procesadores", "activo", "fondos_procesador"], ["1201", "Cuentas por cobrar", "activo", "cuentas_por_cobrar"],
  ["1301", "Inventarios", "activo", "inventario"], ["2101", "Cuentas por pagar", "pasivo", "cuentas_por_pagar"],
  ["3101", "Capital y aportes", "patrimonio", "capital"], ["3201", "Resultados acumulados", "patrimonio", "resultados_acumulados"],
  ["3901", "Saldo inicial de apertura", "patrimonio", "saldo_inicial"], ["4101", "Ingresos operativos", "ingreso", "ingreso_operativo"],
  ["5101", "Costos", "costo", "costo_ventas"], ["5201", "Gastos operativos", "gasto", "gasto_operativo"],
];
function fallo(message, status = 400) { const e = new Error(message); e.status = status; return e; }
function auditar({ entidadId = null, usuarioId, accion, tabla, id, antes = null, despues = null }) {
  db.prepare("INSERT INTO fin_auditoria (entidad_id, usuario_id, accion, entidad_tabla, entidad_registro_id, datos_antes, datos_despues) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(entidadId, usuarioId, accion, tabla, id, antes && JSON.stringify(antes), despues && JSON.stringify(despues));
}
function validarFecha(fecha) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha || "")) throw fallo("La fecha debe tener formato YYYY-MM-DD");
  return fecha;
}
function validarId(valor, nombre) {
  const id = Number(valor);
  if (!Number.isSafeInteger(id) || id <= 0) throw fallo(`${nombre} debe ser un ID positivo`);
  return id;
}
function entidadActiva(entidadId) {
  const entidad = db.prepare("SELECT * FROM fin_entidades_economicas WHERE id = ?").get(entidadId);
  if (!entidad) throw fallo("Entidad económica no encontrada", 404);
  if (entidad.estado !== "activa") throw fallo("La entidad económica no está activa", 409);
  return entidad;
}

const crearEntidadFundacion = db.transaction(({ codigo, nombre, tipo, fechaInicial, usuarioId }) => {
  const codigoNormalizado = String(codigo || "").trim().toUpperCase();
  if (!/^[A-Z0-9_-]{2,40}$/.test(codigoNormalizado)) throw fallo("codigo debe contener 2 a 40 caracteres: A-Z, 0-9, _ o -");
  if (!String(nombre || "").trim()) throw fallo("nombre es obligatorio");
  if (!["empresa", "persona", "patrimonio_compartido"].includes(tipo)) throw fallo("tipo de entidad inválido");
  const fecha = validarFecha(fechaInicial || new Date().toISOString().slice(0, 10));
  const [anio, mes] = fecha.slice(0, 7).split("-").map(Number);
  const entidadId = Number(db.prepare("INSERT INTO fin_entidades_economicas (codigo, nombre, tipo, es_personal, creado_por, actualizado_por) VALUES (?, ?, ?, ?, ?, ?)")
    .run(codigoNormalizado, String(nombre).trim(), tipo, tipo === "persona" ? 1 : 0, usuarioId, usuarioId).lastInsertRowid);
  const periodoId = Number(db.prepare("INSERT INTO fin_periodos (entidad_id, anio, mes, creado_por, actualizado_por) VALUES (?, ?, ?, ?, ?)")
    .run(entidadId, anio, mes, usuarioId, usuarioId).lastInsertRowid);
  const insertarCuenta = db.prepare("INSERT INTO fin_plan_cuentas (entidad_id, codigo, nombre, naturaleza, subtipo, creado_por, actualizado_por) VALUES (?, ?, ?, ?, ?, ?, ?)");
  PLAN_MINIMO.forEach(([c, n, naturaleza, subtipo]) => insertarCuenta.run(entidadId, c, n, naturaleza, subtipo, usuarioId, usuarioId));
  const bolsilloId = Number(db.prepare("INSERT INTO fin_bolsillos (entidad_id, codigo, nombre, tipo, creado_por, actualizado_por) VALUES (?, 'SIN_ASIGNAR', 'Sin asignar', 'sin_asignar', ?, ?)")
    .run(entidadId, usuarioId, usuarioId).lastInsertRowid);
  if (tipo === "persona") {
    const propietarioId = Number(db.prepare("INSERT INTO fin_propietarios (tipo, nombre, usuario_id, entidad_personal_id, creado_por, actualizado_por) VALUES ('persona', ?, ?, ?, ?, ?)")
      .run(String(nombre).trim(), usuarioId, entidadId, usuarioId, usuarioId).lastInsertRowid);
    db.prepare("INSERT INTO fin_accesos_entidad (usuario_id, entidad_id, rol_financiero, otorgado_por, actualizado_por) VALUES (?, ?, 'finanzas_personal_propietario', ?, ?)")
      .run(usuarioId, entidadId, usuarioId, usuarioId);
    auditar({ entidadId, usuarioId, accion: "crear", tabla: "fin_propietarios", id: propietarioId, despues: db.prepare("SELECT * FROM fin_propietarios WHERE id = ?").get(propietarioId) });
  } else {
    db.prepare("INSERT INTO fin_accesos_entidad (usuario_id, entidad_id, rol_financiero, otorgado_por, actualizado_por) VALUES (?, ?, 'finanzas_admin', ?, ?)")
      .run(usuarioId, entidadId, usuarioId, usuarioId);
  }
  const entidad = db.prepare("SELECT * FROM fin_entidades_economicas WHERE id = ?").get(entidadId);
  auditar({ entidadId, usuarioId, accion: "crear", tabla: "fin_entidades_economicas", id: entidadId, despues: entidad });
  return { entidad, periodoId, bolsilloSinAsignarId: bolsilloId };
});

function listarEntidadesParaUsuario(usuarioId) {
  return db.prepare("SELECT e.*, a.rol_financiero FROM fin_entidades_economicas e JOIN fin_accesos_entidad a ON a.entidad_id = e.id WHERE a.usuario_id = ? AND a.estado = 'activa' AND e.estado <> 'inactiva' ORDER BY e.nombre").all(usuarioId);
}
function listarPropietarios() {
  return db.prepare("SELECT * FROM fin_propietarios ORDER BY nombre, id").all();
}
function exigirAcceso(entidadId, usuarioId, roles = ROLES_FINANCIEROS) {
  const acceso = db.prepare("SELECT a.*, e.es_personal, e.estado AS entidad_estado FROM fin_accesos_entidad a JOIN fin_entidades_economicas e ON e.id = a.entidad_id WHERE a.usuario_id = ? AND a.entidad_id = ? AND a.estado = 'activa'").get(usuarioId, entidadId);
  if (!acceso || !roles.includes(acceso.rol_financiero)) throw fallo("No tienes acceso financiero a esta entidad", 403);
  if (acceso.entidad_estado !== "activa") throw fallo("La entidad financiera no está activa", 409);
  return acceso;
}

const crearPropietario = db.transaction(({ tipo, nombre, documentoTipo, documentoNumero, usuarioId, creadoPor }) => {
  if (!["persona", "organizacion"].includes(tipo) || !String(nombre || "").trim()) throw fallo("tipo y nombre de propietario son obligatorios");
  const id = Number(db.prepare("INSERT INTO fin_propietarios (tipo, nombre, documento_tipo, documento_numero, usuario_id, creado_por, actualizado_por) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(tipo, String(nombre).trim(), documentoTipo || null, documentoNumero || null, usuarioId || null, creadoPor, creadoPor).lastInsertRowid);
  const registro = db.prepare("SELECT * FROM fin_propietarios WHERE id = ?").get(id);
  auditar({ usuarioId: creadoPor, accion: "crear", tabla: "fin_propietarios", id, despues: registro }); return registro;
});
const crearParticipacion = db.transaction(({ entidadId, propietarioId, porcentajeMinor, cuentaCapitalId, fechaInicio, fechaFin, usuarioId }) => {
  entidadId = validarId(entidadId, "entidad_id"); propietarioId = validarId(propietarioId, "propietario_id");
  entidadActiva(entidadId); validarFecha(fechaInicio); if (fechaFin) validarFecha(fechaFin);
  if (porcentajeMinor != null && (!Number.isInteger(porcentajeMinor) || porcentajeMinor < 0 || porcentajeMinor > 10000)) throw fallo("porcentaje_minor debe ser un entero entre 0 y 10000");
  if (cuentaCapitalId != null) {
    cuentaCapitalId = validarId(cuentaCapitalId, "cuenta_capital_id");
    if (!db.prepare("SELECT 1 FROM fin_plan_cuentas WHERE id = ? AND entidad_id = ? AND naturaleza = 'patrimonio' AND subtipo = 'capital'").get(cuentaCapitalId, entidadId)) throw fallo("cuenta_capital_id debe ser una cuenta de capital de la entidad");
  }
  const id = Number(db.prepare("INSERT INTO fin_participaciones (entidad_id, propietario_id, porcentaje_minor, cuenta_capital_id, fecha_inicio, fecha_fin, creado_por, actualizado_por) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(entidadId, propietarioId, porcentajeMinor ?? null, cuentaCapitalId || null, fechaInicio, fechaFin || null, usuarioId, usuarioId).lastInsertRowid);
  const registro = db.prepare("SELECT * FROM fin_participaciones WHERE id = ?").get(id); auditar({ entidadId, usuarioId, accion: "crear", tabla: "fin_participaciones", id, despues: registro }); return registro;
});
const crearCuentaPlan = db.transaction(({ entidadId, codigo, nombre, naturaleza, subtipo, permiteMovimiento = true, usuarioId }) => {
  entidadId = validarId(entidadId, "entidad_id");
  entidadActiva(entidadId); if (!String(codigo || "").trim() || !String(nombre || "").trim()) throw fallo("codigo y nombre son obligatorios");
  if (!NATURALEZAS.includes(naturaleza) || !SUBTIPOS.includes(subtipo)) throw fallo("naturaleza o subtipo de cuenta inválido");
  const id = Number(db.prepare("INSERT INTO fin_plan_cuentas (entidad_id, codigo, nombre, naturaleza, subtipo, permite_movimiento, creado_por, actualizado_por) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(entidadId, String(codigo).trim(), String(nombre).trim(), naturaleza, subtipo, permiteMovimiento ? 1 : 0, usuarioId, usuarioId).lastInsertRowid);
  const registro = db.prepare("SELECT * FROM fin_plan_cuentas WHERE id = ?").get(id); auditar({ entidadId, usuarioId, accion: "crear", tabla: "fin_plan_cuentas", id, despues: registro }); return registro;
});
const crearCuentaFinanciera = db.transaction(({ entidadId, cuentaContableId, codigo, nombre, tipo, proveedor, titularLegal, custodioPropietarioId, custodioEntidadId, referenciaExterna, usuarioId }) => {
  entidadId = validarId(entidadId, "entidad_id"); cuentaContableId = validarId(cuentaContableId, "cuenta_contable_id");
  entidadActiva(entidadId); if (!String(codigo || "").trim() || !String(nombre || "").trim()) throw fallo("codigo y nombre son obligatorios");
  if (!TIPOS_CUENTA_FINANCIERA.includes(tipo)) throw fallo("tipo de cuenta financiera inválido");
  proveedor = normalizarProveedor(tipo, proveedor);
  if (custodioPropietarioId != null) custodioPropietarioId = validarId(custodioPropietarioId, "custodio_propietario_id");
  if (custodioEntidadId != null) custodioEntidadId = validarId(custodioEntidadId, "custodio_entidad_id");
  if (custodioPropietarioId && custodioEntidadId) throw fallo("Una cuenta solo puede tener un tipo de custodio");
  const id = Number(db.prepare("INSERT INTO fin_cuentas_financieras (entidad_id, cuenta_contable_id, codigo, nombre, tipo, proveedor, titular_legal, custodio_propietario_id, custodio_entidad_id, referencia_externa, creado_por, actualizado_por) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(entidadId, cuentaContableId, String(codigo).trim(), String(nombre).trim(), tipo, proveedor, titularLegal || null, custodioPropietarioId || null, custodioEntidadId || null, referenciaExterna || null, usuarioId, usuarioId).lastInsertRowid);
  const registro = db.prepare("SELECT * FROM fin_cuentas_financieras WHERE id = ?").get(id); auditar({ entidadId, usuarioId, accion: "crear", tabla: "fin_cuentas_financieras", id, despues: registro }); return registro;
});
const actualizarCuentaFinanciera = db.transaction(({ entidadId, id, cuentaContableId, codigo, nombre, tipo, proveedor, titularLegal, custodioPropietarioId, custodioEntidadId, referenciaExterna, usuarioId }) => {
  entidadId = validarId(entidadId, "entidad_id"); id = validarId(id, "id"); cuentaContableId = validarId(cuentaContableId, "cuenta_contable_id");
  const antes = db.prepare("SELECT * FROM fin_cuentas_financieras WHERE id=? AND entidad_id=?").get(id, entidadId);
  if (!antes) throw fallo("Cuenta financiera no encontrada", 404);
  if (!String(codigo || "").trim() || !String(nombre || "").trim()) throw fallo("codigo y nombre son obligatorios");
  if (!TIPOS_CUENTA_FINANCIERA.includes(tipo)) throw fallo("tipo de cuenta financiera inválido");
  proveedor = normalizarProveedor(tipo, proveedor);
  if (custodioPropietarioId != null) custodioPropietarioId = validarId(custodioPropietarioId, "custodio_propietario_id");
  if (custodioEntidadId != null) custodioEntidadId = validarId(custodioEntidadId, "custodio_entidad_id");
  if (custodioPropietarioId && custodioEntidadId) throw fallo("Una cuenta solo puede tener un tipo de custodio");
  db.prepare(`UPDATE fin_cuentas_financieras SET cuenta_contable_id=?,codigo=?,nombre=?,tipo=?,proveedor=?,titular_legal=?,custodio_propietario_id=?,custodio_entidad_id=?,referencia_externa=?,actualizado_por=?,actualizado_en=datetime('now') WHERE id=?`)
    .run(cuentaContableId, String(codigo).trim(), String(nombre).trim(), tipo, proveedor, titularLegal || null, custodioPropietarioId || null, custodioEntidadId || null, referenciaExterna || null, usuarioId, id);
  const despues = db.prepare("SELECT * FROM fin_cuentas_financieras WHERE id=?").get(id);
  auditar({ entidadId, usuarioId, accion: "actualizar", tabla: "fin_cuentas_financieras", id, antes, despues });
  return despues;
});
const crearBolsillo = db.transaction(({ entidadId, codigo, nombre, tipo, permiteSaldoNegativo = false, usuarioId }) => {
  entidadId = validarId(entidadId, "entidad_id");
  entidadActiva(entidadId); if (tipo === "sin_asignar") throw fallo("El bolsillo Sin asignar solo se crea al fundar la entidad"); if (!String(codigo || "").trim() || !String(nombre || "").trim()) throw fallo("codigo y nombre son obligatorios");
  if (!TIPOS_BOLSILLO.includes(tipo)) throw fallo("tipo de bolsillo inválido");
  const id = Number(db.prepare("INSERT INTO fin_bolsillos (entidad_id, codigo, nombre, tipo, permite_saldo_negativo, creado_por, actualizado_por) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(entidadId, String(codigo).trim(), String(nombre).trim(), tipo, permiteSaldoNegativo ? 1 : 0, usuarioId, usuarioId).lastInsertRowid);
  const registro = db.prepare("SELECT * FROM fin_bolsillos WHERE id = ?").get(id); auditar({ entidadId, usuarioId, accion: "crear", tabla: "fin_bolsillos", id, despues: registro }); return registro;
});
const otorgarAcceso = db.transaction(({ entidadId, usuarioObjetivoId, rolFinanciero, usuarioId }) => {
  entidadId = validarId(entidadId, "entidad_id"); usuarioObjetivoId = validarId(usuarioObjetivoId, "usuario_id");
  entidadActiva(entidadId); if (!ROLES_FINANCIEROS.includes(rolFinanciero)) throw fallo("rol financiero inválido");
  const entidad = db.prepare("SELECT * FROM fin_entidades_economicas WHERE id = ?").get(entidadId);
  if (entidad.es_personal) {
    const esPropietario = db.prepare("SELECT 1 FROM fin_propietarios WHERE entidad_personal_id = ? AND usuario_id = ?").get(entidadId, usuarioObjetivoId);
    if (rolFinanciero === "finanzas_personal_propietario" && !esPropietario) throw fallo("Solo el propietario vinculado puede recibir acceso personal", 403);
    if (!["finanzas_personal_propietario", "finanzas_auditor_personal"].includes(rolFinanciero)) throw fallo("Las entidades personales solo admiten acceso de propietario o auditor", 403);
  }
  db.prepare("INSERT INTO fin_accesos_entidad (usuario_id, entidad_id, rol_financiero, otorgado_por, actualizado_por) VALUES (?, ?, ?, ?, ?) ON CONFLICT(usuario_id, entidad_id) DO UPDATE SET rol_financiero = excluded.rol_financiero, estado = 'activa', otorgado_por = excluded.otorgado_por, actualizado_por = excluded.actualizado_por, actualizado_en = datetime('now')")
    .run(usuarioObjetivoId, entidadId, rolFinanciero, usuarioId, usuarioId);
  const registro = db.prepare("SELECT * FROM fin_accesos_entidad WHERE usuario_id = ? AND entidad_id = ?").get(usuarioObjetivoId, entidadId); auditar({ entidadId, usuarioId, accion: "cambiar_acceso", tabla: "fin_accesos_entidad", id: registro.id, despues: registro }); return registro;
});
const cambiarEstadoCatalogo = db.transaction(({ tipo, entidadId, id, estado, usuarioId }) => {
  entidadId = validarId(entidadId, "entidad_id"); id = validarId(id, "id");
  if (!ESTADOS.includes(estado)) throw fallo("estado financiero inválido");
  const tabla = { plan_cuentas: "fin_plan_cuentas", cuentas_financieras: "fin_cuentas_financieras", bolsillos: "fin_bolsillos" }[tipo];
  if (!tabla) throw fallo("Catálogo no permitido");
  const antes = db.prepare(`SELECT * FROM ${tabla} WHERE id = ? AND entidad_id = ?`).get(id, entidadId);
  if (!antes) throw fallo("Registro no encontrado", 404);
  if (tabla === "fin_bolsillos" && antes.tipo === "sin_asignar" && estado !== "activa") throw fallo("El bolsillo Sin asignar debe permanecer activo");
  db.prepare(`UPDATE ${tabla} SET estado = ?, actualizado_por = ?, actualizado_en = datetime('now') WHERE id = ?`).run(estado, usuarioId, id);
  const despues = db.prepare(`SELECT * FROM ${tabla} WHERE id = ?`).get(id);
  auditar({ entidadId, usuarioId, accion: estado === "activa" ? "actualizar" : estado === "bloqueada" ? "bloquear" : "inactivar", tabla, id, antes, despues });
  return despues;
});
function listarPorEntidad(tipo, entidadId) {
  const tabla = { periodos: "fin_periodos", cuentas: "fin_plan_cuentas", cuentas_financieras: "fin_cuentas_financieras", bolsillos: "fin_bolsillos", participaciones: "fin_participaciones", accesos: "fin_accesos_entidad" }[tipo];
  if (!tabla) throw fallo("Consulta de catálogo inválida"); return db.prepare(`SELECT * FROM ${tabla} WHERE entidad_id = ? ORDER BY id`).all(entidadId);
}
const cerrarPeriodo = db.transaction(({ entidadId, periodoId, usuarioId }) => {
  entidadId = validarId(entidadId, "entidad_id"); periodoId = validarId(periodoId, "periodo_id");
  const antes = db.prepare("SELECT * FROM fin_periodos WHERE id = ? AND entidad_id = ?").get(periodoId, entidadId); if (!antes) throw fallo("Período financiero no encontrado", 404); if (antes.estado !== "abierto") throw fallo("El período financiero ya está cerrado", 409);
  db.prepare("UPDATE fin_periodos SET estado = 'cerrado', cerrado_por = ?, cerrado_en = datetime('now'), actualizado_por = ?, actualizado_en = datetime('now') WHERE id = ?").run(usuarioId, usuarioId, periodoId);
  const despues = db.prepare("SELECT * FROM fin_periodos WHERE id = ?").get(periodoId); auditar({ entidadId, usuarioId, accion: "cerrar_periodo", tabla: "fin_periodos", id: periodoId, antes, despues }); return despues;
});
module.exports = { ROLES_FINANCIEROS, crearEntidadFundacion, listarEntidadesParaUsuario, listarPropietarios, exigirAcceso, crearPropietario, crearParticipacion, crearCuentaPlan, crearCuentaFinanciera, actualizarCuentaFinanciera, crearBolsillo, otorgarAcceso, cambiarEstadoCatalogo, listarPorEntidad, cerrarPeriodo };
