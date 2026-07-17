import { useEffect, useMemo, useState } from "react";
import { Alert, Box, Grid, MenuItem, Paper, Skeleton, Stack, TextField, Typography } from "@mui/material";
import AccountBalanceWalletIcon from "@mui/icons-material/AccountBalanceWalletOutlined";
import SavingsIcon from "@mui/icons-material/SavingsOutlined";
import PriceCheckIcon from "@mui/icons-material/PriceCheckOutlined";
import AccountTreeIcon from "@mui/icons-material/AccountTreeOutlined";
import KpiCard from "../KpiCard";
import DataTable from "../DataTable";
import EmptyState from "../EmptyState";
import StatusChip from "../StatusChip";
import { fechaISO, formatoFecha, formatoMoneda } from "../../utils/format";
import { dashboardPoliticasFinancieras, listarEntidadesFinancieras } from "../../api/endpoints";

function rango(periodo) { const hasta = new Date(); const desde = new Date(hasta); if (periodo === "hoy") desde.setHours(0, 0, 0, 0); else if (periodo === "semana") desde.setDate(hasta.getDate() - 6); else desde.setDate(1); return { desde: fechaISO(desde), hasta: fechaISO(hasta) }; }

export default function MpfExecutivePanel() {
  const [entidades, setEntidades] = useState([]); const [entidadId, setEntidadId] = useState(""); const [periodo, setPeriodo] = useState("mes");
  const [datos, setDatos] = useState(null); const [cargando, setCargando] = useState(true); const [error, setError] = useState("");
  useEffect(() => { listarEntidadesFinancieras().then((rows) => { setEntidades(rows); setEntidadId(rows[0] ? String(rows[0].id) : ""); }).catch((e) => { setError(e.message); setCargando(false); }); }, []);
  useEffect(() => { if (!entidadId) return; setCargando(true); setError(""); dashboardPoliticasFinancieras(entidadId, rango(periodo)).then(setDatos).catch((e) => setError(e.message)).finally(() => setCargando(false)); }, [entidadId, periodo]);
  const sinDatos = !cargando && !error && (!datos || datos.aplicaciones === 0);
  const entidad = useMemo(() => entidades.find((e) => String(e.id) === String(entidadId)), [entidades, entidadId]);
  return <Paper variant="outlined" sx={{ borderRadius: 3, p: { xs: 2, sm: 2.5 }, mb: 3 }}>
    <Stack direction={{ xs: "column", md: "row" }} justifyContent="space-between" spacing={1.5} sx={{ mb: 2 }}><Box><Typography variant="h6">Dashboard ejecutivo financiero</Typography><Typography variant="body2" color="text.secondary">Decisiones del dinero recibido según las políticas activas.</Typography></Box><Stack direction="row" spacing={1}><TextField select size="small" label="Entidad" value={entidadId} onChange={(e) => setEntidadId(e.target.value)} sx={{ minWidth: 150 }}>{entidades.map((e) => <MenuItem key={e.id} value={e.id}>{e.nombre}</MenuItem>)}</TextField><TextField select size="small" label="Período" value={periodo} onChange={(e) => setPeriodo(e.target.value)} sx={{ minWidth: 130 }}><MenuItem value="hoy">Hoy</MenuItem><MenuItem value="semana">7 días</MenuItem><MenuItem value="mes">Este mes</MenuItem></TextField></Stack></Stack>
    {error && <Alert severity="error">No se pudo cargar el dashboard financiero: {error}</Alert>}
    {sinDatos && <EmptyState title="Aún no hay decisiones financieras" description="Activa una política y registra cobros para ver la distribución del dinero." />}
    {cargando && <Skeleton variant="rounded" height={220} />}
    {!cargando && !error && !sinDatos && <><Grid container spacing={2} sx={{ mb: 2 }}><Grid item xs={12} sm={6} lg={2.4}><KpiCard title="Recibido" value={formatoMoneda(datos.recibido_minor / 100)} icon={<AccountBalanceWalletIcon />} color="info" /></Grid><Grid item xs={12} sm={6} lg={2.4}><KpiCard title="Costo recuperado" value={formatoMoneda(datos.costo_recuperado_minor / 100)} icon={<PriceCheckIcon />} color="warning" /></Grid><Grid item xs={12} sm={6} lg={2.4}><KpiCard title="Distribuido" value={formatoMoneda(datos.distribuido_minor / 100)} icon={<AccountTreeIcon />} color="secondary" /></Grid><Grid item xs={12} sm={6} lg={2.4}><KpiCard title="Reservado" value={formatoMoneda(datos.reservado_minor / 100)} icon={<SavingsIcon />} color="primary" /></Grid><Grid item xs={12} sm={6} lg={2.4}><KpiCard title="Disponible" value={formatoMoneda(datos.disponible_minor / 100)} icon={<SavingsIcon />} color="success" /></Grid></Grid>
      <Grid container spacing={2}><Grid item xs={12} lg={5}><Paper variant="outlined" sx={{ p: 2, height: "100%" }}><Typography variant="subtitle2" color="text.secondary">Política activa</Typography>{datos.politica_activa ? <><Typography variant="h6">{datos.politica_activa.nombre}</Typography><StatusChip label={`Versión ${datos.politica_activa.version}`} tone="success" /></> : <Typography sx={{ mt: 1 }}>No hay política activa para cobros.</Typography>}</Paper></Grid><Grid item xs={12} lg={7}><Typography variant="subtitle2" sx={{ mb: 1 }}>Saldos por bolsillo</Typography><DataTable searchable={false} rows={datos.bolsillos} rowsPerPageOptions={[5]} emptyMessage="Sin reservas en el período." columns={[{ field: "nombre", headerName: "Bolsillo" }, { field: "tipo", headerName: "Tipo" }, { field: "reservado_minor", headerName: "Saldo reservado", align: "right", renderCell: (r) => formatoMoneda(r.reservado_minor / 100) }]} /></Grid><Grid item xs={12}><Typography variant="subtitle2" sx={{ mb: 1 }}>Eventos recientes del MPF {entidad ? `· ${entidad.nombre}` : ""}</Typography><DataTable searchable={false} rows={datos.eventos_recientes} rowsPerPageOptions={[5, 10]} emptyMessage="Sin eventos MPF en el período." columns={[{ field: "fecha", headerName: "Fecha", renderCell: (r) => formatoFecha(r.fecha) }, { field: "descripcion", headerName: "Evento", minWidth: 240 }, { field: "politica", headerName: "Política" }, { field: "version", headerName: "Versión" }, { field: "importe_ingreso_minor", headerName: "Recibido", align: "right", renderCell: (r) => formatoMoneda(r.importe_ingreso_minor / 100) }, { field: "importe_distribuido_minor", headerName: "Distribuido", align: "right", renderCell: (r) => formatoMoneda(r.importe_distribuido_minor / 100) }]} /></Grid></Grid></>}
  </Paper>;
}
