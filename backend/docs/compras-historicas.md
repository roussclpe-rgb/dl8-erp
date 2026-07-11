# Compatibilidad histórica de Compras

Una compra histórica es un lote de `lotes_compra` que no tiene un registro asociado en `fin_documentos_cxp`. Se conserva como evidencia operativa e inventario existente, sin inferir deuda ni crear efectos financieros retroactivos.

## Criterio operativo

- `GET /api/compras` expone exclusivamente compras financieras: cada fila tiene CxP y su emisión financiera.
- `GET /api/compras/historicas` expone exclusivamente lotes sin CxP y los marca con `historico: true`.
- Las compras históricas pueden editarse por la ruta legacy mientras no tengan CxP.
- Las compras financieras se bloquean en las rutas legacy de edición.
- `costo_total` histórico describe el costo de inventario, no un saldo pendiente. Por ello no se calcula CxP, tesorería, evento, asiento ni saldo desde dicho campo.

## Migración futura

Una migración financiera deberá definirse por una fecha de corte. En esa fecha se registrarán saldos iniciales conciliados por proveedor, con sus documentos de apertura y contrapartidas explícitas en el Motor Financiero. No se debe convertir automáticamente cada compra histórica ni deducir su saldo desde `costo_total`.
