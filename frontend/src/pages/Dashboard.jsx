import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Alert, Box, Button, Chip, Divider, Grid, LinearProgress, List, ListItemButton, ListItemIcon, ListItemText, MenuItem, Stack, TextField, Typography } from "@mui/material";
import ArrowOutwardIcon from "@mui/icons-material/ArrowOutward";
import AccountBalanceWalletOutlinedIcon from "@mui/icons-material/AccountBalanceWalletOutlined";
import AccountBalanceOutlinedIcon from "@mui/icons-material/AccountBalanceOutlined";
import AssessmentOutlinedIcon from "@mui/icons-material/AssessmentOutlined";
import CampaignOutlinedIcon from "@mui/icons-material/CampaignOutlined";
import CategoryOutlinedIcon from "@mui/icons-material/CategoryOutlined";
import CreditCardOutlinedIcon from "@mui/icons-material/CreditCardOutlined";
import Inventory2OutlinedIcon from "@mui/icons-material/Inventory2Outlined";
import LocalShippingOutlinedIcon from "@mui/icons-material/LocalShippingOutlined";
import PointOfSaleOutlinedIcon from "@mui/icons-material/PointOfSaleOutlined";
import PrecisionManufacturingOutlinedIcon from "@mui/icons-material/PrecisionManufacturingOutlined";
import ReceiptLongOutlinedIcon from "@mui/icons-material/ReceiptLongOutlined";
import ShoppingCartOutlinedIcon from "@mui/icons-material/ShoppingCartOutlined";
import TrendingUpOutlinedIcon from "@mui/icons-material/TrendingUpOutlined";
import WarningAmberOutlinedIcon from "@mui/icons-material/WarningAmberOutlined";
import AppCard from "../components/ui/AppCard";
import AppBadge from "../components/ui/AppBadge";
import ContentSkeleton from "../components/ui/ContentSkeleton";
import MetricCard from "../components/ui/MetricCard";
import PageState from "../components/PageState";
import { useAuth } from "../context/AuthContext";
import { fechaHoyISO, formatoFecha, formatoMoneda, formatoNumero } from "../utils/format";
import {
  dashboardObjetivosNegocio, listarAlertasFinancieras, listarCompras, listarDocumentosCxP, listarEntidadesFinancieras,
  listarEventosFinancieros, listarIngredientes, listarMetasFinancieras, listarPeriodosFinancieros, listarProducciones,
  listarVentas, listarVentasPendientes, obtenerVenta, reporteMermas, reporteSugerenciasCompra, reporteValorizacion,
  saldoCajaFinanciera, saldosTesoreria, utilidadPeriodoActual,
} from "../api/endpoints";

const numero = (valor) => Number(valor || 0);
const hoy = fechaHoyISO();
const initialOps = { ingredientes: [], producciones: [], sugerencias: [], mermas: [], inventario: { valorTotal: 0 }, compras: [] };
const initialFinance = { ventas: [], ventaDetalles: [], cxc: [], cxp: [], caja: 0, tesoreria: [], utilidad: 0, ingresos: 0, costos: 0, gastos: 0, periodo: null, alertas: [], metas: [], eventos: [], objetivos: { objetivos: [], resumen: {}, tendencia: [] } };

function MiniTrend({ values, color = "primary.main" }) {
  const points = values.filter(Number.isFinite);
  if (points.length < 2) return <Box sx={{ height: 42 }} />;
  const max = Math.max(...points, 1); const min = Math.min(...points, 0); const range = max - min || 1;
  const coordinates = points.map((value, index) => `${(index / (points.length - 1)) * 100},${36 - ((value - min) / range) * 30}`).join(" ");
  return <Box sx={{ height: 42, color }}><svg viewBox="0 0 100 42" width="100%" height="42" preserveAspectRatio="none" aria-label="Tendencia reciente"><polyline points={coordinates} fill="none" stroke="currentColor" strokeWidth="2.5" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" /></svg></Box>;
}

function ClickableCard({ title, subtitle, action, to, children, sx }) {
  const navigate = useNavigate();
  return <AppCard title={title} subtitle={subtitle} action={action} sx={{ height: "100%", cursor: "pointer", "&:hover": { boxShadow: "0 10px 24px rgba(16,24,40,.07)", transform: "translateY(-1px)" }, ...sx }}>
    <Box role="link" tabIndex={0} onClick={() => navigate(to)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); navigate(to); } }} sx={{ outline: "none" }}>{children}</Box>
  </AppCard>;
}

function progress(value) { return Math.max(0, Math.min(100, numero(value))); }

export default function Dashboard() {
  const { usuario } = useAuth(); const navigate = useNavigate();
  const [entidades, setEntidades] = useState([]); const [entidadId, setEntidadId] = useState("");
  const [operativo, setOperativo] = useState(initialOps); const [finanzas, setFinanzas] = useState(initialFinance);
  const [loadingOperativo, setLoadingOperativo] = useState(true); const [loadingFinanzas, setLoadingFinanzas] = useState(false);
  const [errorOperativo, setErrorOperativo] = useState(""); const [errorFinanzas, setErrorFinanzas] = useState("");

  useEffect(() => { let active = true; listarEntidadesFinancieras().then((rows) => { if (active) { setEntidades(rows); setEntidadId(String(rows[0]?.id || "")); } }).catch((error) => active && setErrorFinanzas(error.message)); return () => { active = false; }; }, []);

  useEffect(() => {
    let active = true; setLoadingOperativo(true); setErrorOperativo("");
    Promise.allSettled([listarIngredientes(), listarProducciones(), reporteSugerenciasCompra(), reporteValorizacion(), reporteMermas(), listarCompras()]).then((results) => {
      if (!active) return;
      const value = (index, fallback) => results[index].status === "fulfilled" ? results[index].value : fallback;
      setOperativo({ ingredientes: value(0, []), producciones: value(1, []), sugerencias: value(2, []), inventario: value(3, { valorTotal: 0 }), mermas: value(4, []).slice(0, 5), compras: value(5, []) });
      const failures = results.filter((item) => item.status === "rejected").length;
      if (failures) setErrorOperativo(`${failures} fuente(s) operativa(s) no pudieron cargarse.`);
    }).finally(() => active && setLoadingOperativo(false));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!entidadId) { setFinanzas(initialFinance); return undefined; }
    let active = true; setLoadingFinanzas(true); setErrorFinanzas(""); const params = { entidad_id: Number(entidadId) };
    Promise.allSettled([
      listarVentas(params), listarVentasPendientes(params), listarDocumentosCxP(params), saldoCajaFinanciera(entidadId), saldosTesoreria(entidadId),
      utilidadPeriodoActual(entidadId), listarPeriodosFinancieros(entidadId), listarAlertasFinancieras(entidadId), listarMetasFinancieras(entidadId),
      listarEventosFinancieros(entidadId), dashboardObjetivosNegocio(),
    ]).then(async (results) => {
      if (!active) return;
      const value = (index, fallback) => results[index].status === "fulfilled" ? results[index].value : fallback;
      const ventas = value(0, []);
      const details = await Promise.allSettled(ventas.slice(0, 24).map((venta) => obtenerVenta(venta.id)));
      if (!active) return;
      const periodos = value(6, []);
      const resultadoPeriodo = value(5, {});
      setFinanzas({ ventas, ventaDetalles: details.filter((item) => item.status === "fulfilled").map((item) => item.value), cxc: value(1, []), cxp: value(2, []), caja: numero(value(3, {}).saldo_minor), tesoreria: value(4, []), utilidad: numero(resultadoPeriodo.utilidad_minor), ingresos: numero(resultadoPeriodo.ingresos_minor), costos: numero(resultadoPeriodo.costos_minor), gastos: numero(resultadoPeriodo.gastos_minor), periodo: resultadoPeriodo.periodo || periodos.find((item) => item.anio === new Date().getFullYear() && item.mes === new Date().getMonth() + 1) || null, alertas: value(7, []), metas: value(8, []), eventos: value(9, []), objetivos: value(10, { objetivos: [], resumen: {}, tendencia: [] }) });
      const failures = results.filter((item) => item.status === "rejected").length;
      if (failures) setErrorFinanzas(`${failures} fuente(s) financiera(s) no pudieron cargarse; el resto sigue disponible.`);
    }).catch((error) => active && setErrorFinanzas(error.message)).finally(() => active && setLoadingFinanzas(false));
    return () => { active = false; };
  }, [entidadId]);

  const resumen = useMemo(() => {
    const ventasHoy = finanzas.ventas.filter((item) => item.fecha === hoy); const comprasHoy = operativo.compras.filter((item) => item.fecha_compra === hoy);
    const porDia = new Map(); finanzas.ventas.forEach((item) => { if (item.fecha) porDia.set(item.fecha, (porDia.get(item.fecha) || 0) + numero(item.total)); });
    const produccion = new Map(); operativo.producciones.forEach((item) => { if (item.fecha) produccion.set(item.fecha, (produccion.get(item.fecha) || 0) + numero(item.unidades_producidas || item.tandas || 1)); });
    const productos = new Map(); finanzas.ventaDetalles.forEach((venta) => venta.items?.forEach((item) => { const key = item.nombre_producto || item.producto_nombre || item.receta_nombre || `Producto #${item.receta_grupo_id}`; productos.set(key, (productos.get(key) || 0) + numero(item.cantidad)); }));
    const actividad = [
      ...finanzas.ventas.slice(0, 4).map((item) => ({ id: `v-${item.id}`, date: item.fecha, label: `Venta a ${item.cliente_nombre || "cliente"}`, detail: formatoMoneda(item.total), icon: <PointOfSaleOutlinedIcon fontSize="small" />, to: "/ventas", tone: "primary" })),
      ...operativo.compras.slice(0, 3).map((item) => ({ id: `c-${item.id}`, date: item.fecha_compra, label: `Compra a ${item.proveedor_nombre || "proveedor"}`, detail: formatoMoneda(item.costo_total), icon: <ShoppingCartOutlinedIcon fontSize="small" />, to: "/compras", tone: "warning" })),
      ...operativo.producciones.slice(0, 3).map((item) => ({ id: `p-${item.id}`, date: item.fecha, label: `Producción: ${item.nombre_producto || item.receta || "registro"}`, detail: `${formatoNumero(item.unidades_producidas || item.tandas || 1)} unid.`, icon: <PrecisionManufacturingOutlinedIcon fontSize="small" />, to: "/producciones", tone: "success" })),
      ...finanzas.eventos.slice(0, 3).map((item) => ({ id: `f-${item.id}`, date: item.fecha || item.creado_en, label: item.descripcion || item.tipo || "Movimiento financiero", detail: "Finanzas", icon: <AccountBalanceOutlinedIcon fontSize="small" />, to: "/finanzas", tone: "info" })),
    ].sort((a, b) => String(b.date || "").localeCompare(String(a.date || ""))).slice(0, 7);
    const liquid = finanzas.tesoreria.reduce((sum, item) => sum + numero(item.saldo_minor), 0);
    return {
      ventasHoy, comprasHoy, totalVentasHoy: ventasHoy.reduce((sum, item) => sum + numero(item.total), 0), totalComprasHoy: comprasHoy.reduce((sum, item) => sum + numero(item.costo_total), 0),
      saldoCxC: finanzas.cxc.reduce((sum, item) => sum + numero(item.saldo), 0), saldoCxP: finanzas.cxp.reduce((sum, item) => sum + numero(item.saldo), 0),
      stockCritico: operativo.ingredientes.filter((item) => item.bajoMinimo).length, produccionMes: operativo.producciones.filter((item) => item.fecha?.startsWith(hoy.slice(0, 7))).reduce((sum, item) => sum + numero(item.unidades_producidas || item.tandas || 1), 0),
      ventasTrend: [...porDia.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-7).map(([, value]) => value), produccionTrend: [...produccion.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-7).map(([, value]) => value),
      productos: [...productos.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5), alertas: finanzas.alertas.filter((item) => ["activa", "leida"].includes(item.estado)), metas: finanzas.metas.filter((item) => item.estado !== "cancelada").slice(0, 3), actividad, liquid,
    };
  }, [finanzas, operativo]);

  const maxProducto = Math.max(...resumen.productos.map(([, value]) => value), 1);
  const maxProduccion = Math.max(...resumen.produccionTrend, 1);
  const objectiveSummary = finanzas.objetivos.resumen || {};

  return <Box>
    <Stack direction={{ xs: "column", lg: "row" }} alignItems={{ lg: "flex-end" }} justifyContent="space-between" spacing={2} sx={{ mb: 3.5 }}>
      <Box><Stack direction="row" alignItems="center" spacing={1}><Typography variant="h4">Centro de control</Typography><AppBadge label="En vivo" tone="success" /></Stack><Typography variant="body1" color="text.secondary" sx={{ mt: 0.75 }}>Hola, {usuario?.nombre?.split(" ")[0] || "equipo"}. Aquí tienes una lectura rápida de la operación.</Typography></Box>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1}><TextField select size="small" label="Entidad financiera" value={entidadId} onChange={(event) => setEntidadId(event.target.value)} sx={{ minWidth: 240 }}>{entidades.map((item) => <MenuItem key={item.id} value={item.id}>{item.nombre}</MenuItem>)}</TextField><Button variant="outlined" endIcon={<ArrowOutwardIcon />} onClick={() => navigate("/alertas-financieras")}>Ver alertas</Button></Stack>
    </Stack>
    {!entidades.length && !errorFinanzas && <Alert severity="info" sx={{ mb: 2 }}>Configura una entidad económica para visualizar los indicadores financieros.</Alert>}
    {errorFinanzas && <Alert severity="warning" sx={{ mb: 2 }}>{errorFinanzas}</Alert>}{errorOperativo && <Alert severity="warning" sx={{ mb: 2 }}>{errorOperativo}</Alert>}

    <Grid container spacing={2} sx={{ mb: 2 }}>
      <Grid item xs={12} sm={6} lg={3}><MetricCard label="Ventas del día" value={formatoMoneda(resumen.totalVentasHoy)} helper={`${resumen.ventasHoy.length} operaciones hoy`} icon={<PointOfSaleOutlinedIcon />} loading={loadingFinanzas} onClick={() => navigate("/ventas")} /></Grid>
      <Grid item xs={12} sm={6} lg={3}><MetricCard label="Producción del mes" value={`${formatoNumero(resumen.produccionMes)} unid.`} helper="Ver órdenes y capacidad" icon={<PrecisionManufacturingOutlinedIcon />} tone="teal" loading={loadingOperativo} onClick={() => navigate("/producciones")} /></Grid>
      <Grid item xs={12} sm={6} lg={3}><MetricCard label="Compras del día" value={formatoMoneda(resumen.totalComprasHoy)} helper={`${resumen.comprasHoy.length} registros hoy`} icon={<ShoppingCartOutlinedIcon />} tone="amber" loading={loadingOperativo} onClick={() => navigate("/compras")} /></Grid>
      <Grid item xs={12} sm={6} lg={3}><MetricCard label="Caja disponible" value={formatoMoneda(finanzas.caja / 100)} helper="Saldo de caja financiera" icon={<AccountBalanceWalletOutlinedIcon />} tone="green" loading={loadingFinanzas} onClick={() => navigate("/caja")} /></Grid>
    </Grid>

    <Grid container spacing={2} sx={{ mb: 2 }}>
      <Grid item xs={12} lg={7}><ClickableCard to="/ventas" title="Ritmo de ventas" subtitle="Últimos días registrados" action={<AppBadge label={formatoMoneda(resumen.totalVentasHoy)} tone="info" />}><Box sx={{ px: { xs: 2, sm: 2.5 }, pb: 2.25 }}><MiniTrend values={resumen.ventasTrend} /><Stack direction="row" justifyContent="space-between" alignItems="center"><Typography variant="body2" color="text.secondary">{resumen.ventasHoy.length} ventas confirmadas hoy</Typography><Button size="small" endIcon={<ArrowOutwardIcon />}>Ir a ventas</Button></Stack></Box></ClickableCard></Grid>
      <Grid item xs={12} lg={5}><ClickableCard to="/flujo-dinero" title="Flujo financiero" subtitle="Liquidez y resultado contable del período" action={<AppBadge label={finanzas.periodo?.estado || "Sin período"} tone="neutral" />}><Stack spacing={1.1} sx={{ px: { xs: 2, sm: 2.5 }, pb: 2.25 }}><Stack direction="row" justifyContent="space-between"><Typography variant="body2" color="text.secondary">Liquidez en tesorería</Typography><Typography fontWeight={700}>{formatoMoneda(resumen.liquid / 100)}</Typography></Stack><Divider /><Stack direction="row" justifyContent="space-between"><Typography variant="caption" color="text.secondary">Ingresos</Typography><Typography variant="body2">{formatoMoneda(finanzas.ingresos / 100)}</Typography></Stack><Stack direction="row" justifyContent="space-between"><Typography variant="caption" color="text.secondary">Costos</Typography><Typography variant="body2">− {formatoMoneda(finanzas.costos / 100)}</Typography></Stack><Stack direction="row" justifyContent="space-between"><Typography variant="caption" color="text.secondary">Gastos</Typography><Typography variant="body2">− {formatoMoneda(finanzas.gastos / 100)}</Typography></Stack><Stack direction="row" justifyContent="space-between" sx={{ pt: .5 }}><Typography variant="body2" fontWeight={700}>Resultado contable</Typography><Typography fontWeight={750} color={finanzas.utilidad >= 0 ? "success.main" : "error.main"}>{formatoMoneda(finanzas.utilidad / 100)}</Typography></Stack><LinearProgress variant="determinate" value={finanzas.utilidad >= 0 ? 72 : 28} color={finanzas.utilidad >= 0 ? "success" : "error"} sx={{ height: 7, borderRadius: 4, mt: .25 }} /></Stack></ClickableCard></Grid>
      <Grid item xs={12} md={6} lg={4}><ClickableCard to="/ingredientes" title="Stock crítico" subtitle="Ingredientes por debajo del mínimo" action={<Chip size="small" color={resumen.stockCritico ? "error" : "success"} label={resumen.stockCritico ? "Requiere atención" : "Controlado"} />}><Stack direction="row" justifyContent="space-between" alignItems="end" sx={{ px: { xs: 2, sm: 2.5 }, pb: 2.25 }}><Box><Typography variant="h3" sx={{ letterSpacing: "-.05em" }}>{formatoNumero(resumen.stockCritico, 0)}</Typography><Typography variant="body2" color="text.secondary">productos críticos</Typography></Box><Inventory2OutlinedIcon color={resumen.stockCritico ? "error" : "success"} sx={{ fontSize: 34 }} /></Stack></ClickableCard></Grid>
      <Grid item xs={12} md={6} lg={4}><ClickableCard to="/ventas?tab=por-cobrar" title="Clientes por cobrar" subtitle="Documentos pendientes de recuperación" action={<AppBadge label={`${finanzas.cxc.length} documentos`} tone="warning" />}><Stack spacing={1} sx={{ px: { xs: 2, sm: 2.5 }, pb: 2.25 }}><Typography variant="h5">{formatoMoneda(resumen.saldoCxC)}</Typography><Typography variant="body2" color="text.secondary">Revisa los cobros pendientes y su vencimiento.</Typography></Stack></ClickableCard></Grid>
      <Grid item xs={12} md={6} lg={4}><ClickableCard to="/compras" title="Proveedores por pagar" subtitle="Obligaciones pendientes" action={<AppBadge label={`${finanzas.cxp.length} documentos`} tone="danger" />}><Stack spacing={1} sx={{ px: { xs: 2, sm: 2.5 }, pb: 2.25 }}><Typography variant="h5">{formatoMoneda(resumen.saldoCxP)}</Typography><Typography variant="body2" color="text.secondary">Consulta el detalle de cuentas por pagar.</Typography></Stack></ClickableCard></Grid>
    </Grid>

    <Grid container spacing={2} sx={{ mb: 2 }}>
      <Grid item xs={12} lg={6}><ClickableCard to="/ventas" title="Productos más vendidos" subtitle="Consolidado de las ventas recientes" action={<CategoryOutlinedIcon fontSize="small" color="action" />}>{loadingFinanzas ? <ContentSkeleton lines={5} /> : resumen.productos.length ? <Stack spacing={1.35} sx={{ px: { xs: 2, sm: 2.5 }, pb: 2.5 }}>{resumen.productos.map(([name, quantity], index) => <Box key={name}><Stack direction="row" justifyContent="space-between" spacing={2} sx={{ mb: .55 }}><Typography variant="body2" noWrap>{index + 1}. {name}</Typography><Typography variant="body2" fontWeight={700}>{formatoNumero(quantity, 0)} unid.</Typography></Stack><LinearProgress variant="determinate" value={(quantity / maxProducto) * 100} sx={{ height: 7, borderRadius: 5 }} /></Box>)}</Stack> : <Box sx={{ px: 2.5, pb: 3 }}><PageState title="Aún no hay ventas detalladas" description="Los productos más vendidos aparecerán al registrar ventas." /></Box>}</ClickableCard></Grid>
      <Grid item xs={12} lg={6}><ClickableCard to="/producciones" title="Producción reciente" subtitle="Unidades registradas en los últimos días" action={<PrecisionManufacturingOutlinedIcon fontSize="small" color="action" />}>{loadingOperativo ? <ContentSkeleton lines={5} /> : <Box sx={{ px: { xs: 2, sm: 2.5 }, pb: 2.5 }}><MiniTrend values={resumen.produccionTrend} color="secondary.main" /><Stack direction="row" justifyContent="space-between"><Typography variant="body2" color="text.secondary">Mayor día de producción</Typography><Typography variant="body2" fontWeight={700}>{formatoNumero(maxProduccion, 0)} unid.</Typography></Stack><LinearProgress variant="determinate" color="secondary" value={resumen.produccionTrend.length ? 100 : 0} sx={{ height: 7, borderRadius: 5, mt: 1.25 }} /></Box>}</ClickableCard></Grid>
    </Grid>

    <Grid container spacing={2}>
      <Grid item xs={12} lg={5}><ClickableCard to="/alertas-financieras" title="Alertas que requieren atención" subtitle="Riesgos operativos y financieros activos" action={<AppBadge label={`${resumen.alertas.length} activas`} tone={resumen.alertas.length ? "warning" : "success"} />}>{loadingFinanzas ? <ContentSkeleton lines={4} /> : resumen.alertas.length ? <List disablePadding sx={{ px: 1, pb: 1 }}>{resumen.alertas.slice(0, 4).map((item) => <ListItemButton key={item.id} sx={{ alignItems: "flex-start", py: 1.25 }}><ListItemIcon sx={{ minWidth: 34, mt: .25, color: item.severidad === "critica" ? "error.main" : item.severidad === "advertencia" ? "warning.main" : "info.main" }}><WarningAmberOutlinedIcon fontSize="small" /></ListItemIcon><ListItemText primary={item.mensaje} secondary={item.tipo?.replaceAll("_", " ")} primaryTypographyProps={{ variant: "body2", fontWeight: 650 }} secondaryTypographyProps={{ variant: "caption" }} /></ListItemButton>)}</List> : <Box sx={{ px: 2.5, pb: 3 }}><Typography variant="body2" color="text.secondary">No hay alertas activas. Todo está bajo control.</Typography></Box>}</ClickableCard></Grid>
      <Grid item xs={12} lg={7}><ClickableCard to="/metas-financieras" title="Metas financieras" subtitle="Avance de las metas activas" action={<AppBadge label={`${objectiveSummary.activos || finanzas.metas.length} activas`} tone="info" />}>{loadingFinanzas ? <ContentSkeleton lines={5} /> : finanzas.metas.length ? <Stack spacing={1.5} sx={{ px: { xs: 2, sm: 2.5 }, pb: 2.5 }}>{finanzas.metas.map((item) => { const current = numero(item.saldo_acumulado_minor || item.avance_minor); const target = numero(item.monto_objetivo_minor || item.meta_minor); const percentage = target ? (current / target) * 100 : numero(item.porcentaje_avance_minor) / 100; return <Box key={item.id}><Stack direction="row" justifyContent="space-between" spacing={2} sx={{ mb: .55 }}><Typography variant="body2" fontWeight={650} noWrap>{item.nombre}</Typography><Typography variant="caption" color="text.secondary">{formatoNumero(progress(percentage), 0)}%</Typography></Stack><LinearProgress variant="determinate" value={progress(percentage)} sx={{ height: 8, borderRadius: 5 }} /><Typography variant="caption" color="text.secondary">{target ? `${formatoMoneda(current / 100)} de ${formatoMoneda(target / 100)}` : item.estado || "En progreso"}</Typography></Box>; })}</Stack> : <Box sx={{ px: 2.5, pb: 3 }}><Typography variant="body2" color="text.secondary">Crea una meta financiera para seguir su avance desde aquí.</Typography></Box>}</ClickableCard></Grid>
      <Grid item xs={12}><ClickableCard to="/reportes" title="Actividad reciente" subtitle="Últimos movimientos de la operación" action={<AssessmentOutlinedIcon fontSize="small" color="action" />}>{(loadingFinanzas || loadingOperativo) ? <ContentSkeleton lines={5} /> : resumen.actividad.length ? <List disablePadding sx={{ px: 1, pb: 1 }}>{resumen.actividad.map((item) => <ListItemButton key={item.id} onClick={(event) => { event.stopPropagation(); navigate(item.to); }}><ListItemIcon sx={{ minWidth: 38, color: `${item.tone}.main` }}>{item.icon}</ListItemIcon><ListItemText primary={item.label} secondary={formatoFecha(item.date)} primaryTypographyProps={{ variant: "body2", fontWeight: 650 }} secondaryTypographyProps={{ variant: "caption" }} /><Typography variant="body2" fontWeight={700}>{item.detail}</Typography></ListItemButton>)}</List> : <Box sx={{ px: 2.5, pb: 3 }}><Typography variant="body2" color="text.secondary">Los movimientos recientes aparecerán aquí cuando se registren.</Typography></Box>}</ClickableCard></Grid>
    </Grid>
  </Box>;
}
