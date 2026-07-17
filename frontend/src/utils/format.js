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

export function fechaISO(fecha = new Date()) {
  // `toISOString` uses UTC and can advance the calendar date in Peru.
  const anio = fecha.getFullYear();
  const mes = String(fecha.getMonth() + 1).padStart(2, "0");
  const dia = String(fecha.getDate()).padStart(2, "0");
  return `${anio}-${mes}-${dia}`;
}

export function fechaHoyISO() {
  return fechaISO();
}
