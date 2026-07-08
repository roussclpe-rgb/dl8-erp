const numberFormatter = new Intl.NumberFormat("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function formatoMoneda(valor) {
  if (valor === null || valor === undefined || Number.isNaN(valor)) return "S/ 0.00";
  return `S/ ${numberFormatter.format(valor)}`;
}

export function formatoNumero(valor, decimales = 2) {
  if (valor === null || valor === undefined || Number.isNaN(valor)) return "0";
  return new Intl.NumberFormat("es-PE", { minimumFractionDigits: 0, maximumFractionDigits: decimales }).format(valor);
}

export function formatoFecha(fechaISO) {
  if (!fechaISO) return "—";
  const f = new Date(fechaISO.length === 10 ? `${fechaISO}T00:00:00` : fechaISO);
  if (Number.isNaN(f.getTime())) return fechaISO;
  return f.toLocaleDateString("es-PE", { year: "numeric", month: "short", day: "2-digit" });
}

export function fechaHoyISO() {
  return new Date().toISOString().slice(0, 10);
}
