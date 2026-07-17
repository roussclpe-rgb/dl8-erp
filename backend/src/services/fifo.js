const { db } = require("../db");

// Orden de consumo: primero lo que vence antes (si tiene fecha de vencimiento),
// y entre lo que no vence o vence lo mismo, FIFO por fecha de compra.
// Esto es más realista para panadería que un FIFO puro: no sirve de nada
// gastar primero lo que compraste hace más tiempo si lo que vence antes
// es harina que compraste ayer.
function lotesDisponibles(ingredienteId) {
  return db.prepare(`
    SELECT * FROM lotes_compra
    WHERE ingrediente_id = ? AND cantidad_restante > 0 AND anulado = 0
    ORDER BY
      CASE WHEN fecha_vencimiento IS NULL THEN 1 ELSE 0 END,
      fecha_vencimiento ASC,
      fecha_compra ASC
  `).all(ingredienteId);
}

function stockIngrediente(ingredienteId) {
  const row = db.prepare(`
    SELECT COALESCE(SUM(cantidad_restante), 0) AS stock FROM lotes_compra
    WHERE ingrediente_id = ? AND anulado = 0
  `).get(ingredienteId);
  return row.stock;
}

function costoPromedioActual(ingredienteId) {
  const row = db.prepare(`
    SELECT COALESCE(SUM(cantidad_restante * costo_unidad_base), 0) AS suma, COALESCE(SUM(cantidad_restante), 0) AS total
    FROM lotes_compra WHERE ingrediente_id = ? AND cantidad_restante > 0 AND anulado = 0
  `).get(ingredienteId);
  return row.total > 0 ? row.suma / row.total : 0;
}

const updLote = db.prepare("UPDATE lotes_compra SET cantidad_restante = ? WHERE id = ?");
const insMov = db.prepare(`
  INSERT INTO movimientos_inventario
    (ingrediente_id, tipo, cantidad_base, costo_unidad_base, referencia_tipo, referencia_id, motivo, usuario_id, fecha, periodo_id)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

// Consume `cantidadBase` del ingrediente, registrando un movimiento por cada
// lote tocado (para trazabilidad exacta de costo). Devuelve el detalle para
// poder revertirlo después si la producción/ajuste se edita o anula.
// Envuelto en db.transaction: si un lote a mitad de camino falla, no queda
// un consumo parcial huérfano (todo o nada).
const consumir = db.transaction(({ ingredienteId, cantidadBase, tipo, motivo, referenciaTipo, referenciaId, usuarioId, fecha, periodoId }) => {
  let necesario = cantidadBase;
  let costoTotal = 0;
  const consumos = [];
  const lotes = lotesDisponibles(ingredienteId);

  for (const lote of lotes) {
    if (necesario <= 0) break;
    const tomar = Math.min(lote.cantidad_restante, necesario);
    if (tomar <= 0) continue;
    const nuevoRestante = lote.cantidad_restante - tomar;
    updLote.run(nuevoRestante, lote.id);
    insMov.run(ingredienteId, tipo, -tomar, lote.costo_unidad_base, referenciaTipo, referenciaId, motivo, usuarioId, fecha, periodoId);
    costoTotal += tomar * lote.costo_unidad_base;
    necesario -= tomar;
    consumos.push({ loteId: lote.id, cantidad: tomar, costoUnidadBase: lote.costo_unidad_base });
  }

  return { costoTotal, faltante: necesario, consumos };
});

const insMovReversion = db.prepare(`
  INSERT INTO movimientos_inventario
    (ingrediente_id, tipo, cantidad_base, costo_unidad_base, referencia_tipo, referencia_id, motivo, usuario_id, fecha, periodo_id)
  VALUES (?, 'reversion', ?, ?, ?, ?, ?, ?, ?, ?)
`);
const getLote = db.prepare("SELECT * FROM lotes_compra WHERE id = ?");

// Revierte un consumo previo (usado al editar/anular una producción o ajuste):
// regresa cantidad a los lotes y deja un rastro explícito de la reversión
// (NUNCA borra ni edita los movimientos originales).
const revertir = db.transaction(({ consumos, ingredienteId, referenciaTipo, referenciaId, usuarioId, fecha, periodoId, motivo }) => {
  for (const c of consumos) {
    const lote = getLote.get(c.loteId);
    if (!lote) continue; // el lote pudo haber sido desactivado; se registra igual el movimiento monetario
    updLote.run(lote.cantidad_restante + c.cantidad, lote.id);
    insMovReversion.run(ingredienteId, c.cantidad, c.costoUnidadBase, referenciaTipo, referenciaId, motivo || "Reversión por edición/anulación", usuarioId, fecha, periodoId);
  }
});

// Agrega stock "de la nada" (conteo físico encontró más de lo esperado) al
// costo promedio actual, dejando motivo obligatorio en la bitácora.
const agregarPorConteo = db.transaction(({ ingredienteId, cantidadBase, motivo, usuarioId, fecha, periodoId }) => {
  const costoProm = costoPromedioActual(ingredienteId);
  const info = db.prepare(`
    INSERT INTO lotes_compra
      (ingrediente_id, proveedor_id, periodo_id, fecha_compra, fecha_vencimiento, presentacion,
       cantidad_comprada, unidad_compra, contenido_por_presentacion, cantidad_total_base, cantidad_restante,
       costo_total, costo_unidad_base, usuario_id)
    VALUES (?, NULL, ?, ?, NULL, ?, ?, 'unidad_base', 1, ?, ?, ?, ?, ?)
  `).run(
    ingredienteId, periodoId, fecha, `Ajuste por conteo — ${motivo}`,
    cantidadBase, cantidadBase, cantidadBase, cantidadBase * costoProm, costoProm, usuarioId
  );
  db.prepare(`
    INSERT INTO movimientos_inventario
      (ingrediente_id, tipo, cantidad_base, costo_unidad_base, referencia_tipo, referencia_id, motivo, usuario_id, fecha, periodo_id)
    VALUES (?, 'conteo_sobra', ?, ?, 'lote_compra', ?, ?, ?, ?, ?)
  `).run(ingredienteId, cantidadBase, costoProm, info.lastInsertRowid, motivo, usuarioId, fecha, periodoId);
  return info.lastInsertRowid;
});

const agregarInventarioInicial = db.transaction(({ ingredienteId, cantidadBase, costoTotal, motivo, usuarioId, fecha, periodoId }) => {
  const costoUnidad = Number(costoTotal) / Number(cantidadBase);
  const info = db.prepare(`INSERT INTO lotes_compra
    (ingrediente_id, proveedor_id, periodo_id, fecha_compra, fecha_vencimiento, presentacion, cantidad_comprada, unidad_compra, contenido_por_presentacion, cantidad_total_base, cantidad_restante, costo_total, costo_unidad_base, usuario_id)
    VALUES (?, NULL, ?, ?, NULL, ?, ?, 'unidad_base', 1, ?, ?, ?, ?, ?)`)
    .run(ingredienteId, periodoId, fecha, `Inventario inicial — ${motivo}`, cantidadBase, cantidadBase, cantidadBase, costoTotal, costoUnidad, usuarioId);
  db.prepare(`INSERT INTO movimientos_inventario(ingrediente_id,tipo,cantidad_base,costo_unidad_base,referencia_tipo,referencia_id,motivo,usuario_id,fecha,periodo_id)
    VALUES(?,'inventario_inicial',?,?,'lote_compra',?,?,?, ?,?)`)
    .run(ingredienteId, cantidadBase, costoUnidad, info.lastInsertRowid, motivo, usuarioId, fecha, periodoId);
  return info.lastInsertRowid;
});

module.exports = { lotesDisponibles, stockIngrediente, costoPromedioActual, consumir, revertir, agregarPorConteo, agregarInventarioInicial };
