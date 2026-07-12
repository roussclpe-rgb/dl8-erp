import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Box, Button, Chip, Grid, IconButton, MenuItem, Stack, TextField, Tooltip, Typography } from "@mui/material";
import PaymentIcon from "@mui/icons-material/PaymentsOutlined";
import ReplayIcon from "@mui/icons-material/ReplayOutlined";
import UndoIcon from "@mui/icons-material/UndoOutlined";
import VisibilityIcon from "@mui/icons-material/VisibilityOutlined";
import DataTable from "../DataTable";
import ConfirmDialog from "../ConfirmDialog";
import FormDialog from "../FormDialog";
import { useAuth } from "../../context/AuthContext";
import { useCajaActiva } from "../../hooks/useCajaActiva";
import { useNotify } from "../../hooks/useNotify";
import { fechaHoyISO, formatoFecha } from "../../utils/format";
import { cuentaCompatibleConMetodo } from "../../utils/cuentasFinancieras";
import { crearNotaCreditoCxP, listarBolsillos, listarCuentasFinancieras, listarDocumentosCxP, listarEntidadesFinancieras, listarProveedores, obtenerDocumentoCxP, registrarPagoCxP, revertirPagoCxP } from "../../api/endpoints";

const METODOS = ["Efectivo", "Yape", "Plin", "Transferencia", "Tarjeta"];
const moneda = (valor) => `S/ ${Number(valor || 0).toFixed(2)}`;
const mensajeError = (error, accion) => {
  const prefijos = { 400: "Revisa los datos", 403: "No tienes permisos", 404: "El registro ya no existe", 409: "La operación está bloqueada" };
  return `${prefijos[error?.status] || `No se pudo ${accion}`}: ${error.message}`;
};

export default function PorPagarTab() {
  const { hasRole } = useAuth();
  const notify = useNotify();
  const { turno } = useCajaActiva();
  const pagoKeyRef = useRef(null);
  const notaKeyRef = useRef(null);
  const reversionKeysRef = useRef(new Map());
  const [entidades, setEntidades] = useState([]);
  const [proveedores, setProveedores] = useState([]);
  const [entidadId, setEntidadId] = useState("");
  const [proveedorId, setProveedorId] = useState("");
  const [estado, setEstado] = useState("");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [detalle, setDetalle] = useState(null);
  const [pagar, setPagar] = useState(null);
  const [nota, setNota] = useState(null);
  const [confirmacion, setConfirmacion] = useState(null);
  const [cuentas, setCuentas] = useState([]);
  const [bolsillos, setBolsillos] = useState([]);
  const [metodo, setMetodo] = useState("Transferencia");
  const [cuentaId, setCuentaId] = useState("");
  const [bolsilloId, setBolsilloId] = useState("");
  const [monto, setMonto] = useState("");
  const [cantidadNota, setCantidadNota] = useState("");
  const [importeNota, setImporteNota] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([listarEntidadesFinancieras(), listarProveedores()])
      .then(([ent, prov]) => { setEntidades(ent); setProveedores(prov); })
      .catch(notify.error);
  }, [notify]);

  const cargar = useCallback(async () => {
    if (!entidadId) return setRows([]);
    setLoading(true);
    try {
      setRows(await listarDocumentosCxP({ entidad_id: entidadId, proveedor_id: proveedorId || undefined, estado: estado || undefined, fecha_emision_desde: desde || undefined, fecha_emision_hasta: hasta || undefined }));
    } catch (error) {
      notify.error(mensajeError(error, "consultar las CxP"));
    } finally {
      setLoading(false);
    }
  }, [entidadId, proveedorId, estado, desde, hasta, notify]);

  useEffect(() => { cargar(); }, [cargar]);
  const refrescarDetalle = async (documentoId) => {
    const actualizado = await obtenerDocumentoCxP(documentoId);
    setDetalle(actualizado);
    return actualizado;
  };
  const abrirDetalle = async (row) => {
    try { await refrescarDetalle(row.id); } catch (error) { notify.error(mensajeError(error, "abrir el detalle")); }
  };
  const abrirPago = async (row) => {
    try {
      const [detalleDocumento, cuentasEntidad, bolsillosEntidad] = await Promise.all([obtenerDocumentoCxP(row.id), listarCuentasFinancieras(row.entidad_id), listarBolsillos(row.entidad_id)]);
      pagoKeyRef.current = crypto.randomUUID();
      setPagar(detalleDocumento.documento);
      setCuentas(cuentasEntidad.filter((c) => c.estado === "activa"));
      setBolsillos(bolsillosEntidad.filter((b) => b.estado === "activa"));
      setMetodo("Transferencia"); setCuentaId("");
      setBolsilloId(bolsillosEntidad.find((b) => b.tipo === "sin_asignar" && b.estado === "activa")?.id || "");
      setMonto(detalleDocumento.documento.saldo);
    } catch (error) { notify.error(mensajeError(error, "preparar el pago")); }
  };
  const abrirNota = async (row) => {
    try {
      const detalleDocumento = await obtenerDocumentoCxP(row.id);
      notaKeyRef.current = crypto.randomUUID();
      setNota(detalleDocumento.documento);
      setCantidadNota("");
      setImporteNota("");
    } catch (error) { notify.error(mensajeError(error, "preparar la devolución")); }
  };
  const cerrarPago = () => { if (!saving) { setPagar(null); pagoKeyRef.current = null; } };
  const cerrarNota = () => { if (!saving) { setNota(null); notaKeyRef.current = null; } };
  const montoInvalido = !(Number(monto) > 0) || Number(monto) > Number(pagar?.saldo || 0);
  const notaInvalida = !(Number(cantidadNota) > 0) || !(Number(importeNota) > 0) || Number(cantidadNota) > Number(nota?.cantidad_restante || 0) || Number(importeNota) > Number(nota?.saldo || 0);
  const enviarPago = async () => {
    if (montoInvalido) return notify.error("El pago no puede superar el saldo seleccionado");
    setSaving(true);
    try {
      pagoKeyRef.current ||= crypto.randomUUID();
      await registrarPagoCxP({ entidad_id: pagar.entidad_id, proveedor_id: pagar.proveedor_id, cuenta_financiera_id: cuentaId, bolsillo_id: bolsilloId, metodo_pago: metodo, turno_caja_id: metodo === "Efectivo" ? turno?.id : undefined, fecha: fechaHoyISO(), monto: Number(monto), aplicaciones: [{ documento_cxp_id: pagar.id, monto: Number(monto) }] }, pagoKeyRef.current);
      notify.success("Pago registrado"); setPagar(null); pagoKeyRef.current = null; cargar();
    } catch (error) { notify.error(mensajeError(error, "registrar el pago")); } finally { setSaving(false); }
  };
  const confirmarNota = () => {
    if (notaInvalida) return notify.error("La cantidad e importe deben estar dentro del inventario y saldo disponibles");
    setConfirmacion({ tipo: "nota", documento: nota });
  };
  const ejecutarConfirmacion = async () => {
    if (!confirmacion) return;
    setSaving(true);
    try {
      if (confirmacion.tipo === "nota") {
        const documento = confirmacion.documento;
        notaKeyRef.current ||= crypto.randomUUID();
        await crearNotaCreditoCxP(documento.id, { entidad_id: documento.entidad_id, proveedor_id: documento.proveedor_id, cantidad_base: Number(cantidadNota), importe: Number(importeNota), fecha: fechaHoyISO() }, notaKeyRef.current);
        notify.success("Nota de crédito registrada");
        setNota(null); notaKeyRef.current = null;
        await refrescarDetalle(documento.id).catch(() => setDetalle(null));
        cargar();
      } else {
        const pago = confirmacion.pago;
        const key = reversionKeysRef.current.get(pago.id) || crypto.randomUUID();
        reversionKeysRef.current.set(pago.id, key);
        await revertirPagoCxP(pago.id, key);
        notify.success("Pago revertido");
        reversionKeysRef.current.delete(pago.id);
        await refrescarDetalle(confirmacion.documentoId);
        cargar();
      }
      setConfirmacion(null);
    } catch (error) {
      notify.error(mensajeError(error, confirmacion.tipo === "nota" ? "registrar la devolución" : "revertir el pago"));
    } finally { setSaving(false); }
  };

  const puedePagar = hasRole("admin", "operador");
  const puedeCorregir = hasRole("admin");
  const columns = [
    { field: "proveedor_nombre", headerName: "Proveedor", minWidth: 160 },
    { field: "entidad_nombre", headerName: "Entidad", minWidth: 150 },
    { field: "fecha_emision", headerName: "Emisión", renderCell: (r) => formatoFecha(r.fecha_emision) },
    { field: "fecha_vencimiento", headerName: "Vence", renderCell: (r) => r.fecha_vencimiento ? formatoFecha(r.fecha_vencimiento) : "—" },
    { field: "importe_original", headerName: "Importe", align: "right", renderCell: (r) => moneda(r.importe_original) },
    { field: "saldo", headerName: "Saldo", align: "right", renderCell: (r) => moneda(r.saldo) },
    { field: "estado", headerName: "Estado", renderCell: (r) => <Chip size="small" label={r.estado} color={r.estado === "pagada" ? "success" : r.estado === "parcial" ? "warning" : "default"} /> },
    { field: "acciones", headerName: "Acciones", align: "right", sortable: false, renderCell: (r) => <Stack direction="row"><Tooltip title="Ver detalle"><IconButton size="small" onClick={() => abrirDetalle(r)}><VisibilityIcon fontSize="small" /></IconButton></Tooltip>{puedePagar && r.saldo_minor > 0 && r.estado !== "anulada" && <Tooltip title="Registrar pago"><IconButton size="small" color="primary" onClick={() => abrirPago(r)}><PaymentIcon fontSize="small" /></IconButton></Tooltip>}{puedeCorregir && r.saldo_minor > 0 && r.cantidad_restante > 0 && r.estado !== "anulada" && <Tooltip title="Nota de crédito / devolución"><IconButton size="small" color="warning" onClick={() => abrirNota(r)}><UndoIcon fontSize="small" /></IconButton></Tooltip>}</Stack> },
  ];

  return <Box>
    <Grid container spacing={1.5} sx={{ mb: 2 }}>
      <Grid item xs={12} sm={4}><TextField select fullWidth label="Entidad" value={entidadId} onChange={(e) => setEntidadId(e.target.value)}><MenuItem value="">Selecciona…</MenuItem>{entidades.map((e) => <MenuItem key={e.id} value={e.id}>{e.nombre}</MenuItem>)}</TextField></Grid>
      <Grid item xs={12} sm={3}><TextField select fullWidth label="Proveedor" value={proveedorId} onChange={(e) => setProveedorId(e.target.value)}><MenuItem value="">Todos</MenuItem>{proveedores.map((p) => <MenuItem key={p.id} value={p.id}>{p.nombre}</MenuItem>)}</TextField></Grid>
      <Grid item xs={6} sm={2}><TextField select fullWidth label="Estado" value={estado} onChange={(e) => setEstado(e.target.value)}><MenuItem value="">Todos</MenuItem>{["abierta", "parcial", "pagada", "anulada"].map((v) => <MenuItem key={v} value={v}>{v}</MenuItem>)}</TextField></Grid>
      <Grid item xs={6} sm={1.5}><TextField fullWidth type="date" label="Desde" InputLabelProps={{ shrink: true }} value={desde} onChange={(e) => setDesde(e.target.value)} /></Grid>
      <Grid item xs={6} sm={1.5}><TextField fullWidth type="date" label="Hasta" InputLabelProps={{ shrink: true }} value={hasta} onChange={(e) => setHasta(e.target.value)} /></Grid>
    </Grid>
    {!entidadId && <Alert severity="info" sx={{ mb: 2 }}>Selecciona una entidad para consultar sus CxP.</Alert>}
    <DataTable columns={columns} rows={rows} loading={loading} searchPlaceholder="Buscar CxP…" defaultOrderBy="fecha_emision" defaultOrder="desc" />

    <FormDialog open={!!detalle} onClose={() => !saving && setDetalle(null)} title={`Detalle CxP #${detalle?.documento?.id || ""}`} maxWidth="md" disableClose={saving}>
      <Stack spacing={1.5}>{detalle && <><Typography><b>{detalle.proveedor.nombre}</b> · {detalle.documento.entidad_nombre}</Typography><Typography>Importe: {moneda(detalle.documento.importe_original)} · Saldo: {moneda(detalle.documento.saldo)} · Estado: {detalle.documento.estado}</Typography><Typography>Inventario disponible: {detalle.compra.cantidad_restante} {detalle.compra.unidad_base}</Typography><Typography variant="subtitle2">Evento de emisión #{detalle.evento_emision.id}</Typography>{detalle.pagos.length ? detalle.pagos.map((p) => <Box key={p.id}><Stack direction="row" alignItems="center" spacing={1}><Typography variant="body2">Pago #{p.id} · {p.metodo_pago} · {moneda(p.importe)} · {p.cuenta_financiera_nombre} · {p.estado}</Typography>{puedeCorregir && p.estado === "confirmado" && <Tooltip title="Revertir pago"><IconButton size="small" color="warning" disabled={saving} onClick={() => setConfirmacion({ tipo: "reversion", pago: p, documentoId: detalle.documento.id })}><ReplayIcon fontSize="small" /></IconButton></Tooltip>}</Stack>{p.aplicaciones.map((a) => <Typography key={a.id} variant="caption" display="block">Aplicación #{a.id}: {moneda(a.importe)} ({a.estado})</Typography>)}</Box>) : <Typography variant="body2">Sin pagos aplicados.</Typography>}</>}</Stack>
    </FormDialog>
    <FormDialog open={!!pagar} onClose={cerrarPago} title={`Pagar CxP #${pagar?.id || ""}`} disableClose={saving}><Stack spacing={2}><Alert severity="info">Saldo disponible: {moneda(pagar?.saldo)}</Alert><TextField label="Monto" type="number" inputProps={{ min: 0.01, max: pagar?.saldo, step: "0.01" }} value={monto} onChange={(e) => setMonto(e.target.value)} error={montoInvalido} helperText={montoInvalido ? "No puede superar el saldo" : ""} /><TextField select label="Método" value={metodo} onChange={(e) => { setMetodo(e.target.value); setCuentaId(""); }}>{METODOS.map((m) => <MenuItem key={m} value={m}>{m}</MenuItem>)}</TextField><TextField select label="Cuenta financiera de origen" value={cuentaId} onChange={(e) => setCuentaId(e.target.value)}>{cuentas.filter((c) => cuentaCompatibleConMetodo(c, metodo)).map((c) => <MenuItem key={c.id} value={c.id}>{c.nombre}</MenuItem>)}</TextField><TextField select label="Bolsillo de origen" value={bolsilloId} onChange={(e) => setBolsilloId(e.target.value)}>{bolsillos.map((b) => <MenuItem key={b.id} value={b.id}>{b.nombre}</MenuItem>)}</TextField>{metodo === "Efectivo" && !turno && <Alert severity="warning">El efectivo requiere un turno de Caja abierto.</Alert>}<Stack direction="row" justifyContent="flex-end" spacing={1}><Button onClick={cerrarPago}>Cancelar</Button><Button variant="contained" disabled={saving || montoInvalido || !cuentaId || !bolsilloId || (metodo === "Efectivo" && !turno)} onClick={enviarPago}>{saving ? "Guardando…" : "Registrar pago"}</Button></Stack></Stack></FormDialog>
    <FormDialog open={!!nota} onClose={cerrarNota} title={`Nota de crédito CxP #${nota?.id || ""}`} disableClose={saving}><Stack spacing={2}><Alert severity="warning">Devolverás inventario al proveedor y reducirás la CxP. Esta operación no se puede deshacer.</Alert><Typography variant="body2">Inventario disponible: {nota?.cantidad_restante || 0} {nota?.unidad_base} · Saldo corregible: {moneda(nota?.saldo)}</Typography><TextField label="Cantidad a devolver" type="number" inputProps={{ min: 0.0001, max: nota?.cantidad_restante, step: "any" }} value={cantidadNota} onChange={(e) => setCantidadNota(e.target.value)} error={Number(cantidadNota) > Number(nota?.cantidad_restante || 0)} helperText={Number(cantidadNota) > Number(nota?.cantidad_restante || 0) ? "Supera el inventario disponible" : ""} /><TextField label="Importe a devolver" type="number" inputProps={{ min: 0.01, max: nota?.saldo, step: "0.01" }} value={importeNota} onChange={(e) => setImporteNota(e.target.value)} error={Number(importeNota) > Number(nota?.saldo || 0)} helperText={Number(importeNota) > Number(nota?.saldo || 0) ? "Supera el saldo corregible" : ""} /><Stack direction="row" justifyContent="flex-end" spacing={1}><Button onClick={cerrarNota}>Cancelar</Button><Button color="warning" variant="contained" disabled={saving || notaInvalida} onClick={confirmarNota}>Continuar</Button></Stack></Stack></FormDialog>
    <ConfirmDialog open={!!confirmacion} title={confirmacion?.tipo === "nota" ? "¿Registrar devolución?" : "¿Revertir pago?"} message={confirmacion?.tipo === "nota" ? "Se creará una nota de crédito, se retirará el inventario indicado y se actualizará la CxP." : "Se revertirá el evento financiero y se restaurará el saldo de la CxP."} confirmText={confirmacion?.tipo === "nota" ? "Registrar devolución" : "Revertir pago"} danger loading={saving} onClose={() => !saving && setConfirmacion(null)} onConfirm={ejecutarConfirmacion} />
  </Box>;
}
