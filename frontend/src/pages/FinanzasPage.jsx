import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Box, Button, Checkbox, FormControlLabel, Grid, MenuItem, Paper, Stack, Tab, Tabs, TextField, Typography } from "@mui/material";
import PageHeader from "../components/PageHeader";
import DataTable from "../components/DataTable";
import FormDialog from "../components/FormDialog";
import MpfExecutivePanel from "../components/finanzas/MpfExecutivePanel";
import MovimientosManualesTab from "../components/finanzas/MovimientosManualesTab";
import {
  cambiarEstadoCatalogoFinanciero, crearBolsillo, editarBolsillo, eliminarBolsillo, crearCuentaFinanciera, crearEntidadFinanciera,
  editarCuentaFinanciera, listarBolsillos, listarCuentasFinancieras, listarEntidadesFinancieras,
  listarEventosFinancieros, listarPlanCuentas, saldosBolsillos, saldosContables, saldosTesoreria, registrarSaldoInicial, registrarTransferenciaFinanciera,
} from "../api/endpoints";
import { useAuth } from "../context/AuthContext";
import { useNotify } from "../hooks/useNotify";
import { fechaHoyISO, formatoFecha, formatoMoneda } from "../utils/format";
import { PROVEEDORES_POR_TIPO, proveedorPredeterminado } from "../utils/cuentasFinancieras";

const tiposCuenta = [
  ["caja", "Caja"], ["banco", "Banco"], ["billetera", "Billetera digital"],
  ["procesador", "Procesador"], ["custodia_tercero", "Custodia de tercero"], ["transito", "Tránsito"],
];
const cuentaVacia = () => ({ codigo: "", nombre: "", tipo: "caja", proveedor: "efectivo", cuenta_contable_id: "", titular_legal: "", custodio_propietario_id: "", custodio_entidad_id: "", referencia_externa: "" });
const bolsilloVacio = () => ({ codigo: "", nombre: "", tipo: "operacion", descripcion: "", prioridad: 0, saldo_minimo: 0, permite_saldo_negativo: false, estado: "activa" });
const saldoInicialVacio = () => ({ cuenta_financiera_id: "", bolsillo_id: "", monto: "", fecha: fechaHoyISO(), descripcion: "Saldo inicial" });
const transferenciaVacia = () => ({ cuenta_origen_id: "", cuenta_destino_id: "", monto: "", fecha: fechaHoyISO(), motivo: "" });
const claveIdempotencia = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;

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
  const [nueva, setNueva] = useState({ codigo: "", nombre: "", tipo: "empresa", fecha_inicial: fechaHoyISO() });
  const [bolsillo, setBolsillo] = useState(bolsilloVacio);
  const [bolsilloEditando, setBolsilloEditando] = useState(null);
  const [cuenta, setCuenta] = useState(cuentaVacia);
  const [saldoInicial, setSaldoInicial] = useState(saldoInicialVacio);
  const [transferencia, setTransferencia] = useState(transferenciaVacia);
  const [datos, setDatos] = useState({ plan: [], cuentas: [], bolsillos: [], tesoreria: [], saldoBolsillos: [], contables: [], eventos: [] });

  const entidad = useMemo(() => entidades.find((item) => String(item.id) === String(entidadId)), [entidades, entidadId]);
  const puedeAdministrar = entidad?.rol_financiero === "finanzas_admin";
  const puedeMover = ["finanzas_admin", "finanzas_operador", "finanzas_personal_propietario"].includes(entidad?.rol_financiero);
  const puedeCrearEntidad = hasRole("admin") || entidades.some((item) => item.rol_financiero === "finanzas_admin");

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
    setSaving(true);
    try {
      const creada = await crearEntidadFinanciera(nueva);
      const rows = await listarEntidadesFinancieras(); setEntidades(rows); setEntidadId(String(creada.entidad?.id || creada.id || rows[0]?.id || ""));
      setModal(null); setNueva({ codigo: "", nombre: "", tipo: "empresa", fecha_inicial: fechaHoyISO() }); notify.success("Entidad financiera creada");
    } catch (requestError) { notify.error(requestError); } finally { setSaving(false); }
  };
  const abrirCuenta = (row = null) => { setEditing(row); setCuenta(row ? { ...cuentaVacia(), ...row, cuenta_contable_id: String(row.cuenta_contable_id), custodio_propietario_id: row.custodio_propietario_id || "", custodio_entidad_id: row.custodio_entidad_id || "" } : cuentaVacia()); setModal("cuenta"); };
  const cambiarTipo = (tipo) => setCuenta((actual) => ({ ...actual, tipo, proveedor: proveedorPredeterminado(tipo) }));
  const guardar = async () => {
    setSaving(true);
    try {
      if (modal === "bolsillo") { if (bolsilloEditando) await editarBolsillo(entidadId, bolsilloEditando.id, bolsillo); else await crearBolsillo(entidadId, bolsillo); }
      if (modal === "cuenta") {
        const payload = { ...cuenta, cuenta_contable_id: Number(cuenta.cuenta_contable_id), custodio_propietario_id: cuenta.custodio_propietario_id ? Number(cuenta.custodio_propietario_id) : null, custodio_entidad_id: cuenta.custodio_entidad_id ? Number(cuenta.custodio_entidad_id) : null };
        if (editing) await editarCuentaFinanciera(entidadId, editing.id, payload); else await crearCuentaFinanciera(entidadId, payload);
      }
      await cargarDatos(entidadId); setModal(null); setEditing(null); if (modal === "bolsillo") { setBolsillo(bolsilloVacio()); setBolsilloEditando(null); } notify.success("Registro guardado");
    } catch (requestError) { notify.error(requestError); } finally { setSaving(false); }
  };
  const cambiarEstado = async (tipo, row) => {
    try { await cambiarEstadoCatalogoFinanciero(entidadId, tipo, row.id, row.estado === "activa" ? "inactiva" : "activa"); await cargarDatos(entidadId); notify.success("Estado actualizado"); }
    catch (requestError) { notify.error(requestError); }
  };
  const abrirSaldoInicial = () => { setSaldoInicial(saldoInicialVacio()); setModal("saldo-inicial"); };
  const abrirTransferencia = () => { setTransferencia(transferenciaVacia()); setModal("transferencia"); };
  const abrirBolsillo = (row = null) => { setBolsilloEditando(row); setBolsillo(row ? { ...bolsilloVacio(), ...row, saldo_minimo: Number(row.saldo_minimo_minor || 0) / 100 } : bolsilloVacio()); setModal("bolsillo"); };
  const borrarBolsillo = async (row) => { if (!window.confirm(`¿Eliminar definitivamente el bolsillo “${row.nombre}”?`)) return; try { await eliminarBolsillo(entidadId, row.id); await cargarDatos(entidadId); notify.success("Bolsillo eliminado"); } catch (error) { notify.error(error); } };
  const guardarSaldoInicial = async () => {
    const monto = Number(saldoInicial.monto);
    const importeMinor = Math.round(monto * 100);
    if (!saldoInicial.cuenta_financiera_id || !saldoInicial.bolsillo_id || !Number.isFinite(monto) || monto <= 0 || !Number.isInteger(importeMinor)) {
      notify.error("Selecciona una cuenta y un bolsillo, e ingresa un monto válido mayor a S/ 0.");
      return;
    }
    setSaving(true);
    try {
      await registrarSaldoInicial(entidadId, { cuenta_financiera_id: Number(saldoInicial.cuenta_financiera_id), bolsillo_id: Number(saldoInicial.bolsillo_id), importe_minor: importeMinor, fecha: saldoInicial.fecha, descripcion: saldoInicial.descripcion.trim() || "Saldo inicial" }, claveIdempotencia());
      await cargarDatos(entidadId); setModal(null); notify.success("Saldo inicial registrado. No afecta tus ventas ni ingresos.");
    } catch (requestError) { notify.error(requestError); } finally { setSaving(false); }
  };
  const guardarTransferencia = async () => {
    const monto = Number(transferencia.monto);
    const importeMinor = Math.round(monto * 100);
    const bolsilloSinAsignar = datos.bolsillos.find((item) => item.tipo === "sin_asignar" && item.estado === "activa");
    if (!transferencia.cuenta_origen_id || !transferencia.cuenta_destino_id || transferencia.cuenta_origen_id === transferencia.cuenta_destino_id) return notify.error("Selecciona cuentas de origen y destino distintas.");
    if (!Number.isFinite(monto) || monto <= 0 || !Number.isInteger(importeMinor)) return notify.error("Ingresa un monto válido mayor a S/ 0.");
    if (!bolsilloSinAsignar) return notify.error("La entidad no tiene un bolsillo Sin asignar activo.");
    setSaving(true);
    try {
      await registrarTransferenciaFinanciera(entidadId, { cuenta_origen_id: Number(transferencia.cuenta_origen_id), cuenta_destino_id: Number(transferencia.cuenta_destino_id), bolsillo_origen_id: bolsilloSinAsignar.id, bolsillo_destino_id: bolsilloSinAsignar.id, importe_minor: importeMinor, fecha: transferencia.fecha, descripcion: transferencia.motivo.trim() || "Transferencia interna" }, claveIdempotencia());
      await cargarDatos(entidadId); setModal(null); notify.success("Movimiento entre cuentas registrado.");
    } catch (requestError) { notify.error(requestError); } finally { setSaving(false); }
  };

  if (!entidades.length) return <Box><PageHeader title="Finanzas" /><Alert severity="info" sx={{ mb: 2 }}>No tienes acceso financiero a una entidad.</Alert>{hasRole("admin") && <Paper variant="outlined" sx={{ p: 2 }}><Stack direction={{ xs: "column", md: "row" }} spacing={1}><TextField label="Código" value={nueva.codigo} onChange={(e) => setNueva((item) => ({ ...item, codigo: e.target.value }))} /><TextField label="Nombre" value={nueva.nombre} onChange={(e) => setNueva((item) => ({ ...item, nombre: e.target.value }))} /><TextField select label="Tipo" value={nueva.tipo} onChange={(e) => setNueva((item) => ({ ...item, tipo: e.target.value }))}><MenuItem value="empresa">Empresa</MenuItem><MenuItem value="persona">Persona</MenuItem><MenuItem value="patrimonio_compartido">Patrimonio compartido</MenuItem></TextField><Button variant="contained" onClick={crearEntidad}>Crear primera entidad</Button></Stack></Paper>}</Box>;

  return <Box>
    <PageHeader title="Finanzas" subtitle="Tesorería, catálogos, eventos y decisiones MPF." />
    <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ sm: "center" }} sx={{ mb: 3 }}><TextField select label="Entidad" value={entidadId} onChange={(e) => setEntidadId(e.target.value)} sx={{ minWidth: 280 }}>{entidades.map((item) => <MenuItem key={item.id} value={item.id}>{item.nombre}</MenuItem>)}</TextField>{puedeCrearEntidad && <Button variant="contained" onClick={() => setModal("entidad")}>Nueva entidad</Button>}</Stack>
    {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
    <Tabs value={tab} onChange={(_, value) => setTab(value)} variant="scrollable" sx={{ mb: 2 }}><Tab label="Tesorería" /><Tab label="Catálogos" /><Tab label="Eventos" /><Tab label="Movimientos manuales" /></Tabs>
    {tab === 0 && <><MpfExecutivePanel /><Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" alignItems={{ sm: "center" }} sx={{ mb: 1 }}><Typography variant="h6">Saldos por cuenta</Typography><Stack direction="row" spacing={1}>{puedeMover && <Button variant="outlined" onClick={abrirTransferencia}>Movimiento entre cuentas</Button>}{puedeAdministrar && <Button variant="contained" onClick={abrirSaldoInicial}>Registrar saldo inicial</Button>}</Stack></Stack><Alert severity="info" sx={{ mb: 2 }}>Úsalo solo para el dinero que ya existía antes de empezar a registrar operaciones en el ERP. No se contabiliza como venta, ingreso manual ni aporte de socio.</Alert><DataTable loading={loading} rows={datos.tesoreria} columns={[{ field: "codigo", headerName: "Código" }, { field: "nombre", headerName: "Cuenta" }, { field: "tipo", headerName: "Tipo" }, { field: "proveedor", headerName: "Proveedor" }, { field: "saldo_minor", headerName: "Saldo", align: "right", renderCell: (row) => formatoMoneda(row.saldo_minor / 100) }]} /></>}
    {tab === 1 && <Stack spacing={3}>
      <Box><Stack direction="row" justifyContent="space-between" sx={{ mb: 1 }}><Typography variant="h6">Cuentas financieras</Typography>{puedeAdministrar && <Button variant="contained" onClick={() => abrirCuenta()}>Nueva cuenta</Button>}</Stack><DataTable loading={loading} rows={datos.cuentas} onRowClick={puedeAdministrar ? abrirCuenta : null} columns={[{ field: "codigo", headerName: "Código" }, { field: "nombre", headerName: "Nombre" }, { field: "tipo", headerName: "Tipo" }, { field: "proveedor", headerName: "Proveedor" }, { field: "estado", headerName: "Estado" }, ...(puedeAdministrar ? [{ field: "accion", headerName: "", sortable: false, renderCell: (row) => <Button size="small" onClick={(event) => { event.stopPropagation(); cambiarEstado("cuentas-financieras", row); }}>{row.estado === "activa" ? "Inactivar" : "Activar"}</Button> }] : [])]} /></Box>
      <Box><Stack direction="row" justifyContent="space-between" sx={{ mb: 1 }}><Typography variant="h6">Bolsillos</Typography>{puedeAdministrar && <Button variant="outlined" onClick={() => abrirBolsillo()}>Nuevo bolsillo</Button>}</Stack><DataTable loading={loading} rows={datos.bolsillos} columns={[{ field: "codigo", headerName: "Código" }, { field: "nombre", headerName: "Nombre" }, { field: "tipo", headerName: "Tipo" }, { field: "prioridad", headerName: "Prioridad" }, { field: "saldo_minimo_minor", headerName: "Saldo mínimo", renderCell: (row) => formatoMoneda(Number(row.saldo_minimo_minor || 0) / 100) }, { field: "estado", headerName: "Estado" }, ...(puedeAdministrar ? [{ field: "accion", headerName: "", sortable: false, minWidth: 220, renderCell: (row) => <Stack direction="row" spacing={0.5}><Button size="small" onClick={() => abrirBolsillo(row)}>Editar</Button><Button size="small" onClick={() => cambiarEstado("bolsillos", row)}>{row.estado === "activa" ? "Desactivar" : "Activar"}</Button>{row.tipo !== "sin_asignar" && <Button size="small" color="error" onClick={() => borrarBolsillo(row)}>Eliminar</Button>}</Stack> }] : [])]} /></Box>
      <Box><Typography variant="h6" sx={{ mb: 1 }}>Plan de cuentas</Typography><DataTable loading={loading} rows={datos.plan} columns={[{ field: "codigo", headerName: "Código" }, { field: "nombre", headerName: "Nombre" }, { field: "naturaleza", headerName: "Naturaleza" }, { field: "subtipo", headerName: "Subtipo" }, { field: "estado", headerName: "Estado" }]} /></Box>
    </Stack>}
    {tab === 2 && <DataTable loading={loading} rows={datos.eventos} defaultOrderBy="id" defaultOrder="desc" columns={[{ field: "id", headerName: "Evento" }, { field: "fecha", headerName: "Fecha", renderCell: (row) => formatoFecha(row.fecha) }, { field: "tipo", headerName: "Tipo" }, { field: "descripcion", headerName: "Descripción", minWidth: 260 }, { field: "estado", headerName: "Estado" }, { field: "reversion_de_id", headerName: "Revierte", renderCell: (row) => row.reversion_de_id || "—" }]} />}
    {tab === 3 && <MovimientosManualesTab />}
    <FormDialog open={modal === "entidad"} title="Nueva entidad financiera" onClose={() => setModal(null)} disableClose={saving}><Stack spacing={2}><TextField required label="Código" value={nueva.codigo} onChange={(e) => setNueva((item) => ({ ...item, codigo: e.target.value }))} helperText="2 a 40 caracteres: letras, números, guion o guion bajo." /><TextField required label="Nombre" value={nueva.nombre} onChange={(e) => setNueva((item) => ({ ...item, nombre: e.target.value }))} /><TextField required select label="Tipo" value={nueva.tipo} onChange={(e) => setNueva((item) => ({ ...item, tipo: e.target.value }))}><MenuItem value="empresa">Empresa</MenuItem><MenuItem value="persona">Persona</MenuItem><MenuItem value="patrimonio_compartido">Patrimonio compartido</MenuItem></TextField><TextField required type="date" label="Fecha inicial" InputLabelProps={{ shrink: true }} value={nueva.fecha_inicial} onChange={(e) => setNueva((item) => ({ ...item, fecha_inicial: e.target.value }))} /><Stack direction="row" justifyContent="flex-end" spacing={1}><Button onClick={() => setModal(null)} disabled={saving}>Cancelar</Button><Button variant="contained" onClick={crearEntidad} disabled={saving || !nueva.codigo.trim() || !nueva.nombre.trim()}>{saving ? "Creando…" : "Crear entidad"}</Button></Stack></Stack></FormDialog>
    <FormDialog open={modal === "bolsillo"} title={bolsilloEditando ? "Editar bolsillo" : "Nuevo bolsillo"} onClose={() => setModal(null)} disableClose={saving}><Stack spacing={2}>{!bolsilloEditando && <><TextField label="Código" value={bolsillo.codigo} onChange={(e) => setBolsillo({ ...bolsillo, codigo: e.target.value })} /><TextField select label="Tipo" value={bolsillo.tipo} onChange={(e) => setBolsillo({ ...bolsillo, tipo: e.target.value })}><MenuItem value="operacion">Operación</MenuItem><MenuItem value="reserva">Reserva</MenuItem><MenuItem value="impuestos">Impuestos</MenuItem><MenuItem value="otro">Otro</MenuItem></TextField></>}<TextField label="Nombre" value={bolsillo.nombre} onChange={(e) => setBolsillo({ ...bolsillo, nombre: e.target.value })} /><TextField label="Descripción" multiline minRows={2} value={bolsillo.descripcion} onChange={(e) => setBolsillo({ ...bolsillo, descripcion: e.target.value })} /><TextField label="Prioridad" type="number" inputProps={{ min: 0, step: 1 }} value={bolsillo.prioridad} onChange={(e) => setBolsillo({ ...bolsillo, prioridad: e.target.value })} /><TextField label="Saldo mínimo (S/)" type="number" inputProps={{ min: 0, step: "0.01" }} value={bolsillo.saldo_minimo} onChange={(e) => setBolsillo({ ...bolsillo, saldo_minimo: e.target.value })} /><FormControlLabel control={<Checkbox checked={!!bolsillo.permite_saldo_negativo} onChange={(e) => setBolsillo({ ...bolsillo, permite_saldo_negativo: e.target.checked })} />} label="Permitir saldo negativo" />{bolsilloEditando && bolsillo.tipo !== "sin_asignar" && <TextField select label="Estado" value={bolsillo.estado} onChange={(e) => setBolsillo({ ...bolsillo, estado: e.target.value })}><MenuItem value="activa">Activo</MenuItem><MenuItem value="inactiva">Inactivo</MenuItem></TextField>}<Button variant="contained" disabled={saving} onClick={guardar}>Guardar</Button></Stack></FormDialog>
    <FormDialog open={modal === "cuenta"} title={editing ? "Editar cuenta financiera" : "Nueva cuenta financiera"} onClose={() => setModal(null)} disableClose={saving} maxWidth="md"><Grid container spacing={2}><Grid item xs={12} sm={4}><TextField fullWidth label="Código" value={cuenta.codigo} onChange={(e) => setCuenta({ ...cuenta, codigo: e.target.value })} /></Grid><Grid item xs={12} sm={8}><TextField fullWidth label="Nombre" value={cuenta.nombre} onChange={(e) => setCuenta({ ...cuenta, nombre: e.target.value })} /></Grid><Grid item xs={12} sm={6}><TextField fullWidth select label="Tipo" value={cuenta.tipo} onChange={(e) => cambiarTipo(e.target.value)}>{tiposCuenta.map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}</TextField></Grid><Grid item xs={12} sm={6}><TextField fullWidth select label="Proveedor o subtipo" value={cuenta.proveedor} onChange={(e) => setCuenta({ ...cuenta, proveedor: e.target.value })}>{(PROVEEDORES_POR_TIPO[cuenta.tipo] || []).map((option) => <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>)}</TextField></Grid><Grid item xs={12}><TextField fullWidth select label="Cuenta contable" value={cuenta.cuenta_contable_id} onChange={(e) => setCuenta({ ...cuenta, cuenta_contable_id: e.target.value })}>{datos.plan.filter((item) => item.estado === "activa" && item.permite_movimiento).map((item) => <MenuItem key={item.id} value={item.id}>{item.codigo} — {item.nombre}</MenuItem>)}</TextField></Grid><Grid item xs={12} sm={6}><TextField fullWidth label="Titular legal" value={cuenta.titular_legal} onChange={(e) => setCuenta({ ...cuenta, titular_legal: e.target.value })} /></Grid><Grid item xs={12} sm={6}><TextField fullWidth label="Referencia externa" value={cuenta.referencia_externa} onChange={(e) => setCuenta({ ...cuenta, referencia_externa: e.target.value })} /></Grid><Grid item xs={12} sm={6}><TextField fullWidth type="number" label="ID custodio propietario (opcional)" value={cuenta.custodio_propietario_id} onChange={(e) => setCuenta({ ...cuenta, custodio_propietario_id: e.target.value, custodio_entidad_id: "" })} /></Grid><Grid item xs={12} sm={6}><TextField fullWidth select label="Entidad custodia (opcional)" value={cuenta.custodio_entidad_id} onChange={(e) => setCuenta({ ...cuenta, custodio_entidad_id: e.target.value, custodio_propietario_id: "" })}><MenuItem value="">Ninguna</MenuItem>{entidades.filter((item) => String(item.id) !== String(entidadId)).map((item) => <MenuItem key={item.id} value={item.id}>{item.nombre}</MenuItem>)}</TextField></Grid><Grid item xs={12}><Stack direction="row" justifyContent="flex-end" spacing={1}><Button onClick={() => setModal(null)}>Cancelar</Button><Button variant="contained" disabled={saving || !cuenta.codigo || !cuenta.nombre || !cuenta.cuenta_contable_id || !cuenta.proveedor} onClick={guardar}>{saving ? "Guardando…" : "Guardar"}</Button></Stack></Grid></Grid></FormDialog>
    <FormDialog open={modal === "saldo-inicial"} title="Registrar saldo inicial" onClose={() => setModal(null)} disableClose={saving}><Stack spacing={2}><Alert severity="warning">Registra cada cuenta una sola vez con el dinero que ya tenías al comenzar a usar el ERP. Si te equivocas, revierte el evento antes de ingresarlo de nuevo.</Alert><TextField select fullWidth required label="Cuenta financiera" value={saldoInicial.cuenta_financiera_id} onChange={(e) => setSaldoInicial({ ...saldoInicial, cuenta_financiera_id: e.target.value })}>{datos.cuentas.filter((item) => item.estado === "activa").map((item) => <MenuItem key={item.id} value={item.id}>{item.nombre} ({item.tipo})</MenuItem>)}</TextField><TextField select fullWidth required label="Bolsillo o destino del dinero" value={saldoInicial.bolsillo_id} onChange={(e) => setSaldoInicial({ ...saldoInicial, bolsillo_id: e.target.value })}>{datos.bolsillos.filter((item) => item.estado === "activa").map((item) => <MenuItem key={item.id} value={item.id}>{item.nombre}</MenuItem>)}</TextField><TextField fullWidth required type="number" inputProps={{ min: 0.01, step: "0.01" }} label="Monto (S/)" value={saldoInicial.monto} onChange={(e) => setSaldoInicial({ ...saldoInicial, monto: e.target.value })} /><TextField fullWidth required type="date" label="Fecha de apertura" InputLabelProps={{ shrink: true }} value={saldoInicial.fecha} onChange={(e) => setSaldoInicial({ ...saldoInicial, fecha: e.target.value })} /><TextField fullWidth label="Descripción" value={saldoInicial.descripcion} onChange={(e) => setSaldoInicial({ ...saldoInicial, descripcion: e.target.value })} /><Stack direction="row" justifyContent="flex-end" spacing={1}><Button onClick={() => setModal(null)}>Cancelar</Button><Button variant="contained" disabled={saving} onClick={guardarSaldoInicial}>{saving ? "Registrando…" : "Registrar saldo inicial"}</Button></Stack></Stack></FormDialog>
    <FormDialog open={modal === "transferencia"} title="Movimiento entre cuentas" onClose={() => setModal(null)} disableClose={saving}><Stack spacing={2}><Alert severity="info">Mueve dinero entre cuentas de la misma entidad. No genera ingresos, gastos ni utilidad.</Alert><TextField select fullWidth required label="Cuenta origen" value={transferencia.cuenta_origen_id} onChange={(e) => setTransferencia({ ...transferencia, cuenta_origen_id: e.target.value })}>{datos.tesoreria.filter((item) => Number(item.saldo_minor) > 0).map((item) => <MenuItem key={item.id} value={item.id}>{item.nombre} — {formatoMoneda(item.saldo_minor / 100)}</MenuItem>)}</TextField><TextField select fullWidth required label="Cuenta destino" value={transferencia.cuenta_destino_id} onChange={(e) => setTransferencia({ ...transferencia, cuenta_destino_id: e.target.value })}>{datos.cuentas.filter((item) => item.estado === "activa" && String(item.id) !== String(transferencia.cuenta_origen_id)).map((item) => <MenuItem key={item.id} value={item.id}>{item.nombre} ({item.tipo})</MenuItem>)}</TextField><TextField fullWidth required type="number" inputProps={{ min: 0.01, step: "0.01" }} label="Monto (S/)" value={transferencia.monto} onChange={(e) => setTransferencia({ ...transferencia, monto: e.target.value })} /><TextField fullWidth required type="date" label="Fecha" InputLabelProps={{ shrink: true }} value={transferencia.fecha} onChange={(e) => setTransferencia({ ...transferencia, fecha: e.target.value })} /><TextField fullWidth label="Motivo (opcional)" value={transferencia.motivo} onChange={(e) => setTransferencia({ ...transferencia, motivo: e.target.value })} /><Stack direction="row" justifyContent="flex-end" spacing={1}><Button onClick={() => setModal(null)}>Cancelar</Button><Button variant="contained" disabled={saving} onClick={guardarTransferencia}>{saving ? "Registrando…" : "Registrar movimiento"}</Button></Stack></Stack></FormDialog>
  </Box>;
}
