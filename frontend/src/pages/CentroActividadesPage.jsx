import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Alert, Box, Button, Checkbox, Chip, CircularProgress, Divider, Grid, List, ListItemButton, ListItemIcon, ListItemText, Stack, Typography } from "@mui/material";
import ArrowOutwardIcon from "@mui/icons-material/ArrowOutward";
import AssignmentTurnedInOutlinedIcon from "@mui/icons-material/AssignmentTurnedInOutlined";
import Inventory2OutlinedIcon from "@mui/icons-material/Inventory2Outlined";
import LocalShippingOutlinedIcon from "@mui/icons-material/LocalShippingOutlined";
import PaymentsOutlinedIcon from "@mui/icons-material/PaymentsOutlined";
import PrecisionManufacturingOutlinedIcon from "@mui/icons-material/PrecisionManufacturingOutlined";
import ReceiptLongOutlinedIcon from "@mui/icons-material/ReceiptLongOutlined";
import WarningAmberOutlinedIcon from "@mui/icons-material/WarningAmberOutlined";
import AccountBalanceOutlinedIcon from "@mui/icons-material/AccountBalanceOutlined";
import PointOfSaleOutlinedIcon from "@mui/icons-material/PointOfSaleOutlined";
import AppCard from "../components/ui/AppCard";
import PageHeader from "../components/PageHeader";
import { useAuth } from "../context/AuthContext";
import { useCajaActiva } from "../hooks/useCajaActiva";
import { fechaHoyISO } from "../utils/format";
import {
  factibilidadProduccion, listarAlertasFinancieras, listarDocumentosCxP, listarEntidadesFinancieras,
  listarIngredientes, listarVentasPendientes, reporteSugerenciasCompra,
} from "../api/endpoints";

const today = fechaHoyISO();
const number = (value) => Number(value || 0);

function taskStorageKey(userId) {
  return `dl8:centro-actividades:${userId || "anonimo"}:${today}`;
}

function readCompleted(userId) {
  try { return JSON.parse(localStorage.getItem(taskStorageKey(userId)) || "[]"); } catch { return []; }
}

function ActivityCard({ item, checked, onToggle }) {
  const navigate = useNavigate();
  return <ListItemButton
    onClick={() => navigate(item.to)}
    sx={{ alignItems: "flex-start", px: 2.25, py: 1.4, opacity: checked ? 0.62 : 1, "&:hover": { bgcolor: "action.hover" } }}
  >
    <ListItemIcon sx={{ minWidth: 42, pt: 0.2, color: item.color }}>{item.icon}</ListItemIcon>
    <ListItemText
      primary={item.title}
      secondary={item.detail}
      primaryTypographyProps={{ fontWeight: 650, sx: { textDecoration: checked ? "line-through" : "none" } }}
      secondaryTypographyProps={{ sx: { mt: 0.25 } }}
    />
    <Stack direction="row" alignItems="center" spacing={0.5}>
      <Chip size="small" color={item.tone} label={item.count} />
      <Checkbox
        checked={checked}
        disabled={item.requiresSystemCheck}
        onClick={(event) => event.stopPropagation()}
        onChange={() => onToggle(item.id)}
        inputProps={{ "aria-label": `Marcar ${item.title} como realizada` }}
      />
    </Stack>
  </ListItemButton>;
}

export default function CentroActividadesPage() {
  const { usuario } = useAuth();
  const { turno, turnoAbierto, loading: loadingCaja } = useCajaActiva();
  const [data, setData] = useState({ ingredientes: [], sugerencias: [], producciones: [], cxc: [], cxp: [], alertas: [] });
  const [completed, setCompleted] = useState(() => readCompleted(usuario?.id));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => { setCompleted(readCompleted(usuario?.id)); }, [usuario?.id]);
  useEffect(() => { localStorage.setItem(taskStorageKey(usuario?.id), JSON.stringify(completed)); }, [completed, usuario?.id]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true); setError("");
      const entities = await listarEntidadesFinancieras();
      const entityId = entities[0]?.id;
      const requests = [listarIngredientes(), reporteSugerenciasCompra(), factibilidadProduccion()];
      if (entityId) requests.push(listarVentasPendientes({ entidad_id: entityId }), listarDocumentosCxP({ entidad_id: entityId }), listarAlertasFinancieras(entityId));
      const results = await Promise.allSettled(requests);
      if (!active) return;
      const value = (index, fallback = []) => results[index]?.status === "fulfilled" ? results[index].value : fallback;
      setData({ ingredientes: value(0), sugerencias: value(1), producciones: value(2), cxc: value(3), cxp: value(4), alertas: value(5) });
      const failures = results.filter((result) => result.status === "rejected").length;
      if (failures) setError(`${failures} fuente(s) no pudieron cargarse. El resto de actividades sigue disponible.`);
      setLoading(false);
    };
    load().catch((loadError) => { if (active) { setError(loadError.message || "No se pudo cargar el Centro de Actividades."); setLoading(false); } });
    return () => { active = false; };
  }, []);

  const items = useMemo(() => {
    const criticalStock = data.ingredientes.filter((item) => item.bajoMinimo);
    const soonOut = data.sugerencias.filter((item) => !item.bajoMinimo && number(item.cantidadSugerida) > 0);
    const productionAlerts = data.producciones.filter((item) => item.estado === "stock_insuficiente");
    const pendingCharges = data.cxc.filter((item) => number(item.saldo) > 0 && item.estado !== "anulada");
    const pendingPayments = data.cxp.filter((item) => number(item.saldo) > 0 && item.estado !== "anulada");
    const financialAlerts = data.alertas.filter((item) => ["activa", "leida"].includes(item.estado));
    return [
      { id: "apertura-caja", step: 1, title: "Abrir caja", detail: turnoAbierto ? `Turno abierto en ${turno?.caja_nombre || "la caja seleccionada"}.` : "Abre el turno antes de registrar ventas, cobros o pagos en efectivo.", count: turnoAbierto ? "Abierta" : "Pendiente", to: "/caja", icon: <PointOfSaleOutlinedIcon />, color: turnoAbierto ? "success.main" : "error.main", tone: turnoAbierto ? "success" : "error", requiresSystemCheck: true, requiresAction: !turnoAbierto },
      { id: "alertas-financieras", step: 2, title: "Revisar alertas financieras", detail: financialAlerts.length ? financialAlerts[0].mensaje : "No hay alertas financieras activas.", count: financialAlerts.length, to: "/alertas-financieras", icon: <AccountBalanceOutlinedIcon />, color: "error.main", tone: financialAlerts.length ? "error" : "success", requiresAction: financialAlerts.length > 0 },
      { id: "cobros", step: 3, title: "Revisar cobros pendientes", detail: pendingCharges.length ? "Ventas con saldo por cobrar; prioriza vencidos y compromisos de hoy." : "No hay cobros pendientes.", count: pendingCharges.length, to: "/ventas", icon: <ReceiptLongOutlinedIcon />, color: "primary.main", tone: pendingCharges.length ? "info" : "success", requiresAction: pendingCharges.length > 0 },
      { id: "pagos", step: 4, title: "Programar pagos pendientes", detail: pendingPayments.length ? "Documentos de compra con saldo pendiente; valida caja y cuentas antes de pagar." : "No hay pagos pendientes.", count: pendingPayments.length, to: "/compras", icon: <PaymentsOutlinedIcon />, color: "warning.main", tone: pendingPayments.length ? "warning" : "success", requiresAction: pendingPayments.length > 0 },
      { id: "stock-critico", step: 5, title: "Atender stock crítico", detail: criticalStock.length ? `${criticalStock.slice(0, 2).map((item) => item.nombre).join(", ")}${criticalStock.length > 2 ? " y más" : ""}.` : "Todos los ingredientes están sobre su mínimo.", count: criticalStock.length, to: "/ingredientes", icon: <WarningAmberOutlinedIcon />, color: "error.main", tone: criticalStock.length ? "error" : "success", requiresAction: criticalStock.length > 0 },
      { id: "proximos-agotarse", step: 6, title: "Prevenir agotamientos", detail: soonOut.length ? "Ingredientes con cobertura menor a la deseada." : "No hay ingredientes próximos a agotarse.", count: soonOut.length, to: "/compras", icon: <Inventory2OutlinedIcon />, color: "warning.main", tone: soonOut.length ? "warning" : "success", requiresAction: soonOut.length > 0 },
      { id: "compras", step: 7, title: "Gestionar compras pendientes", detail: data.sugerencias.length ? "Repón los insumos priorizados antes de iniciar la producción." : "No hay reposiciones sugeridas.", count: data.sugerencias.length, to: "/compras", icon: <LocalShippingOutlinedIcon />, color: "warning.main", tone: data.sugerencias.length ? "warning" : "success", requiresAction: data.sugerencias.length > 0 },
      { id: "alertas-inventario", step: 8, title: "Confirmar alertas de inventario", detail: criticalStock.length || soonOut.length ? "Revisa mínimos y cobertura luego de planificar las compras." : "El inventario no presenta alertas.", count: criticalStock.length + soonOut.length, to: "/ingredientes", icon: <Inventory2OutlinedIcon />, color: "error.main", tone: criticalStock.length || soonOut.length ? "error" : "success", requiresAction: criticalStock.length + soonOut.length > 0 },
      { id: "alertas-produccion", step: 9, title: "Revisar alertas de producción", detail: productionAlerts.length ? "Hay recetas bloqueadas por faltantes de ingredientes." : "No se detectaron bloqueos de producción.", count: productionAlerts.length, to: "/producciones", icon: <PrecisionManufacturingOutlinedIcon />, color: "secondary.main", tone: productionAlerts.length ? "warning" : "success", requiresAction: productionAlerts.length > 0 },
      { id: "producciones", step: 10, title: "Ejecutar producciones pendientes", detail: productionAlerts.length ? "Completa compras o ajustes para habilitar las recetas pendientes." : "Las recetas vigentes tienen insumos disponibles.", count: productionAlerts.length, to: "/producciones", icon: <PrecisionManufacturingOutlinedIcon />, color: "secondary.main", tone: productionAlerts.length ? "warning" : "success", requiresAction: productionAlerts.length > 0 },
      { id: "cierre-caja", step: 11, title: "Al finalizar: cuadrar y cerrar caja", detail: turnoAbierto ? "Al cierre, registra el efectivo contado y revisa cualquier diferencia." : "Al terminar la jornada, realiza el arqueo y cierre del turno de caja.", count: turnoAbierto ? "Por cerrar" : "Al final", to: "/caja", icon: <PointOfSaleOutlinedIcon />, color: "text.secondary", tone: "default", requiresAction: false },
    ];
  }, [data, turno, turnoAbierto]);

  const toggle = (id) => setCompleted((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  const isChecked = (item) => item.id === "apertura-caja" ? turnoAbierto : completed.includes(item.id);
  const outstanding = items.filter((item) => item.requiresAction).length;
  const completedCount = items.filter(isChecked).length;

  return <Box>
    <PageHeader
      title="Centro de Actividades"
      subtitle={`Rutina operativa del ${today.split("-").reverse().join("/")}: sigue el orden para no omitir controles. Las marcas se guardan solo para hoy.`}
      extra={<Button variant="outlined" endIcon={<ArrowOutwardIcon />} onClick={() => window.location.reload()}>Actualizar</Button>}
    />
    {error && <Alert severity="warning" sx={{ mb: 2 }}>{error}</Alert>}
    <Grid container spacing={2.25}>
      <Grid item xs={12} lg={4}>
        <AppCard title="Qué hacer hoy" subtitle="Prioriza y marca cada frente cuando esté atendido." sx={{ height: "100%" }}>
          <Box sx={{ px: 2.5, pb: 2.5 }}>
            {loading ? <Stack alignItems="center" sx={{ py: 5 }}><CircularProgress size={30} /></Stack> : <>
              <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mt: 1.25 }}><AssignmentTurnedInOutlinedIcon color="primary" sx={{ fontSize: 38 }} /><Box><Typography variant="h4">{completedCount}/{items.length}</Typography><Typography variant="body2" color="text.secondary">actividades revisadas</Typography></Box></Stack>
              <Divider sx={{ my: 2 }} />
              <Typography variant="body2" color={outstanding ? "text.primary" : "success.main"} fontWeight={600}>{outstanding ? `${outstanding} paso(s) requiere(n) atención.` : "Todo está controlado por ahora."}</Typography>
            </>}
          </Box>
        </AppCard>
      </Grid>
      <Grid item xs={12} lg={8}>
        <AppCard title="Checklist de operación" subtitle="Selecciona una actividad para abrir el módulo correspondiente." sx={{ height: "100%" }}>
          {loading || loadingCaja ? <Stack alignItems="center" sx={{ py: 8 }}><CircularProgress /></Stack> : <List disablePadding>{items.map((item, index) => <Box key={item.id}>{index > 0 && <Divider component="li" />}<ActivityCard item={{ ...item, title: `${item.step}. ${item.title}` }} checked={isChecked(item)} onToggle={toggle} /></Box>)}</List>}
        </AppCard>
      </Grid>
    </Grid>
  </Box>;
}
