import client from "./client";

// ---------- Auth ----------
export const login = (email, password) => client.post("/auth/login", { email, password }).then((r) => r.data);

// ---------- Usuarios ----------
export const listarUsuarios = () => client.get("/usuarios").then((r) => r.data);
export const crearUsuario = (data) => client.post("/usuarios", data).then((r) => r.data);
export const cambiarEstadoUsuario = (id, activo) => client.patch(`/usuarios/${id}/estado`, { activo }).then((r) => r.data);

// ---------- Proveedores ----------
export const listarProveedores = () => client.get("/proveedores").then((r) => r.data);
export const crearProveedor = (data) => client.post("/proveedores", data).then((r) => r.data);
export const editarProveedor = (id, data) => client.put(`/proveedores/${id}`, data).then((r) => r.data);
export const eliminarProveedor = (id) => client.delete(`/proveedores/${id}`).then((r) => r.data);

// ---------- Ingredientes ----------
export const listarIngredientes = () => client.get("/ingredientes").then((r) => r.data);
export const crearIngrediente = (data) => client.post("/ingredientes", data).then((r) => r.data);
export const editarIngrediente = (id, data) => client.put(`/ingredientes/${id}`, data).then((r) => r.data);
export const eliminarIngrediente = (id) => client.delete(`/ingredientes/${id}`).then((r) => r.data);

// ---------- Compras ----------
export const listarCompras = () => client.get("/compras").then((r) => r.data);
export const crearCompra = (data) => client.post("/compras", data).then((r) => r.data);
export const editarCompra = (id, data) => client.put(`/compras/${id}`, data).then((r) => r.data);
export const unidadesCompatibles = (ingredienteId) =>
  client.get(`/compras/unidades-compatibles/${ingredienteId}`).then((r) => r.data);

// ---------- Ajustes ----------
export const listarAjustes = () => client.get("/ajustes").then((r) => r.data);
export const crearAjuste = (data) => client.post("/ajustes", data).then((r) => r.data);

// ---------- Recetas ----------
export const listarRecetas = () => client.get("/recetas").then((r) => r.data);
export const historialReceta = (id) => client.get(`/recetas/${id}/historial`).then((r) => r.data);
export const crearReceta = (data) => client.post("/recetas", data).then((r) => r.data);
export const editarReceta = (id, data) => client.put(`/recetas/${id}`, data).then((r) => r.data);
export const eliminarReceta = (id) => client.delete(`/recetas/${id}`).then((r) => r.data);

// ---------- Producciones ----------
export const listarProducciones = () => client.get("/producciones").then((r) => r.data);
export const crearProduccion = (data) => client.post("/producciones", data).then((r) => r.data);
export const editarProduccion = (id, data) => client.put(`/producciones/${id}`, data).then((r) => r.data);

// ---------- Mermas ----------
export const listarMermas = () => client.get("/mermas").then((r) => r.data);
export const crearMerma = (data) => client.post("/mermas", data).then((r) => r.data);
export const stockProducto = (grupoRecetaId) => client.get(`/mermas/stock-producto/${grupoRecetaId}`).then((r) => r.data);

// ---------- Periodos ----------
export const listarPeriodos = () => client.get("/periodos").then((r) => r.data);
export const cerrarPeriodo = (anio, mes) => client.post("/periodos/cerrar", { anio, mes }).then((r) => r.data);

// ---------- Configuración de costos ----------
export const obtenerConfigCostos = () => client.get("/config-costos").then((r) => r.data);
export const crearCostoIndirecto = (data) => client.post("/config-costos/indirectos", data).then((r) => r.data);
export const eliminarCostoIndirecto = (id) => client.delete(`/config-costos/indirectos/${id}`).then((r) => r.data);
export const actualizarManoObra = (data) => client.post("/config-costos/mano-obra", data).then((r) => r.data);

// ---------- Reportes ----------
export const reporteValorizacion = () => client.get("/reportes/valorizacion-inventario").then((r) => r.data);
export const reporteMermas = (desde, hasta) =>
  client.get("/reportes/mermas", { params: { desde, hasta } }).then((r) => r.data);
export const reporteRotacion = (dias) => client.get("/reportes/rotacion", { params: { dias } }).then((r) => r.data);
export const reporteSugerenciasCompra = () => client.get("/reportes/sugerencias-compra").then((r) => r.data);
export const reporteCaja = (desde, hasta) => client.get("/reportes/caja", { params: { desde, hasta } }).then((r) => r.data);

// ---------- Clientes ----------
export const listarClientes = () =>
  client.get("/clientes").then((r) => r.data);

export const crearCliente = (data) =>
  client.post("/clientes", data).then((r) => r.data);

export const eliminarCliente = (id) =>
  client.delete(`/clientes/${id}`).then((r) => r.data);


// ---------- Productos venta ----------
export const listarProductosVenta = () =>
  client.get("/productos-venta").then((r) => r.data);

export const crearProductoVenta = (data) =>
  client.post("/productos-venta", data).then((r) => r.data);

export const editarProductoVenta = (grupoId, data) =>
  client.put(`/productos-venta/${grupoId}`, data).then((r) => r.data);


// ---------- Ventas ----------
export const listarVentas = () =>
  client.get("/ventas").then((r) => r.data);

export const listarVentasPendientes = () =>
  client.get("/ventas/pendientes").then((r) => r.data);

export const obtenerVenta = (id) =>
  client.get(`/ventas/${id}`).then((r) => r.data);

export const crearVenta = (data, idempotencyKey) =>
  client.post("/ventas", data, { headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined }).then((r) => r.data);

export const registrarPago = (id, pagos, turnoCajaId, idempotencyKey) =>
  client
    .post(`/ventas/${id}/pagos`, {
      pagos,
      turno_caja_id: turnoCajaId || undefined,
    }, { headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined })
    .then((r) => r.data);

export const anularVenta = (id) =>
  client.post(`/ventas/${id}/anular`).then((r) => r.data);

export const listarRecetasSinPrecio = () =>
  client.get("/productos-venta/sin-precio").then((r) => r.data);


// ---------- Caja ----------
export const listarCajas = () =>
  client.get("/caja").then((r) => r.data);

export const crearCaja = (data) =>
  client.post("/caja", data).then((r) => r.data);

export const configurarCajaFinanciera = (id, data) =>
  client.patch(`/caja/${id}/configuracion-financiera`, data).then((r) => r.data);

export const listarEntidadesFinancieras = () =>
  client.get("/finanzas/entidades").then((r) => r.data);

// ---------- Finanzas ----------
export const crearEntidadFinanciera = (data) => client.post("/finanzas/entidades", data).then((r) => r.data);
export const listarPropietariosFinancieros = () => client.get("/finanzas/propietarios").then((r) => r.data);
export const crearPropietarioFinanciero = (data) => client.post("/finanzas/propietarios", data).then((r) => r.data);
export const listarPeriodosFinancieros = (entidadId) => client.get(`/finanzas/entidades/${entidadId}/periodos`).then((r) => r.data);
export const cerrarPeriodoFinanciero = (entidadId, periodoId) => client.post(`/finanzas/entidades/${entidadId}/periodos/${periodoId}/cerrar`).then((r) => r.data);
export const listarPlanCuentas = (entidadId) => client.get(`/finanzas/entidades/${entidadId}/plan-cuentas`).then((r) => r.data);
export const crearCuentaPlan = (entidadId, data) => client.post(`/finanzas/entidades/${entidadId}/plan-cuentas`, data).then((r) => r.data);
export const listarBolsillos = (entidadId) => client.get(`/finanzas/entidades/${entidadId}/bolsillos`).then((r) => r.data);
export const crearBolsillo = (entidadId, data) => client.post(`/finanzas/entidades/${entidadId}/bolsillos`, data).then((r) => r.data);
export const listarParticipacionesFinancieras = (entidadId) => client.get(`/finanzas/entidades/${entidadId}/participaciones`).then((r) => r.data);
export const crearParticipacionFinanciera = (entidadId, data) => client.post(`/finanzas/entidades/${entidadId}/participaciones`, data).then((r) => r.data);
export const listarAccesosFinancieros = (entidadId) => client.get(`/finanzas/entidades/${entidadId}/accesos`).then((r) => r.data);
export const otorgarAccesoFinanciero = (entidadId, data) => client.post(`/finanzas/entidades/${entidadId}/accesos`, data).then((r) => r.data);
export const cambiarEstadoCatalogoFinanciero = (entidadId, tipo, id, estado) => client.patch(`/finanzas/entidades/${entidadId}/${tipo}/${id}/estado`, { estado }).then((r) => r.data);
export const crearCuentaFinanciera = (entidadId, data) => client.post(`/finanzas/entidades/${entidadId}/cuentas-financieras`, data).then((r) => r.data);
export const saldosTesoreria = (entidadId) => client.get(`/finanzas/entidades/${entidadId}/saldos/tesoreria`).then((r) => r.data);
export const saldosBolsillos = (entidadId) => client.get(`/finanzas/entidades/${entidadId}/saldos/bolsillos`).then((r) => r.data);
export const dondeEstaMiDinero = (entidadId) => client.get(`/finanzas/entidades/${entidadId}/donde-esta-mi-dinero`).then((r) => r.data);
export const listarEventosFinancieros = (entidadId) => client.get(`/finanzas/entidades/${entidadId}/eventos`).then((r) => r.data);
export const registrarMovimientoManual = (entidadId, data, idempotencyKey) => client.post(`/finanzas/entidades/${entidadId}/movimientos-manuales`, data, { headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined }).then((r) => r.data);
export const listarMovimientosManuales = (entidadId) => client.get(`/finanzas/entidades/${entidadId}/movimientos-manuales`).then((r) => r.data);
export const listarFlujosDinero = (entidadId, params) => client.get(`/finanzas/entidades/${entidadId}/flujo-dinero`, { params }).then((r) => r.data);
export const auditoriaMpf = (entidadId, params) => client.get(`/finanzas/entidades/${entidadId}/auditoria-mpf`, { params }).then((r) => r.data);
export const obtenerEventoFinanciero = (entidadId, eventoId) => client.get(`/finanzas/entidades/${entidadId}/eventos/${eventoId}`).then((r) => r.data);
export const flujoDineroEvento = (entidadId, eventoId) => client.get(`/finanzas/entidades/${entidadId}/eventos/${eventoId}/flujo-dinero`).then((r) => r.data);
export const saldosContables = (entidadId) => client.get(`/finanzas/entidades/${entidadId}/saldos/contables`).then((r) => r.data);
export const respaldoCuentaBolsillo = (entidadId, params) => client.get(`/finanzas/entidades/${entidadId}/saldos/respaldo-cuenta-bolsillo`, { params }).then((r) => r.data);
export const registrarSaldoInicial = (entidadId, data, key) => client.post(`/finanzas/entidades/${entidadId}/saldos-iniciales`, data, { headers: { "Idempotency-Key": key } }).then((r) => r.data);
export const registrarTransferenciaFinanciera = (entidadId, data, key) => client.post(`/finanzas/entidades/${entidadId}/transferencias-internas`, data, { headers: { "Idempotency-Key": key } }).then((r) => r.data);
export const reasignarBolsillo = (entidadId, data, key) => client.post(`/finanzas/entidades/${entidadId}/asignaciones-bolsillo`, data, { headers: { "Idempotency-Key": key } }).then((r) => r.data);
export const revertirEventoFinanciero = (entidadId, eventoId, key) => client.post(`/finanzas/entidades/${entidadId}/eventos/${eventoId}/reversiones`, {}, { headers: { "Idempotency-Key": key } }).then((r) => r.data);
export const listarPoliticasFinancieras = (entidadId) => client.get(`/finanzas/entidades/${entidadId}/politicas-financieras`).then((r) => r.data);
export const obtenerPoliticaFinanciera = (entidadId, politicaId) => client.get(`/finanzas/entidades/${entidadId}/politicas-financieras/${politicaId}`).then((r) => r.data);
export const crearPoliticaFinanciera = (entidadId, data) => client.post(`/finanzas/entidades/${entidadId}/politicas-financieras`, data).then((r) => r.data);
export const crearVersionPoliticaFinanciera = (entidadId, politicaId, data) => client.post(`/finanzas/entidades/${entidadId}/politicas-financieras/${politicaId}/versiones`, data).then((r) => r.data);
export const activarPoliticaFinanciera = (entidadId, politicaId, predeterminada = true) => client.post(`/finanzas/entidades/${entidadId}/politicas-financieras/${politicaId}/activar`, { predeterminada }).then((r) => r.data);
export const simularPoliticaFinanciera = (entidadId, politicaId, importeIngresoMinor) => client.post(`/finanzas/entidades/${entidadId}/politicas-financieras/${politicaId}/simular`, { importe_ingreso_minor: importeIngresoMinor }).then((r) => r.data);
export const historialPoliticaFinanciera = (entidadId, eventoId) => client.get(`/finanzas/entidades/${entidadId}/eventos/${eventoId}/politica-financiera`).then((r) => r.data);
export const resumenPoliticasFinancieras = (entidadId, params) => client.get(`/finanzas/entidades/${entidadId}/politicas-financieras/resumen`, { params }).then((r) => r.data);
export const dashboardPoliticasFinancieras = (entidadId, params) => client.get(`/finanzas/entidades/${entidadId}/politicas-financieras/dashboard`, { params }).then((r) => r.data);
export const aplicarPlantillaFinanciera = (entidadId, codigo) => client.post(`/finanzas/entidades/${entidadId}/politicas-financieras/plantillas/${codigo}`).then((r) => r.data);
export const listarPlantillasFinancieras = () => client.get('/finanzas/politicas-financieras/plantillas').then((r) => r.data);
export const listarMetasPoliticas = (entidadId) => client.get(`/finanzas/entidades/${entidadId}/politicas-financieras/metas`).then((r) => r.data);
export const guardarMetaPolitica = (entidadId, bolsilloId, metaMinor) => client.put(`/finanzas/entidades/${entidadId}/politicas-financieras/metas/${bolsilloId}`, { meta_minor: metaMinor }).then((r) => r.data);
export const listarMetasFinancieras = (entidadId) => client.get(`/finanzas/entidades/${entidadId}/metas-financieras`).then((r) => r.data);
export const crearMetaFinanciera = (entidadId, data) => client.post(`/finanzas/entidades/${entidadId}/metas-financieras`, data).then((r) => r.data);
export const actualizarMetaFinanciera = (entidadId, metaId, data) => client.put(`/finanzas/entidades/${entidadId}/metas-financieras/${metaId}`, data).then((r) => r.data);
export const cambiarEstadoMetaFinanciera = (entidadId, metaId, estado) => client.patch(`/finanzas/entidades/${entidadId}/metas-financieras/${metaId}/estado`, { estado }).then((r) => r.data);
export const aportesMetaFinanciera = (entidadId, metaId) => client.get(`/finanzas/entidades/${entidadId}/metas-financieras/${metaId}/aportes`).then((r) => r.data);
export const registrarAporteSocio = (entidadId, data, key) => client.post(`/finanzas/entidades/${entidadId}/aportes-socios`, data, { headers: { 'Idempotency-Key': key } }).then((r) => r.data);
export const registrarPrestamoRecibido = (entidadId, data, key) => client.post(`/finanzas/entidades/${entidadId}/prestamos-recibidos`, data, { headers: { 'Idempotency-Key': key } }).then((r) => r.data);
export const listarAlertasFinancieras = (entidadId) => client.get(`/finanzas/entidades/${entidadId}/alertas-financieras`).then((r) => r.data);
export const prediccionesFinancieras = (entidadId, horizonte = 90) => client.get(`/finanzas/entidades/${entidadId}/predicciones-financieras`, { params: { horizonte } }).then((r) => r.data);
export const cambiarEstadoAlertaFinanciera = (entidadId, alertaId, estado) => client.patch(`/finanzas/entidades/${entidadId}/alertas-financieras/${alertaId}/estado`, { estado }).then((r) => r.data);
export const historialAlertaFinanciera = (entidadId, alertaId) => client.get(`/finanzas/entidades/${entidadId}/alertas-financieras/${alertaId}/historial`).then((r) => r.data);
export const configuracionAlertasFinancieras = (entidadId) => client.get(`/finanzas/entidades/${entidadId}/alertas-financieras/configuracion`).then((r) => r.data);
export const guardarConfiguracionAlertasFinancieras = (entidadId, alertas) => client.put(`/finanzas/entidades/${entidadId}/alertas-financieras/configuracion`, { alertas }).then((r) => r.data);
export const simularEscenarioFinanciero = (entidadId, data) => client.post(`/finanzas/entidades/${entidadId}/escenarios-financieros/simular`, data).then((r) => r.data);
export const listarEscenariosFinancieros = (entidadId) => client.get(`/finanzas/entidades/${entidadId}/escenarios-financieros`).then((r) => r.data);
export const guardarEscenarioFinanciero = (entidadId, data, id) => (id ? client.put(`/finanzas/entidades/${entidadId}/escenarios-financieros/${id}`, data) : client.post(`/finanzas/entidades/${entidadId}/escenarios-financieros`, data)).then((r) => r.data);
export const duplicarEscenarioFinanciero = (entidadId, id, nombre) => client.post(`/finanzas/entidades/${entidadId}/escenarios-financieros/${id}/duplicar`, { nombre }).then((r) => r.data);
export const eliminarEscenarioFinanciero = (entidadId, id) => client.delete(`/finanzas/entidades/${entidadId}/escenarios-financieros/${id}`).then((r) => r.data);

export const listarCuentasFinancieras = (entidadId) =>
  client.get(`/finanzas/entidades/${entidadId}/cuentas-financieras`).then((r) => r.data);

export const eliminarCaja = (id) =>
  client.delete(`/caja/${id}`).then((r) => r.data);

export const turnoActualCaja = (cajaId) =>
  client.get(`/caja/${cajaId}/turno-actual`).then((r) => r.data);

export const abrirCaja = (cajaId, data) =>
  client.post(`/caja/${cajaId}/abrir`, data).then((r) => r.data);

export const cerrarTurnoCaja = (turnoId, data) =>
  client.post(`/caja/turnos/${turnoId}/cerrar`, data).then((r) => r.data);

export const listarTurnosCaja = (params) =>
  client.get("/caja/turnos", { params }).then((r) => r.data);

export const obtenerTurnoCaja = (turnoId) =>
  client.get(`/caja/turnos/${turnoId}`).then((r) => r.data);

export const registrarMovimientoCaja = (data) =>
  client.post("/caja/movimientos", data).then((r) => r.data);

export const listarMovimientosCaja = (turnoId) =>
  client.get("/caja/movimientos", {
    params: { turno_id: turnoId },
  }).then((r) => r.data);

export const transferirEntreCajas = (data, key) =>
  client.post("/caja/transferencias", data, { headers: key ? { "Idempotency-Key": key } : undefined }).then((r) => r.data);
