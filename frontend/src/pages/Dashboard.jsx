import { useEffect, useMemo, useState } from "react";
import { Alert, Box, Button, Grid, LinearProgress, List, ListItem, ListItemText, MenuItem, Stack, TextField, Typography } from "@mui/material";
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
import EventNoteIcon from "@mui/icons-material/EventNoteOutlined";
import AppCard from "../components/ui/AppCard";
import AppBadge from "../components/ui/AppBadge";
import ContentSkeleton from "../components/ui/ContentSkeleton";
import MetricCard from "../components/ui/MetricCard";
import DataTable from "../components/DataTable";
import { useAuth } from "../context/AuthContext";
import { formatoFecha, formatoMoneda, formatoNumero } from "../utils/format";
import {
  listarDocumentosCxP, listarEntidadesFinancieras, listarIngredientes, listarPeriodosFinancieros,
  listarProducciones, listarVentas, listarVentasPendientes, reporteMermas, reporteSugerenciasCompra,
  reporteValorizacion, saldoCajaFinanciera, saldosTesoreria, utilidadPeriodoActual,
} from "../api/endpoints";

const numero = (valor) => Number(valor || 0);
const hoy = new Date().toISOString().slice(0, 10);
const inicialOperativo = { ingredientes: [], producciones: [], sugerencias: [], mermas: [], inventario: { valorTotal: 0 } };
const inicialFinanciero = { ventas: [], cxc: [], cxp: [], caja: 0, yape: 0, banco: 0, utilidad: 0, periodo: null };

function produccionPorDia(producciones) {
  const dias = new Map();
  producciones.forEach((produccion) => { if (produccion.fecha) dias.set(produccion.fecha, (dias.get(produccion.fecha) || 0) + numero(produccion.unidades_producidas || produccion.tandas || 1)); });
  return [...dias.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-7).map(([fecha, cantidad]) => ({ fecha, cantidad }));
}

export default function Dashboard() {
  const { usuario } = useAuth();
  const [entidades, setEntidades] = useState([]); const [entidadId, setEntidadId] = useState("");
  const [operativo, setOperativo] = useState(inicialOperativo); const [finanzas, setFinanzas] = useState(inicialFinanciero);
  const [loadingOperativo, setLoadingOperativo] = useState(true); const [loadingFinanzas, setLoadingFinanzas] = useState(false);
  const [errorOperativo, setErrorOperativo] = useState(""); const [errorFinanzas, setErrorFinanzas] = useState("");

  useEffect(() => {
    let activo = true;
    listarEntidadesFinancieras().then((rows) => { if (activo) { setEntidades(rows); setEntidadId(String(rows[0]?.id || "")); } }).catch((error) => { if (activo) setErrorFinanzas(error.message); });
    return () => { activo = false; };
  }, []);

  useEffect(() => {
    let activo = true; setLoadingOperativo(true); setErrorOperativo("");
    Promise.allSettled([listarIngredientes(), listarProducciones(), reporteSugerenciasCompra(), reporteValorizacion(), reporteMermas()]).then((resultados) => {
      if (!activo) return;
      const errores = resultados.filter((item) => item.status === "rejected");
      setOperativo({
        ingredientes: resultados[0].status === "fulfilled" ? resultados[0].value : [],
        producciones: resultados[1].status === "fulfilled" ? resultados[1].value : [],
        sugerencias: resultados[2].status === "fulfilled" ? resultados[2].value : [],
        inventario: resultados[3].status === "fulfilled" ? resultados[3].value : { valorTotal: 0 },
        mermas: resultados[4].status === "fulfilled" ? resultados[4].value.slice(0, 5).map((item, index) => ({ ...item, id: `${item.clase}-${item.fecha}-${index}` })) : [],
      });
      if (errores.length) setErrorOperativo(`${errores.length} consulta(s) operativa(s) no pudieron cargarse.`);
    }).finally(() => { if (activo) setLoadingOperativo(false); });
    return () => { activo = false; };
  }, []);

  useEffect(() => {
    if (!entidadId) { setFinanzas(inicialFinanciero); return; }
    let activo = true; setLoadingFinanzas(true); setErrorFinanzas("");
    const params = { entidad_id: Number(entidadId) };
    Promise.allSettled([
      listarVentas(params), listarVentasPendientes(params), listarDocumentosCxP(params), saldoCajaFinanciera(entidadId),
      saldosTesoreria(entidadId), utilidadPeriodoActual(entidadId), listarPeriodosFinancieros(entidadId),
    ]).then((resultados) => {
      if (!activo) return;
      const valor = (index, fallback) => resultados[index].status === "fulfilled" ? resultados[index].value : fallback;
      const cuentas = valor(4, []); const utilidad = valor(5, {}); const periodos = valor(6, []);
      setFinanzas({
        ventas: valor(0, []), cxc: valor(1, []), cxp: valor(2, []), caja: numero(valor(3, {}).saldo_minor),
        yape: cuentas.filter((cuenta) => cuenta.tipo === "billetera" && cuenta.proveedor === "yape").reduce((total, cuenta) => total + numero(cuenta.saldo_minor), 0),
        banco: cuentas.filter((cuenta) => cuenta.tipo === "banco").reduce((total, cuenta) => total + numero(cuenta.saldo_minor), 0),
        utilidad: numero(utilidad.utilidad_minor), periodo: utilidad.periodo || periodos.find((periodo) => periodo.anio === new Date().getFullYear() && periodo.mes === new Date().getMonth() + 1) || null,
      });
      const errores = resultados.filter((item) => item.status === "rejected");
      if (errores.length) setErrorFinanzas(`${errores.length} métrica(s) financiera(s) no pudieron cargarse; las demás siguen visibles.`);
    }).finally(() => { if (activo) setLoadingFinanzas(false); });
    return () => { activo = false; };
  }, [entidadId]);

  const resumen = useMemo(() => {
    const ventasHoy = finanzas.ventas.filter((venta) => venta.fecha === hoy);
    return {
      totalVentasHoy: ventasHoy.reduce((total, venta) => total + numero(venta.total), 0), operacionesHoy: ventasHoy.length,
      saldoCxC: finanzas.cxc.reduce((total, documento) => total + numero(documento.saldo), 0), saldoCxP: finanzas.cxp.reduce((total, documento) => total + numero(documento.saldo), 0),
      inventarioCritico: operativo.ingredientes.filter((ingrediente) => ingrediente.bajoMinimo).length,
      produccionMes: operativo.producciones.filter((produccion) => produccion.fecha?.startsWith(hoy.slice(0, 7))).length,
      produccionDias: produccionPorDia(operativo.producciones),
    };
  }, [finanzas, operativo]);
  const maxProduccion = Math.max(...resumen.produccionDias.map((dia) => dia.cantidad), 1);

  return <Box>
    <Stack direction={{ xs: "column", md: "row" }} alignItems={{ md: "flex-end" }} justifyContent="space-between" spacing={2} sx={{ mb: 3.5 }}><Box><Typography variant="h4">Buenos días, {usuario?.nombre?.split(" ")[0] || "equipo"}</Typography><Typography variant="body1" color="text.secondary" sx={{ mt: 0.75 }}>Una vista operativa y financiera con datos reales.</Typography></Box><Stack direction={{ xs: "column", sm: "row" }} spacing={1}><TextField select size="small" label="Entidad financiera" value={entidadId} onChange={(event) => setEntidadId(event.target.value)} sx={{ minWidth: 240 }}>{entidades.map((entidad) => <MenuItem key={entidad.id} value={entidad.id}>{entidad.nombre}</MenuItem>)}</TextField><Button variant="outlined" endIcon={<ArrowOutwardIcon />} onClick={() => window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" })}>Ver alertas</Button></Stack></Stack>
    {!entidades.length && !errorFinanzas && <Alert severity="info" sx={{ mb: 2 }}>Configura una entidad económica para mostrar métricas financieras.</Alert>}
    {errorFinanzas && <Alert severity="warning" sx={{ mb: 2 }}>{errorFinanzas}</Alert>}
    {errorOperativo && <Alert severity="warning" sx={{ mb: 2 }}>{errorOperativo}</Alert>}

    <Grid container spacing={2} sx={{ mb: 2 }}>
      <Grid item xs={12} sm={6} lg={3}><MetricCard label="Ventas de hoy" value={formatoMoneda(resumen.totalVentasHoy)} helper={`${resumen.operacionesHoy} operaciones`} icon={<PointOfSaleIcon />} loading={loadingFinanzas} /></Grid>
      <Grid item xs={12} sm={6} lg={3}><MetricCard label="Utilidad" value={formatoMoneda(finanzas.utilidad / 100)} icon={<TrendingUpIcon />} tone="green" loading={loadingFinanzas} /></Grid>
      <Grid item xs={12} sm={6} lg={3}><MetricCard label="Caja" value={formatoMoneda(finanzas.caja / 100)} icon={<AccountBalanceWalletIcon />} tone="teal" loading={loadingFinanzas} /></Grid>
      <Grid item xs={12} sm={6} lg={3}><MetricCard label="Yape" value={formatoMoneda(finanzas.yape / 100)} icon={<AccountBalanceWalletIcon />} tone="teal" loading={loadingFinanzas} /></Grid>
      <Grid item xs={12} sm={6} lg={3}><MetricCard label="Banco" value={formatoMoneda(finanzas.banco / 100)} icon={<AccountBalanceIcon />} tone="indigo" loading={loadingFinanzas} /></Grid>
      <Grid item xs={12} sm={6} lg={3}><MetricCard label="CxC pendiente" value={formatoMoneda(resumen.saldoCxC)} helper={`${finanzas.cxc.length} documentos`} icon={<ReceiptLongIcon />} tone="amber" loading={loadingFinanzas} /></Grid>
      <Grid item xs={12} sm={6} lg={3}><MetricCard label="CxP pendiente" value={formatoMoneda(resumen.saldoCxP)} helper={`${finanzas.cxp.length} documentos`} icon={<ShoppingCartIcon />} tone="red" loading={loadingFinanzas} /></Grid>
      <Grid item xs={12} sm={6} lg={3}><MetricCard label="Período actual" value={finanzas.periodo ? `${String(finanzas.periodo.mes).padStart(2, "0")}/${finanzas.periodo.anio}` : "Sin período"} helper={finanzas.periodo?.estado || "Configura el período financiero"} icon={<EventNoteIcon />} tone="slate" loading={loadingFinanzas} /></Grid>
      <Grid item xs={12} sm={6} lg={3}><MetricCard label="Producción del mes" value={formatoNumero(resumen.produccionMes)} helper="Registros de producción" icon={<PrecisionManufacturingIcon />} tone="teal" loading={loadingOperativo} /></Grid>
      <Grid item xs={12} sm={6} lg={3}><MetricCard label="Inventario crítico" value={formatoNumero(resumen.inventarioCritico)} helper={resumen.inventarioCritico ? "Ingredientes bajo mínimo" : "Sin alertas críticas"} icon={<WarningAmberIcon />} tone={resumen.inventarioCritico ? "red" : "green"} loading={loadingOperativo} /></Grid>
      <Grid item xs={12} sm={6} lg={3}><MetricCard label="Productos con poco stock" icon={<InventoryIcon />} tone="amber" unavailable loading={loadingOperativo} /></Grid>
    </Grid>

    <Grid container spacing={2}>
      <Grid item xs={12} lg={7}><AppCard title="Actividad de producción" subtitle="Últimos registros disponibles" action={<AppBadge label="Datos reales" tone="info" />} sx={{ height: "100%" }}>{loadingOperativo ? <ContentSkeleton lines={6} /> : resumen.produccionDias.length ? <Stack spacing={1.75} sx={{ px: 2.5, pb: 2.5, pt: 1.5 }}>{resumen.produccionDias.map((dia) => <Box key={dia.fecha}><Stack direction="row" justifyContent="space-between" sx={{ mb: 0.75 }}><Typography variant="body2">{formatoFecha(dia.fecha)}</Typography><Typography variant="body2" fontWeight={650}>{formatoNumero(dia.cantidad)}</Typography></Stack><LinearProgress variant="determinate" value={(dia.cantidad / maxProduccion) * 100} sx={{ height: 8, borderRadius: 5, bgcolor: "action.hover" }} /></Box>)}</Stack> : <Box sx={{ px: 2.5, pb: 3 }}><Typography variant="body2" color="text.secondary">Todavía no hay producción registrada.</Typography></Box>}</AppCard></Grid>
      <Grid item xs={12} lg={5}><AppCard title="Mermas recientes" subtitle="Últimos ajustes y pérdidas registradas" action={<AppBadge label={`${operativo.mermas.length} recientes`} tone={operativo.mermas.length ? "warning" : "neutral"} />} sx={{ height: "100%" }}>{loadingOperativo ? <ContentSkeleton lines={5} /> : operativo.mermas.length ? <List disablePadding sx={{ px: 1, pb: 1 }}>{operativo.mermas.map((merma) => <ListItem key={merma.id} divider><ListItemText primary={`${merma.item}: ${formatoNumero(merma.cantidad)}`} secondary={`${formatoFecha(merma.fecha)} · ${merma.motivo || "Sin motivo"}`} /></ListItem>)}</List> : <Box sx={{ px: 2.5, pb: 3 }}><Typography variant="body2" color="text.secondary">No hay mermas registradas.</Typography></Box>}</AppCard></Grid>
      <Grid item xs={12}><AppCard title="Sugerencias de compra" subtitle="Reposición calculada desde consumo y stock"><Box sx={{ px: 2, pb: 2 }}><DataTable loading={loadingOperativo} rows={operativo.sugerencias} getRowId={(row) => row.ingredienteId || row.nombre} columns={[{ field: "nombre", headerName: "Ingrediente", minWidth: 180 }, { field: "stockActual", headerName: "Stock actual", align: "right", renderCell: (row) => `${formatoNumero(row.stockActual)} ${row.unidadBase}` }, { field: "cantidadSugerida", headerName: "Cantidad sugerida", align: "right", renderCell: (row) => `${formatoNumero(row.cantidadSugerida)} ${row.unidadBase}` }]} emptyMessage="No hay sugerencias de compra activas." /></Box></AppCard></Grid>
      <Grid item xs={12}><AppCard title="Inventario valorizado" subtitle="Valor calculado desde los lotes disponibles" action={<AppBadge label={formatoMoneda(operativo.inventario.valorTotal)} tone="success" />}><Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ px: 2.5, pb: 2.5, pt: 1.25 }}><Typography variant="body2" color="text.secondary">Los saldos financieros corresponden a la entidad seleccionada; inventario y producción corresponden a la operación general.</Typography><Typography variant="body2" color="text.secondary">Actualizado al cargar la página.</Typography></Stack></AppCard></Grid>
    </Grid>
  </Box>;
}
