import { useEffect, useState } from "react";
import { Box, Grid, Typography, Stack, Chip, Divider, CircularProgress } from "@mui/material";

import FormDialog from "../FormDialog";
import DataTable from "../DataTable";
import StatusChip from "../StatusChip";
import { useNotify } from "../../hooks/useNotify";
import { formatoMoneda, formatoFecha } from "../../utils/format";
import { obtenerTurnoCaja } from "../../api/endpoints";

const TIPO_LABEL = { apertura: "Apertura", venta: "Venta", cobro: "Cobro", ingreso: "Ingreso", egreso: "Egreso", cierre: "Cierre" };
const TIPO_TONO = { apertura: "info", venta: "success", cobro: "success", ingreso: "success", egreso: "warning", cierre: "default" };

export default function TurnoDetalleDialog({ turnoId, onClose }) {
  const notify = useNotify();
  const [turno, setTurno] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!turnoId) {
      setTurno(null);
      return;
    }
    setLoading(true);
    obtenerTurnoCaja(turnoId)
      .then(setTurno)
      .catch((e) => notify.error(e))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turnoId]);

  const columns = [
    { field: "fecha", headerName: "Fecha", renderCell: (r) => formatoFecha(r.fecha) },
    { field: "tipo", headerName: "Tipo", renderCell: (r) => <StatusChip label={TIPO_LABEL[r.tipo] || r.tipo} tone={TIPO_TONO[r.tipo] || "default"} /> },
    { field: "metodo_pago", headerName: "Método", renderCell: (r) => r.metodo_pago || "—" },
    {
      field: "monto",
      headerName: "Monto",
      align: "right",
      renderCell: (r) => (
        <Typography variant="body2" color={r.monto < 0 ? "error.main" : "success.main"} sx={{ fontWeight: 600 }}>
          {r.monto < 0 ? "-" : "+"}
          {formatoMoneda(Math.abs(r.monto))}
        </Typography>
      ),
    },
    { field: "motivo", headerName: "Motivo", minWidth: 200, renderCell: (r) => r.motivo || "—" },
    { field: "usuario_nombre", headerName: "Registrado por" },
  ];

  return (
    <FormDialog open={!!turnoId} onClose={onClose} title={turno ? `Turno — ${turno.caja_nombre}` : "Turno"} maxWidth="md">
      {loading || !turno ? (
        <Box sx={{ py: 6, textAlign: "center" }}>
          <CircularProgress size={28} />
        </Box>
      ) : (
        <Box>
          <Grid container spacing={2} sx={{ mb: 2 }}>
            <Grid item xs={6} sm={3}>
              <Typography variant="caption" color="text.secondary">
                Apertura
              </Typography>
              <Typography variant="body2">{formatoFecha(turno.fecha_apertura)}</Typography>
            </Grid>
            <Grid item xs={6} sm={3}>
              <Typography variant="caption" color="text.secondary">
                Cierre
              </Typography>
              <Typography variant="body2">{turno.fecha_cierre ? formatoFecha(turno.fecha_cierre) : "—"}</Typography>
            </Grid>
            <Grid item xs={6} sm={3}>
              <Typography variant="caption" color="text.secondary">
                Apertura / usuario
              </Typography>
              <Typography variant="body2">{turno.usuario_apertura_nombre}</Typography>
            </Grid>
            <Grid item xs={6} sm={3}>
              <Typography variant="caption" color="text.secondary">
                Cierre / usuario
              </Typography>
              <Typography variant="body2">{turno.usuario_cierre_nombre || "—"}</Typography>
            </Grid>
          </Grid>

          {turno.estado === "cerrado" && (
            <>
              <Divider sx={{ mb: 2 }} />
              <Grid container spacing={2} sx={{ mb: 2 }}>
                <Grid item xs={4}>
                  <Typography variant="caption" color="text.secondary">
                    Esperado
                  </Typography>
                  <Typography variant="subtitle1">{formatoMoneda(turno.monto_cierre_esperado)}</Typography>
                </Grid>
                <Grid item xs={4}>
                  <Typography variant="caption" color="text.secondary">
                    Contado
                  </Typography>
                  <Typography variant="subtitle1">{formatoMoneda(turno.monto_cierre_contado)}</Typography>
                </Grid>
                <Grid item xs={4}>
                  <Typography variant="caption" color="text.secondary">
                    Diferencia
                  </Typography>
                  <Typography variant="subtitle1" color={Math.abs(turno.diferencia) < 0.01 ? "success.main" : "error.main"}>
                    {formatoMoneda(turno.diferencia)}
                  </Typography>
                </Grid>
              </Grid>
            </>
          )}

          <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap sx={{ mb: 2 }}>
            {Object.entries(turno.porMetodo || {}).map(([metodo, monto]) => (
              <Chip key={metodo} size="small" label={`${metodo}: ${formatoMoneda(monto)}`} variant="outlined" />
            ))}
          </Stack>

          <DataTable
            columns={columns}
            rows={turno.movimientos || []}
            searchable={false}
            defaultOrderBy="fecha"
            emptyMessage="Sin movimientos."
            rowsPerPageOptions={[10, 25]}
          />
        </Box>
      )}
    </FormDialog>
  );
}
