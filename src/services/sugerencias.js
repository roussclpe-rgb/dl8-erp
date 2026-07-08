const { db } = require("../db");
const { stockIngrediente } = require("./fifo");

const DIAS_HISTORIAL_DEFAULT = 30;

// Consumo diario promedio = todo lo que salió (producción + mermas + uso
// externo) entre los días de historial, dividido entre esos días.
function consumoDiarioPromedio(ingredienteId, diasHistorial = DIAS_HISTORIAL_DEFAULT) {
  const row = db.prepare(`
    SELECT COALESCE(SUM(-cantidad_base), 0) AS total_salido
    FROM movimientos_inventario
    WHERE ingrediente_id = ?
      AND cantidad_base < 0
      AND tipo IN ('consumo_produccion', 'merma', 'uso_externo')
      AND fecha >= date('now', ?)
  `).get(ingredienteId, `-${diasHistorial} days`);
  return row.total_salido / diasHistorial;
}

// Para cada ingrediente activo: stock actual, consumo diario, y cuánto
// conviene comprar para llegar a la cobertura deseada (dias_cobertura_deseados).
function sugerenciasCompra() {
  const ingredientes = db.prepare("SELECT * FROM ingredientes WHERE activo = 1").all();
  return ingredientes.map((ing) => {
    const stock = stockIngrediente(ing.id);
    const consumoDiario = consumoDiarioPromedio(ing.id);
    const coberturaActualDias = consumoDiario > 0 ? stock / consumoDiario : null;
    const objetivoStock = consumoDiario * ing.dias_cobertura_deseados;
    const cantidadSugerida = Math.max(0, objetivoStock - stock);
    return {
      ingredienteId: ing.id,
      nombre: ing.nombre,
      unidadBase: ing.unidad_base,
      stockActual: stock,
      stockMinimo: ing.stock_minimo,
      bajoMinimo: ing.stock_minimo > 0 && stock < ing.stock_minimo,
      consumoDiarioPromedio: consumoDiario,
      coberturaActualDias,
      diasCoberturaDeseados: ing.dias_cobertura_deseados,
      cantidadSugerida: Math.round(cantidadSugerida * 100) / 100,
    };
  }).filter((s) => s.bajoMinimo || s.cantidadSugerida > 0);
}

module.exports = { consumoDiarioPromedio, sugerenciasCompra };
