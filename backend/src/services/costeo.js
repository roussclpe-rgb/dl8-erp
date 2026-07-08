const { db } = require("../db");
const { lotesDisponibles } = require("./fifo");

// Calcula cuánto costaría consumir `cantidadBase` SIN modificar la base de
// datos. Sirve para mostrar "costo estimado" de una receta antes de producir.
function simularConsumo(ingredienteId, cantidadBase) {
  let restante = cantidadBase;
  let costo = 0;
  const lotes = lotesDisponibles(ingredienteId);
  for (const lote of lotes) {
    if (restante <= 0) break;
    const tomar = Math.min(lote.cantidad_restante, restante);
    costo += tomar * lote.costo_unidad_base;
    restante -= tomar;
  }
  return { costo, faltante: restante };
}

function costoEstimadoReceta(recetaId) {
  const receta = db.prepare("SELECT * FROM recetas WHERE id = ?").get(recetaId);
  const items = db.prepare("SELECT * FROM receta_items WHERE receta_id = ?").all(recetaId);
  let costoMateriaPrima = 0;
  let incompleto = false;
  for (const item of items) {
    const { costo, faltante } = simularConsumo(item.ingrediente_id, item.cantidad_base);
    costoMateriaPrima += costo;
    if (faltante > 0.0001) incompleto = true;
  }
  const costoManoObra = costoManoObraPara(receta.minutos_mano_obra);
  return { receta, items, costoMateriaPrima, costoManoObra, incompleto };
}

function costoManoObraPara(minutos, tandas = 1) {
  const config = db.prepare("SELECT * FROM config_mano_obra WHERE activo = 1 ORDER BY id DESC LIMIT 1").get();
  const costoHora = config ? config.costo_por_hora : 0;
  return (minutos * tandas / 60) * costoHora;
}

// Prorratea todos los costos indirectos activos para una producción de
// `unidadesProducidas` unidades en `tandas` tandas.
function costoIndirectosPara({ tandas, unidadesProducidas }) {
  const configs = db.prepare("SELECT * FROM config_costos WHERE activo = 1").all();
  let total = 0;
  const detalle = [];
  for (const c of configs) {
    let monto = 0;
    if (c.tipo === "por_tanda") monto = c.valor * tandas;
    else if (c.tipo === "por_unidad") monto = c.valor * unidadesProducidas;
    else if (c.tipo === "mensual_prorrateado" && c.unidades_estimadas_mes > 0) {
      monto = (c.valor / c.unidades_estimadas_mes) * unidadesProducidas;
    }
    total += monto;
    detalle.push({ nombre: c.nombre, tipo: c.tipo, monto });
  }
  return { total, detalle };
}

module.exports = { simularConsumo, costoEstimadoReceta, costoManoObraPara, costoIndirectosPara };
