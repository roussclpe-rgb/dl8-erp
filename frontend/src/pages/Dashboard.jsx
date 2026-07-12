import { useEffect, useState } from "react";
import { Alert, Button, Grid, MenuItem, Paper, Typography, Box, Stack, Chip, TextField } from "@mui/material";
import { Link as RouterLink } from "react-router-dom";
import InventoryIcon from "@mui/icons-material/Inventory2Outlined";
import WarningAmberIcon from "@mui/icons-material/WarningAmberOutlined";
import ShoppingCartIcon from "@mui/icons-material/ShoppingCartOutlined";
import PrecisionManufacturingIcon from "@mui/icons-material/PrecisionManufacturingOutlined";
import EventNoteIcon from "@mui/icons-material/EventNoteOutlined";
import AccountBalanceWalletIcon from "@mui/icons-material/AccountBalanceWalletOutlined";
import SavingsIcon from "@mui/icons-material/SavingsOutlined";

import KpiCard from "../components/KpiCard";
import DataTable from "../components/DataTable";
import StatusChip from "../components/StatusChip";
import MpfExecutivePanel from "../components/finanzas/MpfExecutivePanel";
import { useNotify } from "../hooks/useNotify";
import { formatoMoneda, formatoNumero, formatoFecha } from "../utils/format";
import {
  reporteValorizacion,
  reporteSugerenciasCompra,
  reporteMermas,
  listarIngredientes,
  listarProducciones,
  listarPeriodos,
  listarEntidadesFinancieras,
  resumenPoliticasFinancieras,
  listarAlertasFinancieras,
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
  const [mpfResumen, setMpfResumen] = useState(null);
  const [entidadFinanciera, setEntidadFinanciera] = useState(null);
  const [periodoMpf, setPeriodoMpf] = useState("mes");
  const [alertasFinancieras, setAlertasFinancieras] = useState([]);

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
        try {
          const entidades = await listarEntidadesFinancieras();
          if (entidades[0]) {
            setEntidadFinanciera(entidades[0]);
            setMpfResumen(await resumenPoliticasFinancieras(entidades[0].id));
            setAlertasFinancieras(await listarAlertasFinancieras(entidades[0].id));
          }
        } catch (_) { /* Finanzas es opcional para el dashboard operativo. */ }
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

  useEffect(() => {
    if (!entidadFinanciera) return;
    const hoy = new Date(); const desde = new Date(hoy);
    if (periodoMpf === "hoy") desde.setHours(0, 0, 0, 0);
    if (periodoMpf === "semana") desde.setDate(hoy.getDate() - 6);
    if (periodoMpf === "mes") desde.setDate(1);
    resumenPoliticasFinancieras(entidadFinanciera.id, { desde: desde.toISOString().slice(0, 10), hasta: hoy.toISOString().slice(0, 10) }).then(setMpfResumen).catch(() => {});
  }, [entidadFinanciera, periodoMpf]);

  const bajoMinimo = ingredientes.filter((i) => i.bajoMinimo).length;
  const mesActual = new Date().toISOString().slice(0, 7);
  const produccionesMes = producciones.filter((p) => p.fecha?.startsWith(mesActual)).length;
  const alertasMpf = (mpfResumen?.recibido_minor || 0) > 0 ? [
    !mpfResumen?.bolsillos?.some((b) => b.tipo === "impuestos") && "No se ha reservado dinero para impuestos.",
    !mpfResumen?.bolsillos?.some((b) => b.tipo === "reserva") && "No se ha creado una reserva financiera.",
    ...(mpfResumen?.metas || []).filter((m) => m.saldo_minor < m.meta_minor).map((m) => `${m.nombre}: faltan ${formatoMoneda((m.meta_minor - m.saldo_minor) / 100)} para la meta.`),
  ].filter(Boolean) : [];

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 0.5 }}>
        Dashboard
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Resumen general del negocio en tiempo real.
      </Typography>

      <MpfExecutivePanel />

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
        {entidadFinanciera && <>
          <Grid item xs={12} sm={6} lg={2.4}>
            <KpiCard title="Recibido (MPF)" value={formatoMoneda((mpfResumen?.recibido_minor || 0) / 100)} subtitle={entidadFinanciera.nombre} icon={<AccountBalanceWalletIcon />} color="info" loading={loading} />
          </Grid>
          <Grid item xs={12} sm={6} lg={2.4}>
            <KpiCard title="Disponible para gastar" value={formatoMoneda((mpfResumen?.disponible_minor || 0) / 100)} subtitle="Después de reservas" icon={<SavingsIcon />} color="success" loading={loading} />
          </Grid>
          <Grid item xs={12} sm={6} lg={2.4}>
            <KpiCard title="Alertas financieras" value={alertasFinancieras.filter((a) => ["activa", "leida"].includes(a.estado)).length} subtitle="Requieren seguimiento" icon={<WarningAmberIcon />} color={alertasFinancieras.some((a) => a.estado === "activa" && a.severidad === "critica") ? "error" : "warning"} loading={loading} />
          </Grid>
        </>}
      </Grid>

      <Grid container spacing={2.5}>
        {entidadFinanciera && <Grid item xs={12}>
          <Paper variant="outlined" sx={{ borderRadius: 3, p: 2.5 }}>
            <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" alignItems={{ sm: "center" }} sx={{ mb: 0.5 }}><Typography variant="subtitle1">Decisiones financieras</Typography><TextField select size="small" label="Período" value={periodoMpf} onChange={(e) => setPeriodoMpf(e.target.value)} sx={{ minWidth: 150 }}><MenuItem value="hoy">Hoy</MenuItem><MenuItem value="semana">Últimos 7 días</MenuItem><MenuItem value="mes">Este mes</MenuItem></TextField></Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>Costo recuperado: {formatoMoneda((mpfResumen?.costo_recuperado_minor || 0) / 100)} · Dinero distribuido: {formatoMoneda((mpfResumen?.distribuido_minor || 0) / 100)}</Typography>
            {alertasMpf.map((mensaje) => <Alert key={mensaje} severity="warning" sx={{ mb: 1 }}>{mensaje}</Alert>)}
            <DataTable loading={loading} searchable={false} rows={mpfResumen?.bolsillos || []} rowsPerPageOptions={[5]} emptyMessage="Aún no hay cobros distribuidos por una política financiera." columns={[{ field: "nombre", headerName: "Bolsillo" }, { field: "tipo", headerName: "Tipo" }, { field: "reservado_minor", headerName: "Reservado", align: "right", renderCell: (r) => formatoMoneda(r.reservado_minor / 100) }]} />
          </Paper>
        </Grid>}
        {entidadFinanciera && <Grid item xs={12}>
          <Paper variant="outlined" sx={{ borderRadius: 3, p: 2.5 }}>
            <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" spacing={1}><Box><Typography variant="subtitle1">Alertas financieras</Typography><Typography variant="body2" color="text.secondary">{alertasFinancieras.filter((a) => ["activa", "leida"].includes(a.estado)).length} alertas activas o leídas para {entidadFinanciera.nombre}.</Typography></Box><Button component={RouterLink} to="/alertas-financieras" variant="outlined">Ver alertas</Button></Stack>
          </Paper>
        </Grid>}
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
