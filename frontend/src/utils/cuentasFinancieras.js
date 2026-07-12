export const PROVEEDORES_POR_TIPO = {
  caja: [{ value: "efectivo", label: "Efectivo" }],
  banco: [{ value: "banco", label: "Banco" }],
  billetera: [{ value: "yape", label: "Yape" }, { value: "plin", label: "Plin" }, { value: "otra_billetera", label: "Otra billetera" }],
  procesador: [{ value: "procesador", label: "Procesador de tarjetas" }, { value: "otro", label: "Otro procesador" }],
  custodia_tercero: [{ value: "custodia_tercero", label: "Custodia de tercero" }, { value: "otro", label: "Otro" }],
  transito: [{ value: "transito", label: "Fondos en tránsito" }, { value: "otro", label: "Otro" }],
};

const METODO = {
  Efectivo: { tipo: "caja", proveedor: "efectivo" }, Yape: { tipo: "billetera", proveedor: "yape" },
  Plin: { tipo: "billetera", proveedor: "plin" }, Transferencia: { tipo: "banco", proveedor: "banco" },
  Tarjeta: { tipo: "procesador" },
};

export function cuentaCompatibleConMetodo(cuenta, metodo) {
  const esperado = METODO[metodo];
  return Boolean(esperado && cuenta.tipo === esperado.tipo && (!esperado.proveedor || cuenta.proveedor === esperado.proveedor));
}

export function proveedorPredeterminado(tipo) {
  return PROVEEDORES_POR_TIPO[tipo]?.[0]?.value || "otro";
}
