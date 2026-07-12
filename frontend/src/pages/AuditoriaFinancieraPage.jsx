import { useEffect, useState } from "react";
import { Alert, Box, Button, Chip, Grid, MenuItem, Paper, Skeleton, Stack, TextField, Typography } from "@mui/material";
import { useNavigate } from "react-router-dom";
import PageHeader from "../components/PageHeader";
import DataTable from "../components/DataTable";
import EmptyState from "../components/EmptyState";
import { formatoFecha, formatoMoneda } from "../utils/format";
import { auditoriaMpf, listarBolsillos, listarEntidadesFinancieras, listarPoliticasFinancieras } from "../api/endpoints";

const inicial = { desde: "", hasta: "", tipo_evento: "", venta_id: "", cobro_id: "", evento_id: "", politica_id: "", bolsillo_id: "" };

export default function AuditoriaFinancieraPage() {
  const navigate = useNavigate(); const [entidades, setEntidades] = useState([]); const [entidadId, setEntidadId] = useState("");
  const [politicas, setPoliticas] = useState([]); const [bolsillos, setBolsillos] = useState([]); const [filtros, setFiltros] = useState(inicial);
  const [datos, setDatos] = useState({ resultados: [], paginacion: { pagina: 1, por_pagina: 20, total: 0, total_paginas: 0 } });
  const [cargandoEntidades, setCargandoEntidades] = useState(true); const [cargando, setCargando] = useState(false); const [error, setError] = useState("");

  useEffect(() => { listarEntidadesFinancieras().then((rows) => { setEntidades(rows); setEntidadId(rows[0] ? String(rows[0].id) : ""); }).catch((e) => setError(e.message)).finally(() => setCargandoEntidades(false)); }, []);
  const cargar = async (pagina = 1, filtrosActuales = filtros) => {
    if (!entidadId) return; setCargando(true); setError("");
    try { setDatos(await auditoriaMpf(entidadId, { ...Object.fromEntries(Object.entries(filtrosActuales).filter(([, valor]) => valor !== "")), pagina, por_pagina: 20 })); }
    catch (e) { setError(e.message); } finally { setCargando(false); }
  };
  useEffect(() => {
    if (!entidadId) return;
    setFiltros(inicial); setDatos({ resultados: [], paginacion: { pagina: 1, por_pagina: 20, total: 0, total_paginas: 0 } });
    Promise.all([listarPoliticasFinancieras(entidadId), listarBolsillos(entidadId)]).then(([p, b]) => { setPoliticas(p); setBolsillos(b); }).catch((e) => setError(e.message));
    cargar(1, inicial);
  }, [entidadId]);
  const cambiar = (campo) => (e) => setFiltros((prev) => ({ ...prev, [campo]: e.target.value }));
  const paginacion = datos.paginacion;

  return <Box>
    <PageHeader title="Centro de Auditoría Financiera" subtitle="Consulta trazable de cada regla MPF, sus cálculos, destinos y eventos relacionados." />
    {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError("")}>{error}</Alert>}
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 2.5 }, mb: 2.5, borderRadius: 3 }}>
      <Grid container spacing={2}>
        <Grid item xs={12} sm={6} md={3}><TextField select fullWidth label="Entidad" value={entidadId} disabled={cargandoEntidades} onChange={(e) => setEntidadId(e.target.value)}>{entidades.map((e) => <MenuItem key={e.id} value={e.id}>{e.nombre}</MenuItem>)}</TextField></Grid>
        <Grid item xs={12} sm={6} md={3}><TextField select fullWidth label="Tipo de evento" value={filtros.tipo_evento} onChange={cambiar("tipo_evento")}><MenuItem value="">Todos</MenuItem><MenuItem value="cobro_venta">Cobro de venta</MenuItem><MenuItem value="reversion">Reversión</MenuItem></TextField></Grid>
        <Grid item xs={6} sm={3} md={2}><TextField fullWidth type="date" label="Desde" value={filtros.desde} onChange={cambiar("desde")} InputLabelProps={{ shrink: true }} /></Grid>
        <Grid item xs={6} sm={3} md={2}><TextField fullWidth type="date" label="Hasta" value={filtros.hasta} onChange={cambiar("hasta")} InputLabelProps={{ shrink: true }} /></Grid>
        <Grid item xs={6} sm={4} md={2}><TextField fullWidth type="number" label="ID venta" value={filtros.venta_id} onChange={cambiar("venta_id")} inputProps={{ min: 1 }} /></Grid>
        <Grid item xs={6} sm={4} md={2}><TextField fullWidth type="number" label="ID cobro" value={filtros.cobro_id} onChange={cambiar("cobro_id")} inputProps={{ min: 1 }} /></Grid>
        <Grid item xs={6} sm={4} md={2}><TextField fullWidth type="number" label="ID evento" value={filtros.evento_id} onChange={cambiar("evento_id")} inputProps={{ min: 1 }} /></Grid>
        <Grid item xs={12} sm={6} md={3}><TextField select fullWidth label="Política" value={filtros.politica_id} onChange={cambiar("politica_id")}><MenuItem value="">Todas</MenuItem>{politicas.map((p) => <MenuItem key={p.id} value={p.id}>{p.nombre} · v{p.version}</MenuItem>)}</TextField></Grid>
        <Grid item xs={12} sm={6} md={3}><TextField select fullWidth label="Bolsillo destino" value={filtros.bolsillo_id} onChange={cambiar("bolsillo_id")}><MenuItem value="">Todos</MenuItem>{bolsillos.map((b) => <MenuItem key={b.id} value={b.id}>{b.nombre}</MenuItem>)}</TextField></Grid>
        <Grid item xs={12} md={2}><Stack direction="row" spacing={1}><Button variant="contained" disabled={!entidadId || cargando} onClick={() => cargar(1)}>Buscar</Button><Button onClick={() => { setFiltros(inicial); cargar(1, inicial); }}>Limpiar</Button></Stack></Grid>
      </Grid>
    </Paper>
    {cargandoEntidades || cargando ? <Skeleton variant="rounded" height={300} /> : !entidadId ? <EmptyState title="No tienes entidades financieras disponibles" subtitle="Solicita acceso a una entidad para auditar sus movimientos." /> : <>
      <DataTable searchable={false} dense rows={datos.resultados} getRowId={(r) => `${r.evento_id}-${r.regla_id}`} rowsPerPageOptions={[20]} emptyMessage="No hay resultados para los filtros seleccionados." columns={[
        { field: "fecha", headerName: "Fecha", renderCell: (r) => formatoFecha(r.fecha) },
        { field: "venta_id", headerName: "Venta / cobro", minWidth: 140, renderCell: (r) => `${r.folio || "Venta"} #${r.venta_id} · C#${r.cobro_id}` },
        { field: "evento_id", headerName: "Evento", renderCell: (r) => `#${r.evento_id}` },
        { field: "politica", headerName: "Política", minWidth: 155, renderCell: (r) => `${r.politica} · v${r.politica_version}` },
        { field: "regla", headerName: "Regla", minWidth: 140 },
        { field: "accion", headerName: "Acción", renderCell: (r) => r.accion || "aplicar" },
        { field: "condicion_json", headerName: "Condición / resultado", minWidth: 190, renderCell: (r) => { try { const c = JSON.parse(r.condicion_json || "{}"); const e = JSON.parse(r.condicion_evaluada_json || "{}"); return Object.keys(c).length ? `${JSON.stringify(c)} · ${e.aplicada === false ? "no cumplida" : "cumplida"}` : "Sin condición"; } catch (_) { return "Condición no disponible"; } } },
        { field: "importe_base_minor", headerName: "Base", align: "right", renderCell: (r) => formatoMoneda(r.importe_base_minor / 100) },
        { field: "calculo", headerName: "Cálculo", minWidth: 145, renderCell: (r) => r.regla_tipo === "porcentaje" ? `${r.regla_valor_minor / 100}% sobre ${r.regla_base}` : formatoMoneda(r.regla_valor_minor / 100) },
        { field: "bolsillo", headerName: "Destino", minWidth: 130 },
        { field: "monto_minor", headerName: "Monto", align: "right", renderCell: (r) => formatoMoneda(r.monto_minor / 100) },
        { field: "estado", headerName: "Estado", renderCell: (r) => <Stack direction="row" spacing={.5}><Chip size="small" label={r.estado} color={r.estado === "revertido" ? "warning" : "success"} />{r.venta_anulada ? <Chip size="small" label="venta anulada" color="warning" variant="outlined" /> : null}</Stack> },
        { field: "eventos_relacionados", headerName: "Relacionados", minWidth: 155, sortable: false, renderCell: (r) => <Typography variant="caption">Emisión #{r.eventos_relacionados.emision_venta_id}{r.eventos_relacionados.reversion_id ? ` · Reversión #${r.eventos_relacionados.reversion_id}` : ""}</Typography> },
        { field: "acciones", headerName: "", sortable: false, renderCell: (r) => <Button size="small" onClick={() => navigate(`/flujo-dinero?evento_id=${r.evento_id}`)}>Abrir recorrido</Button> },
      ]} />
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 2 }}><Typography variant="body2" color="text.secondary">{paginacion.total} resultados · página {paginacion.pagina} de {paginacion.total_paginas || 1}</Typography><Stack direction="row" spacing={1}><Button disabled={paginacion.pagina <= 1} onClick={() => cargar(paginacion.pagina - 1)}>Anterior</Button><Button disabled={paginacion.pagina >= paginacion.total_paginas} onClick={() => cargar(paginacion.pagina + 1)}>Siguiente</Button></Stack></Stack>
    </>}
  </Box>;
}
