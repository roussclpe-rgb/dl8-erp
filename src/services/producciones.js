const { db } = require("../db");
const { consumir } = require("./fifo");
const { costoManoObraPara, costoIndirectosPara } = require("./costeo");

// Calcula y ejecuta el consumo de materia prima para una producción.
// No abre su propia transacción: quien la llama (routes/producciones.js)
// la envuelve en db.transaction() junto con el INSERT de la producción y
// el log de auditoría, para que todo el flujo sea atómico (todo o nada).
function calcularProduccion({ receta, items, tandas, fecha, periodoId, usuarioId }) {
  let costoMateriaPrima = 0;
  const consumosTotales = []; // [{ingredienteId, consumos:[...]}]

  for (const item of items) {
    const necesario = item.cantidad_base * tandas;
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

  const unidadesProducidas = receta.rendimiento * tandas;
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

module.exports = { calcularProduccion };
