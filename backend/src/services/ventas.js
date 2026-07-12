// src/services/ventas.js
const { db } = require("../db");

// Unidades disponibles de un producto (identificado por el grupo de su
// receta), calculado igual que se calculan los costos en costeo.js: al
// vuelo, sin guardar un "stock" aparte.
function stockDisponible(recetaGrupoId) {
  const producido = db.prepare(`
    SELECT COALESCE(SUM(p.unidades_producidas), 0) AS total
    FROM producciones p
    JOIN recetas r ON r.id = p.receta_id
    WHERE r.grupo_id = ? AND p.anulado = 0
  `).get(recetaGrupoId).total;

  const vendido = db.prepare(`
    SELECT COALESCE(SUM(vi.cantidad), 0) AS total
    FROM venta_items vi
    JOIN ventas v ON v.id = vi.venta_id
    WHERE vi.receta_grupo_id = ? AND v.anulado = 0
  `).get(recetaGrupoId).total;

    const mermado = db.prepare(`
    SELECT COALESCE(SUM(cantidad), 0) AS total
    FROM mermas_producto
    WHERE grupo_receta_id = ?
  `).get(recetaGrupoId).total;

  return producido - vendido - mermado;
}

function productoVendible(recetaGrupoId) {
  return db.prepare(`
    SELECT pv.*, r.nombre_producto
    FROM productos_venta pv
    JOIN recetas r ON r.grupo_id = pv.receta_grupo_id AND r.vigente = 1
    WHERE pv.receta_grupo_id = ? AND pv.activo = 1
  `).get(recetaGrupoId);
}

// Calcula precios, aplica descuentos manuales, valida stock y arma el detalle de una venta.
// Lanza un error con `.status` (400/404/409) si algo no es válido, para que
// la ruta lo capture igual que hace producciones.js con calcularProduccion.
function calcularVenta({ items, cliente, descuentoTipo, descuentoValor }) {
  let subtotal = 0;

  const itemsCalculados = items.map((it) => {
  if (!(Number(it.cantidad) > 0)) {
    const e = new Error("La cantidad debe ser mayor a 0");
    e.status = 400;
    throw e;
  }

  const producto = productoVendible(it.receta_grupo_id);

  if (!producto) {
    const e = new Error(`El producto ${it.receta_grupo_id} no existe o no está activo`);
    e.status = 400;
    throw e;
  }

    const disponible = stockDisponible(it.receta_grupo_id);
    if (it.cantidad > disponible) {
      const e = new Error(
        `Stock insuficiente de "${producto.nombre_producto}": disponible ${disponible}, solicitado ${it.cantidad}`
      );
      e.status = 409;
      throw e;
    }

    const precioUnitario = cliente.tipo === "mayorista" ? producto.precio_mayorista : producto.precio_normal;
    const subtotalItem = precioUnitario * it.cantidad;
    subtotal += subtotalItem;

    return {
      receta_grupo_id: it.receta_grupo_id,
      nombre_producto: producto.nombre_producto,
      cantidad: it.cantidad,
      precioUnitario,
      subtotal: subtotalItem,
    };
  });

  let descuentoMonto = 0;
  const valor = Number(descuentoValor) || 0;
  if (valor > 0) {
    descuentoMonto = descuentoTipo === "porcentaje" ? subtotal * (Math.min(valor, 100) / 100) : Math.min(valor, subtotal);
  }
  const total = Math.max(subtotal - descuentoMonto, 0);

  return { itemsCalculados, subtotal, descuentoMonto, total };
}

module.exports = { stockDisponible, productoVendible, calcularVenta };
