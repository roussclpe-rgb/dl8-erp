const PROVEEDORES_POR_TIPO = {
  caja: ["efectivo"],
  banco: ["banco"],
  billetera: ["yape", "plin", "otra_billetera", "otro"],
  procesador: ["procesador", "otro"],
  custodia_tercero: ["custodia_tercero", "otro"],
  transito: ["transito", "otro"],
};

const PREDETERMINADO_POR_TIPO = {
  caja: "efectivo",
  banco: "banco",
  billetera: "otra_billetera",
  procesador: "procesador",
  custodia_tercero: "custodia_tercero",
  transito: "transito",
};

const METODOS = {
  Efectivo: { tipo: "caja", proveedor: "efectivo" },
  Yape: { tipo: "billetera", proveedor: "yape" },
  Plin: { tipo: "billetera", proveedor: "plin" },
  Transferencia: { tipo: "banco", proveedor: "banco" },
  Tarjeta: { tipo: "procesador", proveedor: null },
};

function normalizarProveedor(tipo, proveedor) {
  const valor = String(proveedor || PREDETERMINADO_POR_TIPO[tipo] || "").trim().toLowerCase();
  if (!PROVEEDORES_POR_TIPO[tipo]?.includes(valor)) {
    const error = new Error("El proveedor no es compatible con el tipo de cuenta financiera");
    error.status = 400;
    throw error;
  }
  return valor;
}

function compatibilidadMetodo(metodoPago) {
  const compatibilidad = METODOS[metodoPago];
  if (!compatibilidad) {
    const error = new Error("Método de pago no soportado");
    error.status = 400;
    throw error;
  }
  return compatibilidad;
}

function cuentaCompatible(cuenta, metodoPago) {
  const esperado = compatibilidadMetodo(metodoPago);
  return cuenta?.tipo === esperado.tipo && (!esperado.proveedor || cuenta.proveedor === esperado.proveedor);
}

module.exports = { METODOS, PREDETERMINADO_POR_TIPO, PROVEEDORES_POR_TIPO, compatibilidadMetodo, cuentaCompatible, normalizarProveedor };
