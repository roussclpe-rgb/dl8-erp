// Familias de unidades: cada unidad tiene un factor hacia la unidad canónica
// de su familia (gramos, mililitros o unidad). Permite convertir entre
// cualquier par de unidades de la misma familia.
const FAMILIAS_UNIDAD = {
  g: { tipo: "masa", factor: 1 },
  kg: { tipo: "masa", factor: 1000 },
  lb: { tipo: "masa", factor: 453.592 },
  oz: { tipo: "masa", factor: 28.3495 },
  ml: { tipo: "volumen", factor: 1 },
  l: { tipo: "volumen", factor: 1000 },
  taza: { tipo: "volumen", factor: 240 },
  cda: { tipo: "volumen", factor: 15 },
  cdta: { tipo: "volumen", factor: 5 },
  unidad: { tipo: "conteo", factor: 1 },
  docena: { tipo: "conteo", factor: 12 },
  media_docena: { tipo: "conteo", factor: 6 },
  caja12: { tipo: "conteo", factor: 12 },
  caja24: { tipo: "conteo", factor: 24 },
};

const UNIDADES_BASE_PERMITIDAS = ["g", "kg", "ml", "l", "unidad", "lb", "oz"];

function unidadesCompatibles(unidadBase) {
  const tipo = FAMILIAS_UNIDAD[unidadBase]?.tipo;
  if (!tipo) return [];
  return Object.keys(FAMILIAS_UNIDAD).filter((u) => FAMILIAS_UNIDAD[u].tipo === tipo);
}

function factorConversion(unidadBase, unidadOrigen) {
  const base = FAMILIAS_UNIDAD[unidadBase];
  const origen = FAMILIAS_UNIDAD[unidadOrigen];
  if (!base || !origen || base.tipo !== origen.tipo) {
    throw new Error(`No se puede convertir de "${unidadOrigen}" a "${unidadBase}": unidades incompatibles`);
  }
  return origen.factor / base.factor;
}

module.exports = { FAMILIAS_UNIDAD, UNIDADES_BASE_PERMITIDAS, unidadesCompatibles, factorConversion };
