import { useEffect, useState, useCallback } from "react";
import { Box, Grid, TextField, MenuItem, Button, Typography } from "@mui/material";

import DataTable from "../DataTable";
import StatusChip from "../StatusChip";
import TurnoDetalleDialog from "./TurnoDetalleDialog";
import { useNotify } from "../../hooks/useNotify";
import { formatoMoneda, formatoFecha } from "../../utils/format";
import { listarTurnosCaja, listarCajas } from "../../api/endpoints";

export default function HistorialTurnosTab() {
  const notify = useNotify();
  const [rows, setRows] = useState([]);
  const [cajas, setCajas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [cajaId, setCajaId] = useState("");
  const [turnoDetalle, setTurnoDetalle] = useState(null);

  const cargar = useCallback(
    async (d, h, c) => {
      setLoading(true);
      try {
        setRows(await listarTurnosCaja({ desde: d || undefined, hasta: h || undefined, caja_id: c || undefined }));
      } catch (e) {
        notify.error(e);
      } finally {
        setLoading(false);
      }
    },
    [notify]
  );

  useEffect(() => {
    listarCajas().then(setCajas).catch(() => setCajas([]));
    cargar("", "", "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const columns = [
    { field: "caja_nombre", headerName: "Caja", minWidth: 140 },
    { field: "fecha_apertura", headerName: "Apertura", renderCell: (r) => formatoFecha(r.fecha_apertura) },
    { field: "fecha_cierre", headerName: "Cierre", renderCell: (r) => (r.fecha_cierre ? formatoFecha(r.fecha_cierre) : "—") },
    {
      field: "estado",
      headerName: "Estado",
      align: "center",
      renderCell: (r) => (r.estado === "abierto" ? <StatusChip label="Abierto" tone="success" /> : <StatusChip label="Cerrado" tone="default" />),
    },
    { field: "monto_apertura", headerName: "Apertura", align: "right", renderCell: (r) => formatoMoneda(r.monto_apertura) },
    {
      field: "diferencia",
      headerName: "Diferencia",
      align: "right",
      renderCell: (r) =>
        r.diferencia === null || r.diferencia === undefined ? (
          "—"
        ) : (
          <Typography variant="body2" color={Math.abs(r.diferencia) < 0.01 ? "success.main" : "error.main"} sx={{ fontWeight: 600 }}>
            {formatoMoneda(r.diferencia)}
          </Typography>
        ),
    },
    { field: "usuario_apertura_nombre", headerName: "Abierto por" },
  ];

  return (
    <Box>
      <Grid container spacing={2} alignItems="center" sx={{ mb: 2 }}>
        <Grid item xs={12} sm={3}>
          <TextField select label="Caja" fullWidth size="small" value={cajaId} onChange={(e) => setCajaId(e.target.value)}>
            <MenuItem value="">Todas</MenuItem>
            {cajas.map((c) => (
              <MenuItem key={c.id} value={c.id}>
                {c.nombre}
              </MenuItem>
            ))}
          </TextField>
        </Grid>
        <Grid item xs={6} sm={3}>
          <TextField label="Desde" type="date" size="small" fullWidth InputLabelProps={{ shrink: true }} value={desde} onChange={(e) => setDesde(e.target.value)} />
        </Grid>
        <Grid item xs={6} sm={3}>
          <TextField label="Hasta" type="date" size="small" fullWidth InputLabelProps={{ shrink: true }} value={hasta} onChange={(e) => setHasta(e.target.value)} />
        </Grid>
        <Grid item xs={12} sm={3}>
          <Button variant="outlined" fullWidth onClick={() => cargar(desde, hasta, cajaId)}>
            Filtrar
          </Button>
        </Grid>
      </Grid>

      <DataTable
        columns={columns}
        rows={rows}
        loading={loading}
        searchPlaceholder="Buscar por caja o usuario…"
        defaultOrderBy="fecha_apertura"
        defaultOrder="desc"
        onRowClick={(r) => setTurnoDetalle(r.id)}
        emptyMessage="Sin turnos registrados en este rango."
      />

      <TurnoDetalleDialog turnoId={turnoDetalle} onClose={() => setTurnoDetalle(null)} />
    </Box>
  );
}
