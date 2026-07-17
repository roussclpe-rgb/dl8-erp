const CATALOGO_NUTRICIONAL = require("../data/nutricion-peruana.json");
const PREFERENCIAS = {
  "harina de trigo": "A 63", "harina trigo": "A 63", mantequilla: "D 19", "leche evaporada": "G 7", "levadura seca": "L 24",
  "azucar blanca": { calorias: 387, proteinas: 0, carbohidratos: 100, grasas: 0, fibra: 0, sodio: 1, referencia: "Azúcar blanca", fuente: "Valor de respaldo para ingrediente no desagregado en la tabla" },
  azucar: { calorias: 387, proteinas: 0, carbohidratos: 100, grasas: 0, fibra: 0, sodio: 1, referencia: "Azúcar blanca", fuente: "Valor de respaldo para ingrediente no desagregado en la tabla" },
  huevo: { calorias: 143, proteinas: 12.6, carbohidratos: 0.7, grasas: 9.5, fibra: 0, sodio: 140, referencia: "Huevo de gallina", fuente: "Valor de respaldo para ingrediente no desagregado en la tabla" },
  sal: { calorias: 0, proteinas: 0, carbohidratos: 0, grasas: 0, fibra: 0, sodio: 38758, referencia: "Sal de mesa", fuente: "Valor de respaldo para ingrediente no desagregado en la tabla" },
};

function normalizar(texto) {
  return String(texto || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, " ").trim();
}

function palabras(texto) { return normalizar(texto).split(" ").filter((x) => x.length > 2); }

function buscarNutricion(nombre) {
  const consulta = normalizar(nombre);
  const preferencia = PREFERENCIAS[consulta];
  if (preferencia) {
    const item = typeof preferencia === "string" ? CATALOGO_NUTRICIONAL.find((fila) => fila.codigo === preferencia) : preferencia;
    if (item) return { calorias: item.calorias, proteinas: item.proteinas, carbohidratos: item.carbohidratos, grasas: item.grasas, fibra: item.fibra, sodio: item.sodio, referencia: item.nombre || item.referencia, codigo: item.codigo, fuente: item.fuente || "Tablas Peruanas de Composición de Alimentos 2017 (INS/CENAN)" };
  }
  const terminos = palabras(nombre);
  const coincidencias = CATALOGO_NUTRICIONAL.map((item) => {
    const referencia = normalizar(item.nombre);
    const palabrasReferencia = palabras(item.nombre);
    const comunes = terminos.filter((termino) => palabrasReferencia.includes(termino)).length;
    const puntaje = consulta === referencia ? 1000
      : (terminos.length > 1 && comunes === terminos.length ? 700
        : (referencia.startsWith(consulta) ? 500 : comunes * 10));
    return { item, puntaje };
  }).filter(({ puntaje }) => puntaje >= 10).sort((a, b) => b.puntaje - a.puntaje || a.item.nombre.length - b.item.nombre.length);
  if (!coincidencias.length) return null;
  const { item } = coincidencias[0];
  return { calorias: item.calorias, proteinas: item.proteinas, carbohidratos: item.carbohidratos, grasas: item.grasas, fibra: item.fibra, sodio: item.sodio, referencia: item.nombre, codigo: item.codigo, fuente: "Tablas Peruanas de Composición de Alimentos 2017 (INS/CENAN)" };
}

module.exports = { buscarNutricion };
