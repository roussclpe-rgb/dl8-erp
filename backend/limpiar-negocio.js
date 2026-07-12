const Database = require("better-sqlite3");

const db = new Database("data.sqlite");

const tablasALimpiar = [
  "fin_aplicaciones_cxc",
  "fin_cobros",
  "fin_documentos_cxc",
  "fin_lineas_asiento",
  "fin_asientos_contables",
  "fin_movimientos_tesoreria",
  "fin_asignaciones_bolsillo",
  "fin_eventos_por_entidad",
  "fin_eventos_financieros",
  "fin_claves_idempotencia",
  "fin_auditoria",

  "pagos_claves_idempotencia",
  "ventas_claves_idempotencia",
  "pagos",
  "venta_items",
  "ventas",

  "movimientos_caja",
  "turnos_caja",
  "cajas",

  "mermas_producto",
  "producciones",

  "movimientos_inventario",
  "lotes_compra",

  "receta_items",
  "recetas",
  "productos_venta",
  "ingredientes",

  "clientes",
  "proveedores",

  "log_auditoria"
];

try {
  db.pragma("foreign_keys = OFF");

  const limpiar = db.transaction(() => {
    for (const tabla of tablasALimpiar) {
      const existe = db
        .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
        .get(tabla);

      if (existe) {
        db.prepare(`DELETE FROM "${tabla}"`).run();
        console.log(`Limpiada: ${tabla}`);
      }
    }

    const tieneSecuencia = db
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='sqlite_sequence'")
      .get();

    if (tieneSecuencia) {
      const borrarSecuencia = db.prepare(
        "DELETE FROM sqlite_sequence WHERE name = ?"
      );

      for (const tabla of tablasALimpiar) {
        borrarSecuencia.run(tabla);
      }
    }
  });

  limpiar();

  db.pragma("foreign_keys = ON");

  const integridad = db.prepare("PRAGMA integrity_check").get();

  console.log("");
  console.log("Resultado de integridad:", integridad.integrity_check);
  console.log("Datos del negocio eliminados correctamente.");
  console.log("Se conservaron usuarios, roles y estructura del sistema.");
} catch (error) {
  console.error("No se pudo completar la limpieza:", error.message);
  process.exitCode = 1;
} finally {
  db.close();
}
