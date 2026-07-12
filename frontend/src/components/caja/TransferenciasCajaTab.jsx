import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Box, Button, Grid, MenuItem, Stack, TextField, Typography } from "@mui/material";
import DataTable from "../DataTable";
import FormDialog from "../FormDialog";
import { useNotify } from "../../hooks/useNotify";
import { listarBolsillos, listarCajas, listarEntidadesFinancieras, transferirEntreCajas } from "../../api/endpoints";

const hoy = () => new Date().toISOString().slice(0, 10);
const clave = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
const inicial = () => ({ entidad_id: "", caja_origen_id: "", caja_destino_id: "", bolsillo_origen_id: "", bolsillo_destino_id: "", monto: "", fecha: hoy(), concepto: "" });

export default function TransferenciasCajaTab() {
  const notify = useNotify(); const [cajas, setCajas] = useState([]); const [entidades, setEntidades] = useState([]); const [bolsillos, setBolsillos] = useState([]);
  const [open, setOpen] = useState(false); const [saving, setSaving] = useState(false); const [form, setForm] = useState(inicial);
  const cargar = useCallback(async () => { try { const [c, e] = await Promise.all([listarCajas(), listarEntidadesFinancieras()]); setCajas(c); setEntidades(e); } catch (error) { notify.error(error); } }, [notify]);
  useEffect(() => { cargar(); }, [cargar]);
  const cajasEntidad = useMemo(() => cajas.filter((c) => String(c.entidad_id) === String(form.entidad_id) && c.cuenta_financiera_id), [cajas, form.entidad_id]);
  const set = (campo, valor) => setForm((actual) => ({ ...actual, [campo]: valor }));
  const seleccionarEntidad = async (entidadId) => { setForm((actual) => ({ ...actual, entidad_id: entidadId, caja_origen_id: "", caja_destino_id: "", bolsillo_origen_id: "", bolsillo_destino_id: "" })); try { setBolsillos((await listarBolsillos(entidadId)).filter((b) => b.estado === "activa")); } catch (error) { setBolsillos([]); notify.error(error); } };
  const guardar = async () => {
    if (!form.entidad_id || !form.caja_origen_id || !form.caja_destino_id || !form.monto || !form.fecha) return notify.error("Completa entidad, cajas, monto y fecha.");
    if (form.caja_origen_id === form.caja_destino_id) return notify.error("La caja de origen y destino deben ser diferentes.");
    setSaving(true); try {
      await transferirEntreCajas({ ...form, monto: Number(form.monto), bolsillo_origen_id: form.bolsillo_origen_id || undefined, bolsillo_destino_id: form.bolsillo_destino_id || undefined }, clave());
      notify.success("Transferencia registrada correctamente."); setOpen(false); setForm(inicial()); await cargar();
    } catch (error) { notify.error(error); } finally { setSaving(false); }
  };
  if (!entidades.length) return <Alert severity="info">No tienes acceso financiero a una entidad. Solicita al administrador financiero que te otorgue acceso antes de transferir fondos.</Alert>;
  return <Box><Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" alignItems={{ sm: "center" }} sx={{ mb: 2 }}><Typography color="text.secondary">Solo se pueden transferir fondos entre cajas configuradas de la misma entidad.</Typography><Button variant="contained" onClick={() => setOpen(true)}>Nueva transferencia</Button></Stack><DataTable rows={cajas.filter((c) => entidades.some((e) => e.id === c.entidad_id))} columns={[{ field: "nombre", headerName: "Caja" }, { field: "entidad_id", headerName: "Entidad" }, { field: "cuenta_financiera_id", headerName: "Cuenta financiera", renderCell: (r) => r.cuenta_financiera_id || "Sin configurar" }, { field: "turnoAbiertoId", headerName: "Turno abierto", renderCell: (r) => r.turnoAbiertoId ? `#${r.turnoAbiertoId}` : "No" }]} />
    <FormDialog open={open} onClose={() => setOpen(false)} title="Transferir entre cajas"><Grid container spacing={2}><Grid item xs={12}><TextField select fullWidth required label="Entidad financiera" value={form.entidad_id} onChange={(e) => seleccionarEntidad(e.target.value)}>{entidades.map((e) => <MenuItem key={e.id} value={e.id}>{e.nombre}</MenuItem>)}</TextField></Grid><Grid item xs={12} sm={6}><TextField select fullWidth required label="Caja origen" value={form.caja_origen_id} onChange={(e) => set("caja_origen_id", e.target.value)}>{cajasEntidad.map((c) => <MenuItem key={c.id} value={c.id}>{c.nombre}</MenuItem>)}</TextField></Grid><Grid item xs={12} sm={6}><TextField select fullWidth required label="Caja destino" value={form.caja_destino_id} onChange={(e) => set("caja_destino_id", e.target.value)}>{cajasEntidad.filter((c) => String(c.id) !== String(form.caja_origen_id)).map((c) => <MenuItem key={c.id} value={c.id}>{c.nombre}</MenuItem>)}</TextField></Grid><Grid item xs={12} sm={6}><TextField fullWidth required type="number" inputProps={{ min: 0.01, step: "any" }} label="Monto (S/)" value={form.monto} onChange={(e) => set("monto", e.target.value)} /></Grid><Grid item xs={12} sm={6}><TextField fullWidth required type="date" label="Fecha" InputLabelProps={{ shrink: true }} value={form.fecha} onChange={(e) => set("fecha", e.target.value)} /></Grid><Grid item xs={12} sm={6}><TextField select fullWidth label="Bolsillo origen" value={form.bolsillo_origen_id} onChange={(e) => set("bolsillo_origen_id", e.target.value)}><MenuItem value="">Sin asignar</MenuItem>{bolsillos.map((b) => <MenuItem key={b.id} value={b.id}>{b.nombre}</MenuItem>)}</TextField></Grid><Grid item xs={12} sm={6}><TextField select fullWidth label="Bolsillo destino" value={form.bolsillo_destino_id} onChange={(e) => set("bolsillo_destino_id", e.target.value)}><MenuItem value="">Sin asignar</MenuItem>{bolsillos.map((b) => <MenuItem key={b.id} value={b.id}>{b.nombre}</MenuItem>)}</TextField></Grid><Grid item xs={12}><TextField fullWidth label="Concepto" value={form.concepto} onChange={(e) => set("concepto", e.target.value)} placeholder="Motivo o referencia de la transferencia" /></Grid></Grid><Stack direction="row" justifyContent="flex-end" spacing={1} sx={{ mt: 3 }}><Button onClick={() => setOpen(false)}>Cancelar</Button><Button variant="contained" disabled={saving} onClick={guardar}>{saving ? "Transfiriendo…" : "Transferir"}</Button></Stack></FormDialog></Box>;
}
