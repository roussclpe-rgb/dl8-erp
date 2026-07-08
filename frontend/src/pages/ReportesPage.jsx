import { useEffect, useState, useCallback } from "react";
import { Box, Tabs, Tab, Paper, Grid, TextField, Button, Stack, Typography } from "@mui/material";

import PageHeader from "../components/PageHeader";
import DataTable from "../components/DataTable";
import StatusChip from "../components/StatusChip";
import { useNotify } from "../hooks/useNotify";
import { formatoMoneda, formatoNumero, formatoFecha } from "../utils/format";
import { reporteValorizacion, reporteMermas, reporteRotacion, reporteSugerenciasCompra } from "../api/endpoints";

function TabPanel({ value, index, children }) {
  return value === index ? <Box sx={{ mt: 2.5 }}>{children}</Box> : null;
}

export default function ReportesPage() {
  const notify = useNotify();
  const [tab, setTab] = useState(0);

  // Valorización
  const [valorizacion, setValorizacion] = useState({ items: [], valorTotal: 0 });
  const [loadingVal, setLoadingVal] = useState(true);

  // Mermas
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [mermas, setMermas] = useState([]);
  const [loadingMer, setLoadingMer] = useState(true);

  // Rotación
  const [dias, setDias] = useState(30);
  const [rotacion, setRotacion] = useState([]);
  const [loadingRot, setLoadingRot] = useState(true);

  // Sugerencias
  const [sugerencias, setSugerencias] = useState([]);
  const [loadingSug, setLoadingSug] = useState(true);

  const cargarValorizacion = useCallback(async () => {
    setLoadingVal(true);
    try {
      setValorizacion(await reporteValorizacion());
    } catch (e) {
      notify.error(e);
    } finally {
      setLoadingVal(false);
    }
  }, [notify]);

  const cargarMermas = useCallback(
    async (d, h) => {
      setLoadingMer(true);
      try {
        setMermas(await reporteMermas(d || undefined, h || undefined));
      } catch (e) {
        notify.error(e);
      } finally {
        setLoadingMer(false);
      }
    },
    [notify]
  );

  const cargarRotacion = useCallback(
    async (d) => {
      setLoadingRot(true);
      try {
        setRotacion(await reporteRotacion(d));
      } catch (e) {
        notify.error(e);
      } finally {
        setLoadingRot(false);
      }
    },
    [notify]
  );

  const cargarSugerencias = useCallback(async () => {
    setLoadingSug(true);
    try {
      setSugerencias(await reporteSugerenciasCompra());
    } catch (e) {
      notify.error(e);
    } finally {
      setLoadingSug(false);
    }
  }, [notify]);

  useEffect(() => {
    cargarValorizacion();
    cargarMermas("", "");
    cargarRotacion(30);
    cargarSugerencias();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Box>
      <PageHeader title="Reportes" subtitle="Valorización, mermas, rotación y sugerencias de compra." />

      <Paper variant="outlined" sx={{ borderRadius: 3 }}>
        <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ px: 2, borderBottom: "1px solid", borderColor: "divider" }}>
          <Tab label="Valorización de inventario" />
          <Tab label="Mermas" />
          <Tab label="Rotación" />
          <Tab label="Sugerencias de compra" />
        </Tabs>

        <Box sx={{ p: 2.5 }}>
          <TabPanel value={tab} index={0}>
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
              <Typography variant="body2" color="text.secondary">
                Valor total a costo FIFO real.
              </Typography>
              <Typography variant="h5" sx={{ fontWeight: 700 }}>
                {formatoMoneda(valorizacion.valorTotal)}
              </Typography>
            </Stack>
            <DataTable
              loading={loadingVal}
              searchPlaceholder="Buscar ingrediente…"
              defaultOrderBy="valor"
              defaultOrder="desc"
              columns={[
                { field: "nombre", headerName: "Ingrediente", minWidth: 160 },
                { field: "stock", headerName: "Stock", align: "right", renderCell: (r) => `${formatoNumero(r.stock)} ${r.unidad_base}` },
                { field: "valor", headerName: "Valor", align: "right", renderCell: (r) => formatoMoneda(r.valor) },
              ]}
              rows={valorizacion.items}
            />
          </TabPanel>

          <TabPanel value={tab} index={1}>
            <Grid container spacing={2} alignItems="center" sx={{ mb: 2 }}>
              <Grid item xs={6} sm={3}>
                <TextField label="Desde" type="date" size="small" fullWidth InputLabelProps={{ shrink: true }} value={desde} onChange={(e) => setDesde(e.target.value)} />
              </Grid>
              <Grid item xs={6} sm={3}>
                <TextField label="Hasta" type="date" size="small" fullWidth InputLabelProps={{ shrink: true }} value={hasta} onChange={(e) => setHasta(e.target.value)} />
              </Grid>
              <Grid item xs={12} sm={3}>
                <Button variant="outlined" onClick={() => cargarMermas(desde, hasta)}>
                  Filtrar
                </Button>
              </Grid>
            </Grid>
            <DataTable
              loading={loadingMer}
              searchPlaceholder="Buscar por ítem o motivo…"
              defaultOrderBy="fecha"
              defaultOrder="desc"
              getRowId={(r) => `${r.fecha}-${r.item}-${r.motivo}`}
              columns={[
                { field: "fecha", headerName: "Fecha", renderCell: (r) => formatoFecha(r.fecha) },
                { field: "item", headerName: "Ítem", minWidth: 160 },
                {
                  field: "clase",
                  headerName: "Clase",
                  align: "center",
                  renderCell: (r) => <StatusChip label={r.clase === "ingrediente" ? "Ingrediente" : "Producto"} tone={r.clase === "ingrediente" ? "warning" : "error"} />,
                },
                { field: "cantidad", headerName: "Cantidad", align: "right", renderCell: (r) => formatoNumero(r.cantidad) },
                { field: "motivo", headerName: "Motivo", minWidth: 200 },
                { field: "costo_estimado", headerName: "Costo est.", align: "right", renderCell: (r) => (r.costo_estimado !== null ? formatoMoneda(r.costo_estimado) : "—") },
              ]}
              rows={mermas}
            />
          </TabPanel>

          <TabPanel value={tab} index={2}>
            <Grid container spacing={2} alignItems="center" sx={{ mb: 2 }}>
              <Grid item xs={6} sm={3}>
                <TextField label="Días" type="number" size="small" fullWidth value={dias} onChange={(e) => setDias(e.target.value)} />
              </Grid>
              <Grid item xs={12} sm={3}>
                <Button variant="outlined" onClick={() => cargarRotacion(dias)}>
                  Recalcular
                </Button>
              </Grid>
            </Grid>
            <DataTable
              loading={loadingRot}
              searchPlaceholder="Buscar ingrediente…"
              defaultOrderBy="consumido"
              defaultOrder="desc"
              getRowId={(r) => r.nombre}
              columns={[
                { field: "nombre", headerName: "Ingrediente", minWidth: 160 },
                { field: "consumido", headerName: "Consumido", align: "right", renderCell: (r) => `${formatoNumero(r.consumido)} ${r.unidad_base}` },
              ]}
              rows={rotacion}
            />
          </TabPanel>

          <TabPanel value={tab} index={3}>
            <DataTable
              loading={loadingSug}
              searchPlaceholder="Buscar ingrediente…"
              defaultOrderBy="cantidadSugerida"
              defaultOrder="desc"
              getRowId={(r) => r.ingredienteId}
              columns={[
                { field: "nombre", headerName: "Ingrediente", minWidth: 160 },
                { field: "stockActual", headerName: "Stock actual", align: "right", renderCell: (r) => `${formatoNumero(r.stockActual)} ${r.unidadBase}` },
                { field: "consumoDiarioPromedio", headerName: "Consumo/día", align: "right", renderCell: (r) => formatoNumero(r.consumoDiarioPromedio) },
                { field: "diasCoberturaDeseados", headerName: "Cobertura deseada", align: "right", renderCell: (r) => `${r.diasCoberturaDeseados} días` },
                { field: "cantidadSugerida", headerName: "Comprar", align: "right", renderCell: (r) => `${formatoNumero(r.cantidadSugerida)} ${r.unidadBase}` },
                {
                  field: "bajoMinimo",
                  headerName: "Estado",
                  align: "center",
                  renderCell: (r) => (r.bajoMinimo ? <StatusChip label="Bajo mínimo" tone="error" /> : <StatusChip label="Cobertura baja" tone="warning" />),
                },
              ]}
              rows={sugerencias}
            />
          </TabPanel>
        </Box>
      </Paper>
    </Box>
  );
}
