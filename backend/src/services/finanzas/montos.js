const ERROR_MONTO = "El importe financiero es inválido";

// Regla única: conversión decimal a céntimos PEN con redondeo half-up.
// El núcleo financiero recibe únicamente enteros en unidades menores.
function aMinorPEN(valor) {
  const texto = String(valor ?? "").trim();
  if (!/^\d+(?:\.\d+)?$/.test(texto)) throw Object.assign(new Error(ERROR_MONTO), { status: 400 });
  const [enteros, fraccion = ""] = texto.split(".");
  const base = BigInt(enteros) * 100n + BigInt((fraccion + "00").slice(0, 2));
  const tercerDecimal = Number(fraccion[2] || "0");
  const minor = base + BigInt(tercerDecimal >= 5 ? 1 : 0);
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) throw Object.assign(new Error(ERROR_MONTO), { status: 400 });
  return Number(minor);
}

module.exports = { aMinorPEN };
