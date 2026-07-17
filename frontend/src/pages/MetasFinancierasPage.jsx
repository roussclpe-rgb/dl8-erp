import { useEffect, useState } from "react";
import { Alert, Box, Button, Chip, Divider, Grid, MenuItem, Paper, Stack, TextField, Typography } from "@mui/material";
import PageHeader from "../components/PageHeader";
import DataTable from "../components/DataTable";
import EmptyState from "../components/EmptyState";
import FormDialog from "../components/FormDialog";
import { useNotify } from "../hooks/useNotify";
import { formatoFecha, formatoMoneda } from "../utils/format";
import { aportesMetaFinanciera, actualizarMetaFinanciera, cambiarEstadoMetaFinanciera, crearMetaFinanciera, listarBolsillos, listarEntidadesFinancieras, listarMetasFinancieras, proyeccionMetaFinanciera } from "../api/endpoints";

const vacia = { nombre: "", monto: "", fecha_objetivo: "", bolsillo_id: "", tipo: "unica", frecuencia_recurrencia: "mensual" };
const dinero = (minor = 0) => formatoMoneda(Number(minor || 0) / 100);

export default function MetasFinancierasPage() {
  const notify = useNotify();
  const [entidades, setEntidades] = useState([]), [entidadId, setEntidadId] = useState(""), [bolsillos, setBolsillos] = useState([]), [metas, setMetas] = useState([]), [proyecciones, setProyecciones] = useState({}), [form, setForm] = useState(vacia), [editando, setEditando] = useState(null), [aportes, setAportes] = useState([]), [metaAportes, setMetaAportes] = useState(null), [loadingAportes, setLoadingAportes] = useState(false), [pausandoId, setPausandoId] = useState(null), [loading, setLoading] = useState(true), [error, setError] = useState(""), [precio, setPrecio] = useState("minorista"), [periodo, setPeriodo] = useState(30);
  const cargar = async (id = entidadId, opciones = { precio, periodo }) => {
    if (!id) return; setLoading(true);
    try {
      const [m, b] = await Promise.all([listarMetasFinancieras(id), listarBolsillos(id)]);
      setMetas(m); setBolsillos(b.filter((x) => x.estado === "activa" && x.tipo !== "sin_asignar"));
      const activas = m.filter((x) => x.estado === "activa");
      const proy = await Promise.all(activas.map(async (x) => [x.id, await proyeccionMetaFinanciera(id, x.id, { dias: opciones.periodo, precio: opciones.precio })]));
      setProyecciones(Object.fromEntries(proy));
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  };
  useEffect(() => { listarEntidadesFinancieras().then((e) => { setEntidades(e); setEntidadId(e[0] ? String(e[0].id) : ""); }).catch((e) => setError(e.message)); }, []);
  useEffect(() => { cargar(); }, [entidadId]);
  const actualizarProyecciones = (nuevoPrecio = precio, nuevoPeriodo = periodo) => { setPrecio(nuevoPrecio); setPeriodo(nuevoPeriodo); cargar(entidadId, { precio: nuevoPrecio, periodo: nuevoPeriodo }); };
  const guardar = async () => { try { const data = { nombre: form.nombre, bolsillo_id: Number(form.bolsillo_id), monto_objetivo_minor: Math.round(Number(form.monto) * 100), fecha_objetivo: form.fecha_objetivo || null, tipo: form.tipo, frecuencia_recurrencia: form.tipo === "recurrente" ? form.frecuencia_recurrencia : null }; if (editando) await actualizarMetaFinanciera(entidadId, editando, data); else await crearMetaFinanciera(entidadId, data); setForm(vacia); setEditando(null); await cargar(); } catch (e) { setError(e.message); } };
  const editar = (m) => { setEditando(m.id); setForm({ nombre: m.nombre, bolsillo_id: String(m.bolsillo_id), monto: String(m.monto_objetivo_minor / 100), fecha_objetivo: m.fecha_objetivo || "", tipo: m.tipo || "unica", frecuencia_recurrencia: m.frecuencia_recurrencia || "mensual" }); };
  const verAportes = async (meta) => {
    setMetaAportes(meta); setLoadingAportes(true);
    try { setAportes(await aportesMetaFinanciera(entidadId, meta.id)); }
    catch (e) { setError(e.message); notify.error(e); }
    finally { setLoadingAportes(false); }
  };
  const pausar = async (meta) => {
    setPausandoId(meta.id);
    try {
      await cambiarEstadoMetaFinanciera(entidadId, meta.id, "pausada");
      setMetas((actuales) => actuales.map((item) => item.id === meta.id ? { ...item, estado: "pausada" } : item));
      notify.success("Meta pausada");
      await cargar();
    } catch (e) { setError(e.message); notify.error(e); }
    finally { setPausandoId(null); }
  };
  return <Box>
    <PageHeader title="Metas financieras" subtitle="Planifica cada meta y mira cuánto falta vender sin modificar tus saldos ni políticas." />
    {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
    <Paper variant="outlined" sx={{ p: 2.5, mb: 2.5 }}><Grid container spacing={2}>
      <Grid item xs={12} sm={6} md={3}><TextField select fullWidth label="Entidad" value={entidadId} onChange={(e) => setEntidadId(e.target.value)}>{entidades.map((e) => <MenuItem key={e.id} value={e.id}>{e.nombre}</MenuItem>)}</TextField></Grid>
      <Grid item xs={12} sm={6} md={3}><TextField fullWidth label="Nombre" value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} /></Grid>
      <Grid item xs={6} sm={4} md={2}><TextField fullWidth type="number" label="Objetivo (S/)" value={form.monto} onChange={(e) => setForm({ ...form, monto: e.target.value })} /></Grid>
      <Grid item xs={6} sm={4} md={2}><TextField select fullWidth label="Tipo" value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })}><MenuItem value="unica">Única</MenuItem><MenuItem value="recurrente">Recurrente</MenuItem></TextField></Grid>
      {form.tipo === "recurrente" && <Grid item xs={6} sm={4} md={2}><TextField select fullWidth label="Frecuencia" value={form.frecuencia_recurrencia} onChange={(e) => setForm({ ...form, frecuencia_recurrencia: e.target.value })}><MenuItem value="semanal">Semanal</MenuItem><MenuItem value="mensual">Mensual</MenuItem><MenuItem value="trimestral">Trimestral</MenuItem><MenuItem value="anual">Anual</MenuItem></TextField></Grid>}
      <Grid item xs={6} sm={4} md={2}><TextField fullWidth type="date" label="Próxima fecha objetivo" value={form.fecha_objetivo} onChange={(e) => setForm({ ...form, fecha_objetivo: e.target.value })} InputLabelProps={{ shrink: true }} /></Grid>
      <Grid item xs={12} sm={4} md={2}><TextField select fullWidth label="Bolsillo" value={form.bolsillo_id} onChange={(e) => setForm({ ...form, bolsillo_id: e.target.value })}>{bolsillos.map((b) => <MenuItem key={b.id} value={b.id}>{b.nombre}</MenuItem>)}</TextField></Grid>
      <Grid item xs={12}><Stack direction="row" spacing={1}><Button variant="contained" onClick={guardar}>{editando ? "Guardar cambios" : "Crear meta"}</Button>{editando && <Button onClick={() => { setEditando(null); setForm(vacia); }}>Cancelar</Button>}</Stack></Grid>
    </Grid></Paper>
    {!loading && !metas.length ? <EmptyState title="No hay metas financieras" subtitle="Crea una meta y vincúlala a un bolsillo." /> : <DataTable loading={loading} searchable={false} rows={metas} columns={[
      { field: "nombre", headerName: "Meta", minWidth: 150 }, { field: "tipo", headerName: "Tipo", renderCell: (r) => r.tipo === "recurrente" ? `Recurrente · ${r.frecuencia_recurrencia}` : "Única" }, { field: "bolsillo", headerName: "Bolsillo" }, { field: "saldo_acumulado_minor", headerName: "Saldo actual", renderCell: (r) => dinero(r.saldo_acumulado_minor) }, { field: "monto_objetivo_minor", headerName: "Objetivo", renderCell: (r) => dinero(r.monto_objetivo_minor) }, { field: "estado", headerName: "Estado" },
      { field: "acciones", headerName: "", renderCell: (r) => <Stack direction="row"><Button size="small" onClick={() => verAportes(r)}>Aportes</Button>{r.estado === "activa" && <Button size="small" disabled={pausandoId === r.id} onClick={() => pausar(r)}>{pausandoId === r.id ? "Pausando…" : "Pausar"}</Button>}</Stack> },
    ]} onDrawerEdit={editar} />}
    {!!metas.filter((m) => m.estado === "activa").length && <Paper variant="outlined" sx={{ p: 2.5, mt: 2.5 }}>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={2} alignItems={{ sm: "center" }} sx={{ mb: 2 }}><Box><Typography variant="h6">Proyección de ventas</Typography><Typography variant="body2" color="text.secondary">Basada en la política activa y cobros confirmados; no modifica datos financieros.</Typography></Box><Box sx={{ flex: 1 }} /><TextField select size="small" label="Precio" value={precio} onChange={(e) => actualizarProyecciones(e.target.value, periodo)}><MenuItem value="minorista">Minorista</MenuItem><MenuItem value="mayorista">Mayorista</MenuItem></TextField><TextField select size="small" label="Historial" value={periodo} onChange={(e) => actualizarProyecciones(precio, Number(e.target.value))}>{[7, 30, 60, 90].map((d) => <MenuItem key={d} value={d}>Últimos {d} días</MenuItem>)}</TextField></Stack>
      <Stack spacing={2}>{metas.filter((m) => m.estado === "activa").map((m) => { const p = proyecciones[m.id]; if (!p) return <Typography key={m.id}>Calculando {m.nombre}…</Typography>; const z = p.meta, mix = p.mezcla; return <Paper key={m.id} variant="outlined" sx={{ p: 2 }}>
        <Stack direction={{ xs: "column", md: "row" }} justifyContent="space-between" spacing={1}><Box><Typography variant="h6">{z.nombre}</Typography><Typography variant="body2" color="text.secondary">Política: {p.politica?.nombre || "No hay política activa"}</Typography></Box>{z.dias_restantes != null && <Chip label={`${z.dias_restantes} días restantes`} color={z.dias_restantes < 7 ? "warning" : "default"} />}</Stack>
        <Grid container spacing={1.5} sx={{ my: 1 }}>{[["Objetivo", dinero(z.objetivo_minor)], ["Saldo actual", dinero(z.saldo_actual_minor)], ["Falta", dinero(z.faltante_minor)], ["Avance", `${(z.porcentaje_avance_minor / 100).toFixed(2)}%`]].map(([t, v]) => <Grid item xs={6} sm={3} key={t}><Typography variant="caption" color="text.secondary">{t}</Typography><Typography fontWeight={700}>{v}</Typography></Grid>)}</Grid>
        <Divider sx={{ my: 1.5 }} /><Typography fontWeight={700}>Escenario por producto</Typography><Grid container spacing={1} sx={{ mt: .5 }}>{p.escenario_producto.productos.map((x) => <Grid item xs={12} md={6} key={x.receta_grupo_id}><Box sx={{ p: 1, bgcolor: "action.hover", borderRadius: 1 }}><Typography fontWeight={600}>{x.nombre_producto}</Typography><Typography variant="body2">Aporta {dinero(x.aporte_minor)} por unidad · {x.unidades_necesarias == null ? "No aporta a esta meta" : `${x.unidades_necesarias} unidades · facturación aprox. ${dinero(x.facturacion_minor)}`}</Typography></Box></Grid>)}</Grid>
        <Divider sx={{ my: 1.5 }} /><Typography fontWeight={700}>Proyección por mezcla de ventas</Typography>{!mix.disponible ? <Alert severity="info" sx={{ mt: 1 }}>{mix.mensaje}</Alert> : <><Grid container spacing={1.5} sx={{ mt: .5 }}><Grid item xs={6} sm={3}><Typography variant="caption">Aporte promedio</Typography><Typography>{dinero(mix.aporte_promedio_unidad_minor)} / unid.</Typography></Grid><Grid item xs={6} sm={3}><Typography variant="caption">Aporte por S/ facturado</Typography><Typography>{dinero(mix.aporte_por_sol_minor * 100)}</Typography></Grid><Grid item xs={6} sm={3}><Typography variant="caption">Unidades faltantes</Typography><Typography>{mix.unidades_necesarias}</Typography></Grid><Grid item xs={6} sm={3}><Typography variant="caption">Facturación faltante</Typography><Typography>{dinero(mix.facturacion_necesaria_minor)}</Typography></Grid></Grid><Typography variant="body2" sx={{ mt: 1 }}>Fecha estimada: {mix.fecha_estimada_cumplimiento ? formatoFecha(mix.fecha_estimada_cumplimiento) : "Sin ritmo suficiente"}</Typography><Stack spacing={.5} sx={{ mt: 1 }}>{mix.desglose.map((x) => <Typography variant="body2" key={x.receta_grupo_id}>{x.nombre_producto}: {x.unidades_estimadas} unid. estimadas · {dinero(x.facturacion_estimada_minor)}</Typography>)}</Stack></>}
      </Paper>; })}</Stack>
    </Paper>}
    <FormDialog open={!!metaAportes} onClose={() => setMetaAportes(null)} title={metaAportes ? `Aportes: ${metaAportes.nombre}` : "Aportes auditables"} maxWidth="sm">
      {loadingAportes ? <Typography color="text.secondary">Cargando aportes…</Typography> : aportes.length ? <Stack spacing={1}>{aportes.map((aporte) => <Paper key={aporte.id} variant="outlined" sx={{ p: 1.5 }}><Typography fontWeight={650}>{dinero(aporte.importe_minor)}</Typography><Typography variant="body2" color="text.secondary">{formatoFecha(aporte.fecha)}</Typography></Paper>)}</Stack> : <Typography color="text.secondary">Esta meta todavía no tiene aportes registrados.</Typography>}
    </FormDialog>
  </Box>;
}
