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
