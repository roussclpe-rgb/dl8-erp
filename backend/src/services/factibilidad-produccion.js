const { db } = require("../db");
const { stockIngrediente } = require("./fifo");

const EPSILON = 0.0000001;

function recetaFactible(receta) {
  const items = db.prepare(`
    SELECT ri.ingrediente_id, ri.cantidad_base, i.nombre AS ingrediente_nombre, i.unidad_base
    FROM receta_items ri JOIN ingredientes i ON i.id = ri.ingrediente_id
    WHERE ri.receta_id = ? AND i.activo = 1
    ORDER BY i.nombre
  `).all(receta.id).map((item) => ({ ...item, stock: Number(stockIngrediente(item.ingrediente_id)) }));
  const ratios = items.map((item) => ({ ...item, tandas: item.stock / Number(item.cantidad_base) }));
  const limitante = ratios.length ? ratios.reduce((menor, item) => item.tandas < menor.tandas ? item : menor) : null;
  const tandasPosibles = limitante ? Math.max(0, Math.floor(limitante.tandas + EPSILON)) : 0;
  const faltantes = items.map((item) => ({
    ingrediente_id: item.ingrediente_id,
    nombre: item.ingrediente_nombre,
    unidad_base: item.unidad_base,
    cantidad_base: Math.max(0, Number(item.cantidad_base) - item.stock),
  })).filter((item) => item.cantidad_base > EPSILON);
  return {
    receta_id: receta.id,
    grupo_id: receta.grupo_id,
    receta: receta.nombre_producto,
    version: receta.version,
    rendimiento: Number(receta.rendimiento),
    tandas_posibles: tandasPosibles,
    unidades_posibles: tandasPosibles * Number(receta.rendimiento),
    estado: tandasPosibles >= 1 ? "disponible" : "stock_insuficiente",
    ingrediente_limitante: limitante ? { ingrediente_id: limitante.ingrediente_id, nombre: limitante.ingrediente_nombre, unidad_base: limitante.unidad_base } : null,
    faltantes,
  };
}

function analizarFactibilidadProduccion() {
  return db.prepare("SELECT * FROM recetas WHERE vigente=1 AND activo=1 ORDER BY nombre_producto, version").all().map(recetaFactible);
}

const crearListaCompraFaltantes = db.transaction(({ usuarioId }) => {
  const recetasInsuficientes = analizarFactibilidadProduccion().filter((receta) => receta.estado === "stock_insuficiente");
  const requeridos = new Map();
  for (const receta of recetasInsuficientes) {
    const items = db.prepare(`SELECT ri.ingrediente_id, ri.cantidad_base, i.unidad_base FROM receta_items ri JOIN ingredientes i ON i.id=ri.ingrediente_id WHERE ri.receta_id=? AND i.activo=1`).all(receta.receta_id);
    for (const item of items) {
      const actual = requeridos.get(item.ingrediente_id) || { ...item, cantidad_base: 0 };
      actual.cantidad_base += Number(item.cantidad_base);
      requeridos.set(item.ingrediente_id, actual);
    }
  }
  const faltantes = [...requeridos.values()].map((item) => ({ ...item, cantidad_base: Math.max(0, item.cantidad_base - Number(stockIngrediente(item.ingrediente_id)) ) })).filter((item) => item.cantidad_base > EPSILON);
  const lista = db.prepare("INSERT INTO listas_compra_produccion(usuario_id) VALUES(?)").run(usuarioId);
  const listaId = Number(lista.lastInsertRowid);
  const insertar = db.prepare("INSERT INTO lista_compra_produccion_items(lista_id,ingrediente_id,cantidad_base,unidad_base) VALUES(?,?,?,?)");
  for (const item of faltantes) insertar.run(listaId, item.ingrediente_id, item.cantidad_base, item.unidad_base);
  db.prepare("INSERT INTO log_auditoria(usuario_id,entidad,entidad_id,accion,datos_despues) VALUES(?, 'lista_compra_produccion', ?, 'crear', ?)").run(usuarioId, listaId, JSON.stringify({ recetas: recetasInsuficientes.map((receta) => receta.receta_id), items: faltantes }));
  return { id: listaId, recetas_insuficientes: recetasInsuficientes.length, items: faltantes };
});

module.exports = { analizarFactibilidadProduccion, crearListaCompraFaltantes };
