import { useEffect, useMemo, useState } from "react";
import { Box, Button, Grid, LinearProgress, List, ListItem, ListItemText, Stack, Typography } from "@mui/material";
import ArrowOutwardIcon from "@mui/icons-material/ArrowOutward";
import AccountBalanceWalletIcon from "@mui/icons-material/AccountBalanceWalletOutlined";
import AccountBalanceIcon from "@mui/icons-material/AccountBalanceOutlined";
import InventoryIcon from "@mui/icons-material/Inventory2Outlined";
import PointOfSaleIcon from "@mui/icons-material/PointOfSaleOutlined";
import ReceiptLongIcon from "@mui/icons-material/ReceiptLongOutlined";
import ShoppingCartIcon from "@mui/icons-material/ShoppingCartOutlined";
import PrecisionManufacturingIcon from "@mui/icons-material/PrecisionManufacturingOutlined";
import TrendingUpIcon from "@mui/icons-material/TrendingUpOutlined";
import WarningAmberIcon from "@mui/icons-material/WarningAmberOutlined";
import AppCard from "../components/ui/AppCard";
import AppBadge from "../components/ui/AppBadge";
import ContentSkeleton from "../components/ui/ContentSkeleton";
import MetricCard from "../components/ui/MetricCard";
import { useNotify } from "../hooks/useNotify";
import { useAuth } from "../context/AuthContext";
import { formatoFecha, formatoMoneda, formatoNumero } from "../utils/format";
import { listarDocumentosCxP, listarEntidadesFinancieras, listarIngredientes, listarProducciones, listarVentas, listarVentasPendientes, reporteSugerenciasCompra, reporteValorizacion, saldoCajaFinanciera, saldosTesoreria, utilidadPeriodoActual } from "../api/endpoints";

const numero = (valor) => Number(valor || 0);
const hoy = new Date().toISOString().slice(0, 10);

function produccionPorDia(producciones) {
  const dias = new Map();
  producciones.forEach((produccion) => {
    if (!produccion.fecha) return;
    dias.set(produccion.fecha, (dias.get(produccion.fecha) || 0) + numero(produccion.unidades_producidas || produccion.tandas || 1));
  });
  return [...dias.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-7).map(([fecha, cantidad]) => ({ fecha, cantidad }));
}

export default function Dashboard() {
  const { error: notifyError } = useNotify();
  const { usuario } = useAuth();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState({ ventas: [], cxc: [], cxp: [], ingredientes: [], producciones: [], sugerencias: [], inventario: { valorTotal: 0 } });
  const [finanzas, setFinanzas] = useState({ caja: 0, yape: 0, banco: 0, utilidad: 0 });

  useEffect(() => {
    let activo = true;
    (async () => {
      setLoading(true);
      try {
        const [ventas, cxc, ingredientes, producciones, sugerencias, inventario, entidades] = await Promise.all([
          listarVentas(), listarVentasPendientes(), listarIngredientes(), listarProducciones(), reporteSugerenciasCompra(), reporteValorizacion(), listarEntidadesFinancieras(),
        ]);
        const documentos = await Promise.all((entidades || []).map((entidad) => listarDocumentosCxP({ entidad_id: entidad.id }).catch(() => [])));
        if (entidades?.[0]) { const [caja, cuentas, utilidad] = await Promise.all([saldoCajaFinanciera(entidades[0].id), saldosTesoreria(entidades[0].id), utilidadPeriodoActual(entidades[0].id)]); setFinanzas({ caja: caja.saldo_minor, yape: cuentas.filter((c) => c.tipo === 'billetera' && c.proveedor === 'yape').reduce((n, c) => n + c.saldo_minor, 0), banco: cuentas.filter((c) => c.tipo === 'banco').reduce((n, c) => n + c.saldo_minor, 0), utilidad: utilidad.utilidad_minor }); }
        if (activo) setData({ ventas: ventas || [], cxc: cxc || [], cxp: documentos.flat(), ingredientes: ingredientes || [], producciones: producciones || [], sugerencias: sugerencias || [], inventario: inventario || { valorTotal: 0 } });
      } catch (error) {
        notifyError(error);
      } finally {
        if (activo) setLoading(false);
      }
    })();
    return () => { activo = false; };
  }, [notifyError]);

  const resumen = useMemo(() => {
    const ventasHoy = data.ventas.filter((venta) => venta.fecha === hoy);
    const totalVentasHoy = ventasHoy.reduce((total, venta) => total + numero(venta.total), 0);
    const saldoCxC = data.cxc.reduce((total, documento) => total + numero(documento.saldo), 0);
    const saldoCxP = data.cxp.reduce((total, documento) => total + numero(documento.saldo), 0);
    return { totalVentasHoy, operacionesHoy: ventasHoy.length, saldoCxC, saldoCxP, inventarioCritico: data.ingredientes.filter((ingrediente) => ingrediente.bajoMinimo).length, produccionMes: data.producciones.filter((produccion) => produccion.fecha?.startsWith(hoy.slice(0, 7))).length, produccionDias: produccionPorDia(data.producciones) };
  }, [data]);
  const maxProduccion = Math.max(...resumen.produccionDias.map((dia) => dia.cantidad), 1);

  return <Box>
    <Stack direction={{ xs: "column", md: "row" }} alignItems={{ md: "flex-end" }} justifyContent="space-between" spacing={2} sx={{ mb: 3.5 }}>
      <Box><Typography variant="h4">Buenos días, {usuario?.nombre?.split(" ")[0] || "equipo"}</Typography><Typography variant="body1" color="text.secondary" sx={{ mt: 0.75 }}>Una vista operativa del negocio para tomar decisiones rápidas.</Typography></Box>
      <Button variant="outlined" endIcon={<ArrowOutwardIcon />} onClick={() => window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" })}>Ver alertas</Button>
    </Stack>

    <Grid container spacing={2} sx={{ mb: 2 }}>
      <Grid item xs={12} sm={6} lg={3}><MetricCard label="Ventas de hoy" value={formatoMoneda(resumen.totalVentasHoy)} helper={`${resumen.operacionesHoy} operaciones registradas`} icon={<PointOfSaleIcon />} loading={loading} /></Grid>
      <Grid item xs={12} sm={6} lg={3}><MetricCard label="Utilidad" value={formatoMoneda(finanzas.utilidad / 100)} icon={<TrendingUpIcon />} tone="green" loading={loading} /></Grid>
      <Grid item xs={12} sm={6} lg={3}><MetricCard label="Caja" value={formatoMoneda(finanzas.caja / 100)} icon={<AccountBalanceWalletIcon />} tone="teal" loading={loading} /></Grid>
      <Grid item xs={12} sm={6} lg={3}><MetricCard label="Yape" value={formatoMoneda(finanzas.yape / 100)} icon={<AccountBalanceWalletIcon />} tone="teal" loading={loading} /></Grid>
      <Grid item xs={12} sm={6} lg={3}><MetricCard label="Banco" value={formatoMoneda(finanzas.banco / 100)} icon={<AccountBalanceIcon />} tone="indigo" loading={loading} /></Grid>
      <Grid item xs={12} sm={6} lg={3}><MetricCard label="CxC pendiente" value={formatoMoneda(resumen.saldoCxC)} helper={`${data.cxc.length} documentos pendientes`} icon={<ReceiptLongIcon />} tone="amber" loading={loading} /></Grid>
      <Grid item xs={12} sm={6} lg={3}><MetricCard label="CxP pendiente" value={formatoMoneda(resumen.saldoCxP)} helper={`${data.cxp.length} documentos por pagar`} icon={<ShoppingCartIcon />} tone="red" loading={loading} /></Grid>
      <Grid item xs={12} sm={6} lg={3}><MetricCard label="Producción del mes" value={formatoNumero(resumen.produccionMes)} helper="Registros de producción" icon={<PrecisionManufacturingIcon />} tone="teal" loading={loading} /></Grid>
      <Grid item xs={12} sm={6} lg={3}><MetricCard label="Inventario crítico" value={formatoNumero(resumen.inventarioCritico)} helper={resumen.inventarioCritico ? "Ingredientes bajo mínimo" : "Sin alertas críticas"} icon={<WarningAmberIcon />} tone={resumen.inventarioCritico ? "red" : "green"} loading={loading} /></Grid>
      <Grid item xs={12} sm={6} lg={3}><MetricCard label="Productos con poco stock" icon={<InventoryIcon />} tone="amber" unavailable loading={loading} /></Grid>
    </Grid>

    <Grid container spacing={2}>
      <Grid item xs={12} lg={7}>
        <AppCard title="Actividad de producción" subtitle="Últimos registros disponibles" action={<AppBadge label="Datos reales" tone="info" />} sx={{ height: "100%" }}>
          {loading ? <ContentSkeleton lines={6} /> : resumen.produccionDias.length ? <Stack spacing={1.75} sx={{ px: 2.5, pb: 2.5, pt: 1.5 }}>{resumen.produccionDias.map((dia) => <Box key={dia.fecha}><Stack direction="row" justifyContent="space-between" sx={{ mb: 0.75 }}><Typography variant="body2">{formatoFecha(dia.fecha)}</Typography><Typography variant="body2" fontWeight={650}>{formatoNumero(dia.cantidad)}</Typography></Stack><LinearProgress variant="determinate" value={(dia.cantidad / maxProduccion) * 100} sx={{ height: 8, borderRadius: 5, bgcolor: "action.hover" }} /></Box>)}</Stack> : <Box sx={{ px: 2.5, pb: 3 }}><Typography variant="body2" color="text.secondary">Todavía no hay producción registrada para mostrar.</Typography></Box>}
        </AppCard>
      </Grid>
      <Grid item xs={12} lg={5}>
        <AppCard title="Inventario crítico" subtitle="Prioridades de reposición" action={<AppBadge label={`${data.sugerencias.length} alertas`} tone={data.sugerencias.length ? "warning" : "neutral"} />} sx={{ height: "100%" }}>
          {loading ? <ContentSkeleton lines={6} /> : data.sugerencias.length ? <List disablePadding sx={{ px: 1, pb: 1 }}>{data.sugerencias.slice(0, 5).map((sugerencia) => <ListItem key={sugerencia.ingredienteId || sugerencia.nombre} divider secondaryAction={<Typography variant="body2" fontWeight={650}>{formatoNumero(sugerencia.cantidadSugerida)} {sugerencia.unidadBase}</Typography>}><ListItemText primary={sugerencia.nombre} secondary={`Stock actual: ${formatoNumero(sugerencia.stockActual)} ${sugerencia.unidadBase}`} primaryTypographyProps={{ fontWeight: 600, fontSize: 14 }} /></ListItem>)}</List> : <Box sx={{ px: 2.5, pb: 3 }}><Typography variant="body2" color="text.secondary">No hay sugerencias de compra activas.</Typography></Box>}
        </AppCard>
      </Grid>
      <Grid item xs={12}>
        <AppCard title="Inventario valorizado" subtitle="Valor calculado desde los lotes disponibles" action={<AppBadge label={formatoMoneda(data.inventario.valorTotal)} tone="success" />}>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ px: 2.5, pb: 2.5, pt: 1.25 }}><Box sx={{ flex: 1 }}><Typography variant="body2" color="text.secondary">Los saldos de caja, Yape, banco, utilidad y stock de productos se muestran como no disponibles hasta contar con endpoints específicos. El dashboard no inventa cifras.</Typography></Box><Typography variant="body2" color="text.secondary">Actualizado al cargar la página.</Typography></Stack>
        </AppCard>
      </Grid>
    </Grid>
  </Box>;
}
