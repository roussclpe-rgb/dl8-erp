const crypto = require("crypto");

function canonizar(valor) {
  if (Array.isArray(valor)) return valor.map(canonizar);
  if (valor && typeof valor === "object") {
    return Object.keys(valor).sort().reduce((resultado, clave) => {
      if (valor[clave] !== undefined) resultado[clave] = canonizar(valor[clave]);
      return resultado;
    }, {});
  }
  return valor;
}

function hashCanonico(valor) {
  return crypto.createHash("sha256").update(JSON.stringify(canonizar(valor))).digest("hex");
}

module.exports = { canonizar, hashCanonico };
