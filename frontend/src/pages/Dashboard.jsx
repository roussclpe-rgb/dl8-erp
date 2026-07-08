import { useEffect, useState } from "react";
import { Grid, Paper, Typography, Box, Stack, Chip } from "@mui/material";
import InventoryIcon from "@mui/icons-material/Inventory2Outlined";
import WarningAmberIcon from "@mui/icons-material/WarningAmberOutlined";
import ShoppingCartIcon from "@mui/icons-material/ShoppingCartOutlined";
import PrecisionManufacturingIcon from "@mui/icons-material/PrecisionManufacturingOutlined";
import EventNoteIcon from "@mui/icons-material/EventNoteOutlined";

import KpiCard from "../components/KpiCard";
import DataTable from "../components/DataTable";
import StatusChip from "../components/StatusChip";
import { useNotify } from "../hooks/useNotify";
import { formatoMoneda, formatoNumero, formatoFecha } from "../utils/format";
import {
  reporteValorizacion,
  reporteSugerenciasCompra,
  reporteMermas,
  listarIngredientes,
  listarProducciones,
  listarPeriodos,
} from "../api/endpoints";

export default function Dashboard() {
  const notify = useNotify();
  const [loading, setLoading] = useState(true);
  const [valorizacion, setValorizacion] = useState({ items: [], valorTotal: 0 });
  const [sugerencias, setSugerencias] = useState([]);
  const [ingredientes, setIngredientes] = useState([]);
  const [producciones, setProducciones] = useState([]);
  const [periodoActual, setPeriodoActual] = useState(null);
  const [mermasRecientes, setMermasRecientes] = useState([]);

  useEffect(() => {
    let activo = true;
    (async () => {
      setLoading(true);
      try {
        const [val, sug, ing, prod, per, mer] = await Promise.all([
          reporteValorizacion(),
          reporteSugerenciasCompra(),
          listarIngredientes(),
          listarProducciones(),
          listarPeriodos(),
          reporteMermas(),
        ]);
        if (!activo) return;
        setValorizacion(val);
        setSugerencias(sug);
        setIngredientes(ing);
        setProducciones(prod);
        setPeriodoActual(per[0] || null);
        setMermasRecientes(mer.slice(0, 5));
      } catch (e) {
        notify.error(e);
      } finally {
        if (activo) setLoading(false);
      }
    })();
    return () => {
      activo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const bajoMinimo = ingredientes.filter((i) => i.bajoMinimo).length;
  const mesActual = new Date().toISOString().slice(0, 7);
  const produccionesMes = producciones.filter((p) => p.fecha?.startsWith(mesActual)).length;

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 0.5 }}>
        Dashboard
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Resumen general del negocio en tiempo real.
      </Typography>

      <Grid container spacing={2.5} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} lg={2.4}>
          <KpiCard
            title="Valor de inventario"
            value={formatoMoneda(valorizacion.valorTotal)}
            icon={<InventoryIcon />}
            color="primary"
            loading={loading}
          />
        </Grid>
        <Grid item xs={12} sm={6} lg={2.4}>
          <KpiCard
            title="Ingredientes bajo mínimo"
            value={bajoMinimo}
            icon={<WarningAmberIcon />}
            color={bajoMinimo > 0 ? "error" : "success"}
            loading={loading}
          />
        </Grid>
        <Grid item xs={12} sm={6} lg={2.4}>
          <KpiCard
            title="Sugerencias de compra"
            value={sugerencias.length}
            icon={<ShoppingCartIcon />}
            color="warning"
            loading={loading}
          />
        </Grid>
        <Grid item xs={12} sm={6} lg={2.4}>
          <KpiCard
            title="Producciones este mes"
            value={produccionesMes}
            icon={<PrecisionManufacturingIcon />}
            color="secondary"
            loading={loading}
          />
        </Grid>
        <Grid item xs={12} sm={6} lg={2.4}>
          <KpiCard
            title="Periodo actual"
            value={periodoActual ? `${periodoActual.mes}/${periodoActual.anio}` : "—"}
            subtitle={periodoActual?.estado}
            icon={<EventNoteIcon />}
            color={periodoActual?.estado === "cerrado" ? "error" : "success"}
            loading={loading}
          />
        </Grid>
      </Grid>

      <Grid container spacing={2.5}>
        <Grid item xs={12} lg={7}>
          <Paper variant="outlined" sx={{ borderRadius: 3, p: 2.5 }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5 }}>
              <Typography variant="subtitle1">Sugerencias de compra</Typography>
              <Chip label={`${sugerencias.length} ingredientes`} size="small" />
            </Stack>
            <DataTable
              loading={loading}
              searchable={false}
              rowsPerPageOptions={[5, 10]}
              getRowId={(r) => r.ingredienteId}
              emptyMessage="Sin sugerencias de compra por ahora."
              columns={[
                { field: "nombre", headerName: "Ingrediente" },
                {
                  field: "stockActual",
                  headerName: "Stock actual",
                  align: "right",
                  renderCell: (r) => `${formatoNumero(r.stockActual)} ${r.unidadBase}`,
                },
                {
                  field: "cantidadSugerida",
                  headerName: "Sugerido",
                  align: "right",
                  renderCell: (r) => `${formatoNumero(r.cantidadSugerida)} ${r.unidadBase}`,
                },
                {
                  field: "bajoMinimo",
                  headerName: "Estado",
                  align: "center",
                  renderCell: (r) =>
                    r.bajoMinimo ? <StatusChip label="Bajo mínimo" tone="error" /> : <StatusChip label="Cobertura baja" tone="warning" />,
                },
              ]}
              rows={sugerencias}
            />
          </Paper>
        </Grid>

        <Grid item xs={12} lg={5}>
          <Paper variant="outlined" sx={{ borderRadius: 3, p: 2.5, height: "100%" }}>
            <Typography variant="subtitle1" sx={{ mb: 1.5 }}>
              Mermas recientes
            </Typography>
            <DataTable
              loading={loading}
              searchable={false}
              rowsPerPageOptions={[5, 10]}
              getRowId={(r) => `${r.fecha}-${r.item}-${r.motivo}`}
              emptyMessage="Sin mermas registradas."
              columns={[
                { field: "fecha", headerName: "Fecha", renderCell: (r) => formatoFecha(r.fecha) },
                { field: "item", headerName: "Ítem" },
                { field: "cantidad", headerName: "Cant.", align: "right", renderCell: (r) => formatoNumero(r.cantidad) },
              ]}
              rows={mermasRecientes}
            />
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
}
