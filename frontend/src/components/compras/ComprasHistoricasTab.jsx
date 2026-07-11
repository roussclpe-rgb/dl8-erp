import { useCallback, useEffect, useState } from "react";
import { Alert, Box, Grid, IconButton, MenuItem, Stack, TextField, Tooltip } from "@mui/material";
import EditIcon from "@mui/icons-material/EditOutlined";
import DataTable from "../DataTable";
import { listarComprasHistoricas } from "../../api/endpoints";
import { useAuth } from "../../context/AuthContext";
import { useNotify } from "../../hooks/useNotify";
import { formatoFecha, formatoNumero } from "../../utils/format";

export default function ComprasHistoricasTab({ proveedores, ingredientes, onEdit, refreshKey }) {
  const { hasRole } = useAuth();
  const notify = useNotify();
  const [proveedorId, setProveedorId] = useState("");
  const [ingredienteId, setIngredienteId] = useState("");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await listarComprasHistoricas({ proveedor_id: proveedorId || undefined, ingrediente_id: ingredienteId || undefined, fecha_desde: desde || undefined, fecha_hasta: hasta || undefined }));
    } catch (error) {
      notify.error(error);
    } finally {
      setLoading(false);
    }
  }, [proveedorId, ingredienteId, desde, hasta, notify]);
  useEffect(() => { cargar(); }, [cargar, refreshKey]);
  const puedeEditar = hasRole("admin", "operador");
  const columns = [
    { field: "fecha_compra", headerName: "Fecha", renderCell: (r) => formatoFecha(r.fecha_compra) },
    { field: "ingrediente_nombre", headerName: "Ingrediente", minWidth: 170 },
    { field: "proveedor_nombre", headerName: "Proveedor", minWidth: 170, renderCell: (r) => r.proveedor_nombre || "Sin proveedor" },
    { field: "cantidad_restante", headerName: "Inventario disponible", align: "right", renderCell: (r) => `${formatoNumero(r.cantidad_restante)} ${r.unidad_base}` },
    { field: "costo_total", headerName: "Costo histórico", align: "right", renderCell: (r) => formatoNumero(r.costo_total) },
    { field: "acciones", headerName: "Acciones", align: "right", sortable: false, renderCell: (r) => puedeEditar && <Tooltip title="Editar compra histórica"><IconButton size="small" onClick={() => onEdit(r)}><EditIcon fontSize="small" /></IconButton></Tooltip> },
  ];
  return <Box>
    <Alert severity="warning" sx={{ mb: 2 }}>Estas compras no tienen CxP ni saldo financiero inferible: <b>costo_total</b> representa costo de inventario, no deuda pendiente. La futura migración se hará por fecha de corte y saldos iniciales por proveedor.</Alert>
    <Grid container spacing={1.5} sx={{ mb: 2 }}>
      <Grid item xs={12} sm={3}><TextField select fullWidth label="Proveedor" value={proveedorId} onChange={(e) => setProveedorId(e.target.value)}><MenuItem value="">Todos</MenuItem>{proveedores.map((p) => <MenuItem key={p.id} value={p.id}>{p.nombre}</MenuItem>)}</TextField></Grid>
      <Grid item xs={12} sm={3}><TextField select fullWidth label="Ingrediente" value={ingredienteId} onChange={(e) => setIngredienteId(e.target.value)}><MenuItem value="">Todos</MenuItem>{ingredientes.map((i) => <MenuItem key={i.id} value={i.id}>{i.nombre}</MenuItem>)}</TextField></Grid>
      <Grid item xs={6} sm={3}><TextField fullWidth type="date" label="Desde" InputLabelProps={{ shrink: true }} value={desde} onChange={(e) => setDesde(e.target.value)} /></Grid>
      <Grid item xs={6} sm={3}><TextField fullWidth type="date" label="Hasta" InputLabelProps={{ shrink: true }} value={hasta} onChange={(e) => setHasta(e.target.value)} /></Grid>
    </Grid>
    <DataTable columns={columns} rows={rows} loading={loading} searchPlaceholder="Buscar compra histórica…" defaultOrderBy="fecha_compra" defaultOrder="desc" />
  </Box>;
}
