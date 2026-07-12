import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Box, Button, Checkbox, FormControlLabel, Grid, MenuItem, Paper, Stack, Tab, Tabs, TextField, Typography } from "@mui/material";
import PageHeader from "../components/PageHeader";
import DataTable from "../components/DataTable";
import FormDialog from "../components/FormDialog";
import MpfExecutivePanel from "../components/finanzas/MpfExecutivePanel";
import MovimientosManualesTab from "../components/finanzas/MovimientosManualesTab";
import {
  cambiarEstadoCatalogoFinanciero, crearBolsillo, crearCuentaFinanciera, crearEntidadFinanciera,
  editarCuentaFinanciera, listarBolsillos, listarCuentasFinancieras, listarEntidadesFinancieras,
  listarEventosFinancieros, listarPlanCuentas, saldosBolsillos, saldosContables, saldosTesoreria,
} from "../api/endpoints";
import { useAuth } from "../context/AuthContext";
import { useNotify } from "../hooks/useNotify";
import { formatoFecha, formatoMoneda } from "../utils/format";
import { PROVEEDORES_POR_TIPO, proveedorPredeterminado } from "../utils/cuentasFinancieras";

const tiposCuenta = [
  ["caja", "Caja"], ["banco", "Banco"], ["billetera", "Billetera digital"],
  ["procesador", "Procesador"], ["custodia_tercero", "Custodia de tercero"], ["transito", "Tránsito"],
];
const cuentaVacia = () => ({ codigo: "", nombre: "", tipo: "caja", proveedor: "efectivo", cuenta_contable_id: "", titular_legal: "", custodio_propietario_id: "", custodio_entidad_id: "", referencia_externa: "" });

export default function FinanzasPage() {
  const notify = useNotify();
  const { hasRole } = useAuth();
  const [entidades, setEntidades] = useState([]);
  const [entidadId, setEntidadId] = useState("");
  const [tab, setTab] = useState(0);
  const [modal, setModal] = useState(null);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [nueva, setNueva] = useState({ codigo: "", nombre: "", tipo: "empresa", fecha_inicial: new Date().toISOString().slice(0, 10) });
  const [bolsillo, setBolsillo] = useState({ codigo: "", nombre: "", tipo: "operacion", permite_saldo_negativo: false });
  const [cuenta, setCuenta] = useState(cuentaVacia);
  const [datos, setDatos] = useState({ plan: [], cuentas: [], bolsillos: [], tesoreria: [], saldoBolsillos: [], contables: [], eventos: [] });

  const entidad = useMemo(() => entidades.find((item) => String(item.id) === String(entidadId)), [entidades, entidadId]);
  const puedeAdministrar = entidad?.rol_financiero === "finanzas_admin";

  const cargarDatos = useCallback(async (id) => {
    if (!id) return;
    setLoading(true); setError("");
    try {
      const [plan, cuentas, bolsillos, tesoreria, saldoBolsillos, contables, eventos] = await Promise.all([
        listarPlanCuentas(id), listarCuentasFinancieras(id), listarBolsillos(id), saldosTesoreria(id),
        saldosBolsillos(id), saldosContables(id), listarEventosFinancieros(id),
      ]);
      setDatos({ plan, cuentas, bolsillos, tesoreria, saldoBolsillos, contables, eventos });
    } catch (requestError) {
      setError(requestError.message || "No se pudieron cargar los datos financieros.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    listarEntidadesFinancieras().then((rows) => { setEntidades(rows); setEntidadId((actual) => actual || String(rows[0]?.id || "")); }).catch(notify.error);
  }, [notify]);
  useEffect(() => { cargarDatos(entidadId); }, [entidadId, cargarDatos]);

  const crearEntidad = async () => {
    try {
      const creada = await crearEntidadFinanciera(nueva);
      const rows = await listarEntidadesFinancieras(); setEntidades(rows); setEntidadId(String(creada.id || rows[0]?.id || ""));
      notify.success("Entidad financiera creada");
    } catch (requestError) { notify.error(requestError); }
  };
  const abrirCuenta = (row = null) => { setEditing(row); setCuenta(row ? { ...cuentaVacia(), ...row, cuenta_contable_id: String(row.cuenta_contable_id), custodio_propietario_id: row.custodio_propietario_id || "", custodio_entidad_id: row.custodio_entidad_id || "" } : cuentaVacia()); setModal("cuenta"); };
  const cambiarTipo = (tipo) => setCuenta((actual) => ({ ...actual, tipo, proveedor: proveedorPredeterminado(tipo) }));
  const guardar = async () => {
    setSaving(true);
    try {
      if (modal === "bolsillo") await crearBolsillo(entidadId, bolsillo);
      if (modal === "cuenta") {
        const payload = { ...cuenta, cuenta_contable_id: Number(cuenta.cuenta_contable_id), custodio_propietario_id: cuenta.custodio_propietario_id ? Number(cuenta.custodio_propietario_id) : null, custodio_entidad_id: cuenta.custodio_entidad_id ? Number(cuenta.custodio_entidad_id) : null };
        if (editing) await editarCuentaFinanciera(entidadId, editing.id, payload); else await crearCuentaFinanciera(entidadId, payload);
      }
      await cargarDatos(entidadId); setModal(null); setEditing(null); notify.success("Registro guardado");
    } catch (requestError) { notify.error(requestError); } finally { setSaving(false); }
  };
  const cambiarEstado = async (tipo, row) => {
    try { await cambiarEstadoCatalogoFinanciero(entidadId, tipo, row.id, row.estado === "activa" ? "inactiva" : "activa"); await cargarDatos(entidadId); notify.success("Estado actualizado"); }
    catch (requestError) { notify.error(requestError); }
  };

  if (!entidades.length) return <Box><PageHeader title="Finanzas" /><Alert severity="info" sx={{ mb: 2 }}>No tienes acceso financiero a una entidad.</Alert>{hasRole("admin") && <Paper variant="outlined" sx={{ p: 2 }}><Stack direction={{ xs: "column", md: "row" }} spacing={1}><TextField label="Código" value={nueva.codigo} onChange={(e) => setNueva((item) => ({ ...item, codigo: e.target.value }))} /><TextField label="Nombre" value={nueva.nombre} onChange={(e) => setNueva((item) => ({ ...item, nombre: e.target.value }))} /><TextField select label="Tipo" value={nueva.tipo} onChange={(e) => setNueva((item) => ({ ...item, tipo: e.target.value }))}><MenuItem value="empresa">Empresa</MenuItem><MenuItem value="persona">Persona</MenuItem><MenuItem value="patrimonio_compartido">Patrimonio compartido</MenuItem></TextField><Button variant="contained" onClick={crearEntidad}>Crear primera entidad</Button></Stack></Paper>}</Box>;

  return <Box>
    <PageHeader title="Finanzas" subtitle="Tesorería, catálogos, eventos y decisiones MPF." />
    <TextField select label="Entidad" value={entidadId} onChange={(e) => setEntidadId(e.target.value)} sx={{ minWidth: 280, mb: 3 }}>{entidades.map((item) => <MenuItem key={item.id} value={item.id}>{item.nombre}</MenuItem>)}</TextField>
    {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
    <Tabs value={tab} onChange={(_, value) => setTab(value)} variant="scrollable" sx={{ mb: 2 }}><Tab label="Tesorería" /><Tab label="Catálogos" /><Tab label="Eventos" /><Tab label="Movimientos manuales" /></Tabs>
    {tab === 0 && <><MpfExecutivePanel /><Typography variant="h6" sx={{ mb: 1 }}>Saldos por cuenta</Typography><DataTable loading={loading} rows={datos.tesoreria} columns={[{ field: "codigo", headerName: "Código" }, { field: "nombre", headerName: "Cuenta" }, { field: "tipo", headerName: "Tipo" }, { field: "proveedor", headerName: "Proveedor" }, { field: "saldo_minor", headerName: "Saldo", align: "right", renderCell: (row) => formatoMoneda(row.saldo_minor / 100) }]} /></>}
    {tab === 1 && <Stack spacing={3}>
      <Box><Stack direction="row" justifyContent="space-between" sx={{ mb: 1 }}><Typography variant="h6">Cuentas financieras</Typography>{puedeAdministrar && <Button variant="contained" onClick={() => abrirCuenta()}>Nueva cuenta</Button>}</Stack><DataTable loading={loading} rows={datos.cuentas} onRowClick={puedeAdministrar ? abrirCuenta : null} columns={[{ field: "codigo", headerName: "Código" }, { field: "nombre", headerName: "Nombre" }, { field: "tipo", headerName: "Tipo" }, { field: "proveedor", headerName: "Proveedor" }, { field: "estado", headerName: "Estado" }, ...(puedeAdministrar ? [{ field: "accion", headerName: "", sortable: false, renderCell: (row) => <Button size="small" onClick={(event) => { event.stopPropagation(); cambiarEstado("cuentas-financieras", row); }}>{row.estado === "activa" ? "Inactivar" : "Activar"}</Button> }] : [])]} /></Box>
      <Box><Stack direction="row" justifyContent="space-between" sx={{ mb: 1 }}><Typography variant="h6">Bolsillos</Typography>{puedeAdministrar && <Button variant="outlined" onClick={() => setModal("bolsillo")}>Nuevo bolsillo</Button>}</Stack><DataTable loading={loading} rows={datos.bolsillos} columns={[{ field: "codigo", headerName: "Código" }, { field: "nombre", headerName: "Nombre" }, { field: "tipo", headerName: "Tipo" }, { field: "estado", headerName: "Estado" }]} /></Box>
      <Box><Typography variant="h6" sx={{ mb: 1 }}>Plan de cuentas</Typography><DataTable loading={loading} rows={datos.plan} columns={[{ field: "codigo", headerName: "Código" }, { field: "nombre", headerName: "Nombre" }, { field: "naturaleza", headerName: "Naturaleza" }, { field: "subtipo", headerName: "Subtipo" }, { field: "estado", headerName: "Estado" }]} /></Box>
    </Stack>}
    {tab === 2 && <DataTable loading={loading} rows={datos.eventos} defaultOrderBy="id" defaultOrder="desc" columns={[{ field: "id", headerName: "Evento" }, { field: "fecha", headerName: "Fecha", renderCell: (row) => formatoFecha(row.fecha) }, { field: "tipo", headerName: "Tipo" }, { field: "descripcion", headerName: "Descripción", minWidth: 260 }, { field: "estado", headerName: "Estado" }, { field: "reversion_de_id", headerName: "Revierte", renderCell: (row) => row.reversion_de_id || "—" }]} />}
    {tab === 3 && <MovimientosManualesTab />}
    <FormDialog open={modal === "bolsillo"} title="Nuevo bolsillo" onClose={() => setModal(null)} disableClose={saving}><Stack spacing={2}><TextField label="Código" value={bolsillo.codigo} onChange={(e) => setBolsillo({ ...bolsillo, codigo: e.target.value })} /><TextField label="Nombre" value={bolsillo.nombre} onChange={(e) => setBolsillo({ ...bolsillo, nombre: e.target.value })} /><TextField select label="Tipo" value={bolsillo.tipo} onChange={(e) => setBolsillo({ ...bolsillo, tipo: e.target.value })}><MenuItem value="operacion">Operación</MenuItem><MenuItem value="reserva">Reserva</MenuItem><MenuItem value="impuestos">Impuestos</MenuItem><MenuItem value="otro">Otro</MenuItem></TextField><FormControlLabel control={<Checkbox checked={bolsillo.permite_saldo_negativo} onChange={(e) => setBolsillo({ ...bolsillo, permite_saldo_negativo: e.target.checked })} />} label="Permitir saldo negativo" /><Button variant="contained" disabled={saving} onClick={guardar}>Guardar</Button></Stack></FormDialog>
    <FormDialog open={modal === "cuenta"} title={editing ? "Editar cuenta financiera" : "Nueva cuenta financiera"} onClose={() => setModal(null)} disableClose={saving} maxWidth="md"><Grid container spacing={2}><Grid item xs={12} sm={4}><TextField fullWidth label="Código" value={cuenta.codigo} onChange={(e) => setCuenta({ ...cuenta, codigo: e.target.value })} /></Grid><Grid item xs={12} sm={8}><TextField fullWidth label="Nombre" value={cuenta.nombre} onChange={(e) => setCuenta({ ...cuenta, nombre: e.target.value })} /></Grid><Grid item xs={12} sm={6}><TextField fullWidth select label="Tipo" value={cuenta.tipo} onChange={(e) => cambiarTipo(e.target.value)}>{tiposCuenta.map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}</TextField></Grid><Grid item xs={12} sm={6}><TextField fullWidth select label="Proveedor o subtipo" value={cuenta.proveedor} onChange={(e) => setCuenta({ ...cuenta, proveedor: e.target.value })}>{(PROVEEDORES_POR_TIPO[cuenta.tipo] || []).map((option) => <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>)}</TextField></Grid><Grid item xs={12}><TextField fullWidth select label="Cuenta contable" value={cuenta.cuenta_contable_id} onChange={(e) => setCuenta({ ...cuenta, cuenta_contable_id: e.target.value })}>{datos.plan.filter((item) => item.estado === "activa" && item.permite_movimiento).map((item) => <MenuItem key={item.id} value={item.id}>{item.codigo} — {item.nombre}</MenuItem>)}</TextField></Grid><Grid item xs={12} sm={6}><TextField fullWidth label="Titular legal" value={cuenta.titular_legal} onChange={(e) => setCuenta({ ...cuenta, titular_legal: e.target.value })} /></Grid><Grid item xs={12} sm={6}><TextField fullWidth label="Referencia externa" value={cuenta.referencia_externa} onChange={(e) => setCuenta({ ...cuenta, referencia_externa: e.target.value })} /></Grid><Grid item xs={12} sm={6}><TextField fullWidth type="number" label="ID custodio propietario (opcional)" value={cuenta.custodio_propietario_id} onChange={(e) => setCuenta({ ...cuenta, custodio_propietario_id: e.target.value, custodio_entidad_id: "" })} /></Grid><Grid item xs={12} sm={6}><TextField fullWidth select label="Entidad custodia (opcional)" value={cuenta.custodio_entidad_id} onChange={(e) => setCuenta({ ...cuenta, custodio_entidad_id: e.target.value, custodio_propietario_id: "" })}><MenuItem value="">Ninguna</MenuItem>{entidades.filter((item) => String(item.id) !== String(entidadId)).map((item) => <MenuItem key={item.id} value={item.id}>{item.nombre}</MenuItem>)}</TextField></Grid><Grid item xs={12}><Stack direction="row" justifyContent="flex-end" spacing={1}><Button onClick={() => setModal(null)}>Cancelar</Button><Button variant="contained" disabled={saving || !cuenta.codigo || !cuenta.nombre || !cuenta.cuenta_contable_id || !cuenta.proveedor} onClick={guardar}>{saving ? "Guardando…" : "Guardar"}</Button></Stack></Grid></Grid></FormDialog>
  </Box>;
}
