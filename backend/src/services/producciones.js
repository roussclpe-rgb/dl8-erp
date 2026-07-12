const { db } = require("../db");
const { consumir } = require("./fifo");
const { costoManoObraPara, costoIndirectosPara } = require("./costeo");

// Calcula y ejecuta el consumo de materia prima para una producción.
// No abre su propia transacción: quien la llama (routes/producciones.js)
// la envuelve en db.transaction() junto con el INSERT de la producción y
// el log de auditoría, para que todo el flujo sea atómico (todo o nada).
function normalizarCantidadProduccion({ modo = "tandas", tandas, unidades, rendimiento }) {
  const rendimientoNumerico = Number(rendimiento);
  if (!Number.isFinite(rendimientoNumerico) || rendimientoNumerico <= 0) {
    const error = new Error("El rendimiento de la receta debe ser numérico y mayor que cero.");
    error.status = 409;
    throw error;
  }
  const cantidad = Number(modo === "unidades" ? unidades : tandas);
  if (!Number.isFinite(cantidad) || cantidad <= 0) {
    const error = new Error(modo === "unidades" ? "Cantidad de unidades inválida" : "Número de tandas inválido");
    error.status = 400;
    throw error;
  }
  // Se permiten tandas fraccionarias: los consumos se prorratean en la misma proporción.
  const tandasNormalizadas = modo === "unidades" ? cantidad / rendimientoNumerico : cantidad;
  if (!Number.isFinite(tandasNormalizadas) || tandasNormalizadas <= 0) {
    const error = new Error("La cantidad de producción no produce un número de tandas válido.");
    error.status = 400;
    throw error;
  }
  return { tandas: tandasNormalizadas, unidades: tandasNormalizadas * rendimientoNumerico };
}

function calcularProduccion({ receta, items, tandas, fecha, periodoId, usuarioId }) {
  const cantidad = normalizarCantidadProduccion({ tandas, rendimiento: receta?.rendimiento });
  tandas = cantidad.tandas;
  let costoMateriaPrima = 0;
  const consumosTotales = []; // [{ingredienteId, consumos:[...]}]

  for (const item of items) {
    const necesario = Number(item.cantidad_base) * tandas;
    if (!Number.isFinite(necesario) || necesario <= 0) {
      const error = new Error("La receta contiene una cantidad de ingrediente inválida.");
      error.status = 409;
      throw error;
    }
    const { costoTotal, faltante, consumos } = consumir({
      ingredienteId: item.ingrediente_id, cantidadBase: necesario, tipo: "consumo_produccion",
      motivo: `Producción: ${receta.nombre_producto} x${tandas} tanda(s)`, referenciaTipo: "produccion",
      referenciaId: null, usuarioId, fecha, periodoId,
    });
    if (faltante > 0.0001) {
      const ing = db.prepare("SELECT nombre FROM ingredientes WHERE id = ?").get(item.ingrediente_id);
      const err = new Error(`No hay suficiente stock de "${ing.nombre}" para producir ${tandas} tanda(s) (faltan ${faltante.toFixed(2)}).`);
      err.status = 409;
      // Al lanzar dentro de la transacción del caller, better-sqlite3 revierte
      // automáticamente TODO lo consumido hasta este punto (incluidos los
      // ingredientes de items anteriores en este mismo loop).
      throw err;
    }
    costoMateriaPrima += costoTotal;
    consumosTotales.push({ ingredienteId: item.ingrediente_id, consumos });
  }

  const unidadesProducidas = cantidad.unidades;
  const costoManoObra = costoManoObraPara(receta.minutos_mano_obra, tandas);
  const { total: costoIndirectos } = costoIndirectosPara({ tandas, unidadesProducidas });
  const costoTotal = costoMateriaPrima + costoManoObra + costoIndirectos;

  return {
    unidadesProducidas,
    costoMateriaPrima,
    costoManoObra,
    costoIndirectos,
    costoTotal,
    costoUnidad: costoTotal / unidadesProducidas,
    consumosTotales,
  };
}

module.exports = { calcularProduccion, normalizarCantidadProduccion };
