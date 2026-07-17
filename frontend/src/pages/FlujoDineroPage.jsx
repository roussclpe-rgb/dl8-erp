import { useEffect, useState } from "react";
import { Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Divider, Grid, MenuItem, Paper, Skeleton, Stack, TextField, Typography } from "@mui/material";
import { useSearchParams } from "react-router-dom";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import PageHeader from "../components/PageHeader";
import DataTable from "../components/DataTable";
import EmptyState from "../components/EmptyState";
import { useNotify } from "../hooks/useNotify";
import { formatoFecha, formatoMoneda } from "../utils/format";
import { flujoDineroEvento, listarEntidadesFinancieras, listarFlujosDinero, revertirDistribucionPolitica, vistaPreviaReversionPolitica } from "../api/endpoints";

function Paso({ titulo, detalle, importe, tone = "default" }) {
  const colores = { success: "success.light", warning: "warning.light", info: "info.light", default: "grey.100" };
  return <><Paper variant="outlined" sx={{ p: 2, borderRadius: 3, bgcolor: colores[tone], width: "100%" }}><Typography variant="overline">{titulo}</Typography><Typography variant="body1" sx={{ fontWeight: 700 }}>{detalle}</Typography>{importe != null && <Typography variant="h6">{formatoMoneda(importe / 100)}</Typography>}</Paper><ArrowDownwardIcon color="action" sx={{ my: .5 }} /></>;
}

const filtrosIniciales = { desde: "", hasta: "", venta_id: "", cobro_id: "" };

export default function FlujoDineroPage() {
  const notify = useNotify();
  const [searchParams] = useSearchParams(); const eventoInicial = searchParams.get("evento_id");
  const [entidades, setEntidades] = useState([]); const [entidadId, setEntidadId] = useState("");
  const [filtros, setFiltros] = useState(filtrosIniciales); const [flujos, setFlujos] = useState([]);
  const [seleccionado, setSeleccionado] = useState(null); const [flujo, setFlujo] = useState(null);
  const [cargandoEntidades, setCargandoEntidades] = useState(true); const [cargando, setCargando] = useState(false); const [cargandoDetalle, setCargandoDetalle] = useState(false); const [error, setError] = useState("");
  const [vistaReversion, setVistaReversion] = useState(null); const [motivoReversion, setMotivoReversion] = useState(""); const [revirtiendo, setRevirtiendo] = useState(false);

  useEffect(() => {
    listarEntidadesFinancieras().then((rows) => { setEntidades(rows); setEntidadId(rows[0] ? String(rows[0].id) : ""); }).catch((e) => setError(e.message)).finally(() => setCargandoEntidades(false));
  }, []);

  const cargar = async (nuevosFiltros = filtros) => {
    if (!entidadId) return;
    setCargando(true); setError(""); setSeleccionado(null); setFlujo(null);
    try { setFlujos(await listarFlujosDinero(entidadId, Object.fromEntries(Object.entries(nuevosFiltros).filter(([, value]) => value !== "")))); }
    catch (e) { setError(e.message); } finally { setCargando(false); }
  };
  useEffect(() => { if (entidadId) cargar(filtrosIniciales); }, [entidadId]); // La lista se vuelve a consultar sólo al aplicar filtros.

  const verFlujo = async (row) => {
    setSeleccionado(row); setFlujo(null); setCargandoDetalle(true); setError("");
    try { setFlujo(await flujoDineroEvento(entidadId, row.evento_id)); } catch (e) { setError(e.message); } finally { setCargandoDetalle(false); }
  };
  useEffect(() => { if (entidadId && eventoInicial) verFlujo({ evento_id: eventoInicial }); }, [entidadId, eventoInicial]);
  const cambiarFiltro = (campo) => (e) => setFiltros((prev) => ({ ...prev, [campo]: e.target.value }));
  const abrirReversion = async () => { try { setVistaReversion(await vistaPreviaReversionPolitica(entidadId, flujo.evento_id)); setMotivoReversion(""); } catch (e) { setError(e.message); } };
  const confirmarReversion = async () => { try { setRevirtiendo(true); const resultado = await revertirDistribucionPolitica(entidadId, flujo.evento_id, motivoReversion); setVistaReversion(null); setFlujo(null); setSeleccionado(null); await cargar(); notify.success(`Distribución revertida. Se retiraron ${resultado.asignaciones_retiradas} asignaciones; el cobro quedó sin política.`); } catch (e) { const mensaje = e.response?.data?.error || e.message || "No se pudo revertir la distribución."; setError(mensaje); notify.error(mensaje); } finally { setRevirtiendo(false); } };

  return <Box>
    <PageHeader title="Flujo de dinero por cobro" subtitle="Recorrido auditable desde la venta hasta el dinero disponible, calculado por el motor financiero." />
    {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError("")}>{error}</Alert>}
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 2.5 }, mb: 2.5, borderRadius: 3 }}>
      <Grid container spacing={2} alignItems="center">
        <Grid item xs={12} sm={6} md={3}><TextField select fullWidth label="Entidad" value={entidadId} disabled={cargandoEntidades} onChange={(e) => setEntidadId(e.target.value)}>{entidades.map((e) => <MenuItem key={e.id} value={e.id}>{e.nombre}</MenuItem>)}</TextField></Grid>
        <Grid item xs={12} sm={6} md={2}><TextField fullWidth type="date" label="Desde" value={filtros.desde} onChange={cambiarFiltro("desde")} InputLabelProps={{ shrink: true }} /></Grid>
        <Grid item xs={12} sm={6} md={2}><TextField fullWidth type="date" label="Hasta" value={filtros.hasta} onChange={cambiarFiltro("hasta")} InputLabelProps={{ shrink: true }} /></Grid>
        <Grid item xs={6} sm={3} md={2}><TextField fullWidth type="number" label="ID venta" value={filtros.venta_id} onChange={cambiarFiltro("venta_id")} inputProps={{ min: 1 }} /></Grid>
        <Grid item xs={6} sm={3} md={2}><TextField fullWidth type="number" label="ID cobro" value={filtros.cobro_id} onChange={cambiarFiltro("cobro_id")} inputProps={{ min: 1 }} /></Grid>
        <Grid item xs={12} md={1}><Stack direction="row" spacing={1}><Button variant="contained" disabled={!entidadId || cargando} onClick={() => cargar()}>Filtrar</Button><Button onClick={() => { setFiltros(filtrosIniciales); cargar(filtrosIniciales); }}>Limpiar</Button></Stack></Grid>
      </Grid>
    </Paper>
    {cargandoEntidades || cargando ? <Skeleton variant="rounded" height={260} /> : !entidadId ? <EmptyState title="No tienes entidades financieras disponibles" subtitle="Solicita acceso a una entidad para consultar sus cobros." /> : <Stack spacing={2.5}>
      <DataTable searchable={false} rows={flujos} getRowId={(row) => row.evento_id} rowsPerPageOptions={[5, 10, 25]} emptyMessage="No hay cobros que cumplan los filtros." columns={[
        { field: "fecha", headerName: "Fecha", renderCell: (r) => formatoFecha(r.fecha) },
        { field: "venta_id", headerName: "Venta", minWidth: 120, renderCell: (r) => `${r.folio || "Venta"} #${r.venta_id}` },
        { field: "cobro_id", headerName: "Cobro", renderCell: (r) => `#${r.cobro_id}` },
        { field: "cuenta_financiera", headerName: "Cuenta receptora", minWidth: 170 },
        { field: "importe_ingreso_minor", headerName: "Recibido", align: "right", renderCell: (r) => formatoMoneda(r.importe_ingreso_minor / 100) },
        { field: "estado", headerName: "Estado", renderCell: (r) => <Chip size="small" label={r.estado} color={r.estado === "revertido" ? "warning" : "success"} /> },
        { field: "ver", headerName: "", sortable: false, renderCell: (r) => <Button size="small" onClick={() => verFlujo(r)}>Ver recorrido</Button> },
      ]} />
      {seleccionado && cargandoDetalle && <Skeleton variant="rounded" height={240} />}
      {flujo && <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 }, borderRadius: 3 }}>
        <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" spacing={1} sx={{ mb: 2 }}><Box><Typography variant="h6">Recorrido del cobro #{flujo.cobro.id}</Typography><Typography variant="body2" color="text.secondary">Evento financiero #{flujo.evento_id} · {formatoFecha(flujo.cobro.fecha)}</Typography></Box><Chip label={flujo.estado} color={flujo.estado === "revertido" ? "warning" : "success"} /></Stack>
        {flujo.reversion && <Alert severity="warning" sx={{ mb: 2 }}>Este cobro fue revertido por el evento #{flujo.reversion.id} el {formatoFecha(flujo.reversion.fecha)}. Los importes se muestran como trazabilidad del cobro original.</Alert>}
        <Stack alignItems="center" sx={{ maxWidth: 680, mx: "auto" }}>
          <Paso titulo="Venta" detalle={`${flujo.venta.folio || "Venta"} #${flujo.venta.id}`} />
          <Paso titulo="Cobro y cuenta financiera" detalle={`${flujo.cobro.metodo_pago} · ${flujo.cobro.cuenta?.nombre || "Cuenta no disponible"}`} importe={flujo.cobro.importe_minor} tone="info" />
          <Paso titulo="Costo recuperado" detalle={flujo.costo_recuperado.bolsillo || "Sin recuperación de costo"} importe={flujo.costo_recuperado.importe_minor} tone="warning" />
          {flujo.distribuciones.map((d, i) => <Paso key={`${d.regla}-${i}`} titulo={`Distribución · ${d.regla}`} detalle={d.bolsillo} importe={d.importe_minor} />)}
          <Paso titulo="Disponible final" detalle="Permanece sin asignar en la cuenta receptora" importe={flujo.disponible_final_minor} tone="success" />
        </Stack>
        <Divider sx={{ my: 2 }} /><Stack direction="row" justifyContent="space-between" alignItems="center"><Typography variant="subtitle2">Política aplicada: {flujo.politica.nombre} · versión {flujo.politica.version}</Typography><Button color="error" variant="outlined" disabled={flujo.estado === "revertido"} onClick={abrirReversion}>Revertir distribución financiera</Button></Stack>
        <Typography variant="caption" color="text.secondary">Reglas auditables: {flujo.politica.reglas.map((r) => `${r.orden}. ${r.nombre} (${r.tipo === "porcentaje" ? `${r.valor_minor / 100}%` : formatoMoneda(r.valor_minor / 100)} sobre ${r.base})`).join(" · ") || "Sin reglas"}</Typography>
      </Paper>}
    </Stack>}
    <Dialog open={Boolean(vistaReversion)} onClose={() => !revirtiendo && setVistaReversion(null)} fullWidth maxWidth="sm"><DialogTitle>Revertir distribución financiera</DialogTitle><DialogContent><Stack spacing={1.5} sx={{ pt: 1 }}><Alert severity="warning">El cobro y su cuenta financiera no se modificarán. Solo se retirarán las asignaciones de esta política.</Alert><Typography>Cobro #{vistaReversion?.cobro.id} · Venta #{vistaReversion?.cobro.folio} · {formatoMoneda((vistaReversion?.cobro.importe_minor || 0) / 100)}</Typography><Typography>Política: {vistaReversion?.politica.nombre} · v{vistaReversion?.politica.version}</Typography><Typography fontWeight={700}>Bolsillos y montos a retirar</Typography>{vistaReversion?.distribuciones.map((d, i) => <Typography key={`${d.bolsillo_id}-${i}`}>• {d.bolsillo}: {formatoMoneda(d.importe_minor / 100)}{d.meta ? ` · Meta: ${d.meta}` : ""}</Typography>)}<Typography fontWeight={700}>Metas afectadas</Typography><Typography>{vistaReversion?.metas_afectadas.length ? vistaReversion.metas_afectadas.map((m) => m.nombre).join(", ") : "Ninguna"}</Typography><TextField required multiline minRows={2} label="Motivo de la reversión" value={motivoReversion} onChange={(e) => setMotivoReversion(e.target.value)} /></Stack></DialogContent><DialogActions><Button disabled={revirtiendo} onClick={() => setVistaReversion(null)}>Cancelar</Button><Button color="error" variant="contained" disabled={!motivoReversion.trim() || revirtiendo} onClick={confirmarReversion}>{revirtiendo ? "Revirtiendo…" : "Confirmar reversión"}</Button></DialogActions></Dialog>
  </Box>;
}
