import { useEffect, useState, useCallback, useRef } from "react";
import { useForm, useFieldArray, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Box, Grid, TextField, Button, Stack, IconButton, Tooltip, MenuItem, Chip, Alert } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/DeleteOutline";
import PaymentIcon from "@mui/icons-material/PaymentsOutlined";
import PointOfSaleIcon from "@mui/icons-material/PointOfSaleOutlined";
import EditIcon from "@mui/icons-material/EditOutlined";
import DataTable from "../DataTable";
import FormDialog from "../FormDialog";
import { useAuth } from "../../context/AuthContext";
import { useNotify } from "../../hooks/useNotify";
import { useCajaActiva } from "../../hooks/useCajaActiva";
import { listarVentasPendientes, registrarPago, listarCuentasFinancieras, listarEntidadesFinancieras, registrarSaldoInicialCxC, editarSaldoInicialCxC } from "../../api/endpoints";
import { cuentaCompatibleConMetodo } from "../../utils/cuentasFinancieras";
import { fechaHoyISO } from "../../utils/format";

const METODOS_PAGO = ["Efectivo", "Yape", "Plin", "Transferencia", "Tarjeta"];

const schema = z.object({
  pagos: z
    .array(
      z.object({
        monto: z.coerce.number().positive("Monto inválido"),
        metodoPago: z.string().min(1),
        cuenta_financiera_id: z.coerce.number().positive().optional().or(z.literal("")),
      })
    )
    .min(1, "Agrega al menos un pago"),
});

export default function PorCobrarTab() {
  const { hasRole } = useAuth();
  const notify = useNotify();
  const { turno } = useCajaActiva();
  const idempotencyKeyRef = useRef(null);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [cobrando, setCobrando] = useState(null); // venta seleccionada para cobrar
  const [saving, setSaving] = useState(false);
  const [cuentasFinancieras, setCuentasFinancieras] = useState([]);
  const [entidades, setEntidades] = useState([]);
  const [saldoInicialOpen, setSaldoInicialOpen] = useState(false);
  const [saldoInicial, setSaldoInicial] = useState({ entidad_id: "", cliente_nombre: "", monto: "", fecha: fechaHoyISO(), descripcion: "Saldo inicial por cobrar" });
  const [saldoInicialEditando, setSaldoInicialEditando] = useState(null);
  const [saldoInicialEdicion, setSaldoInicialEdicion] = useState({ cliente_nombre: "", monto: "", fecha: "", descripcion: "" });

  const { control, register, handleSubmit, reset, watch, formState: { errors } } = useForm({
    resolver: zodResolver(schema),
    defaultValues: { pagos: [{ monto: "", metodoPago: "Efectivo" }] },
  });
  const pagosArray = useFieldArray({ control, name: "pagos" });
  const watchPagos = watch("pagos");

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await listarVentasPendientes());
    } catch (e) {
      notify.error(e);
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    cargar();
  }, [cargar]);
  useEffect(() => { listarEntidadesFinancieras().then((items) => { setEntidades(items); setSaldoInicial((actual) => ({ ...actual, entidad_id: actual.entidad_id || String(items[0]?.id || "") })); }).catch(notify.error); }, [notify]);

  const abrirCobro = async (venta) => {
    idempotencyKeyRef.current = crypto.randomUUID();
    setCobrando(venta);
    reset({ pagos: [{ monto: venta.saldo, metodoPago: "Efectivo", cuenta_financiera_id: "" }] });
    if (!venta.historico && venta.entidad_id) {
      try { setCuentasFinancieras(await listarCuentasFinancieras(venta.entidad_id)); } catch { setCuentasFinancieras([]); }
    } else setCuentasFinancieras([]);
  };

  const onSubmit = async (data) => {
    setSaving(true);
    try {
      idempotencyKeyRef.current ||= crypto.randomUUID();
      await registrarPago(cobrando.id, data.pagos, turno?.id, idempotencyKeyRef.current);
      notify.success("Cobro registrado");
      idempotencyKeyRef.current = null;
      setCobrando(null);
      cargar();
    } catch (e) {
      notify.error(e);
    } finally {
      setSaving(false);
    }
  };

  const puedeCobrar = hasRole("admin", "operador", "vendedor");
  const registrarSaldoInicial = async () => {
    if (!saldoInicial.entidad_id || !saldoInicial.cliente_nombre.trim() || !(Number(saldoInicial.monto) > 0)) return notify.error("Indica entidad, cliente y monto.");
    setSaving(true);
    try { await registrarSaldoInicialCxC(saldoInicial.entidad_id, { cliente_nombre: saldoInicial.cliente_nombre, monto: saldoInicial.monto, fecha: saldoInicial.fecha, descripcion: saldoInicial.descripcion }, crypto.randomUUID()); notify.success("Saldo inicial por cobrar registrado."); setSaldoInicialOpen(false); setSaldoInicial((actual) => ({ ...actual, cliente_nombre: "", monto: "" })); await cargar(); } catch (error) { notify.error(error); } finally { setSaving(false); }
  };
  const abrirEdicionSaldoInicial = (venta) => {
    setSaldoInicialEditando(venta);
    setSaldoInicialEdicion({ cliente_nombre: venta.cliente_nombre, monto: String(venta.monto_original ?? venta.saldo), fecha: venta.fecha, descripcion: "" });
  };
  const guardarEdicionSaldoInicial = async () => {
    if (!saldoInicialEdicion.cliente_nombre.trim() || !(Number(saldoInicialEdicion.monto) > 0)) return notify.error("Indica cliente y monto válido.");
    setSaving(true);
    try {
      await editarSaldoInicialCxC(saldoInicialEditando.entidad_id, saldoInicialEditando.id, saldoInicialEdicion, crypto.randomUUID());
      notify.success("Saldo inicial actualizado."); setSaldoInicialEditando(null); await cargar();
    } catch (error) { notify.error(error); } finally { setSaving(false); }
  };

  const columns = [
    { field: "folio", headerName: "Folio", minWidth: 80 },
    { field: "fecha", headerName: "Fecha" },
    { field: "cliente_nombre", headerName: "Cliente", minWidth: 160 },
    { field: "origen", headerName: "Origen", renderCell: (r) => r.es_saldo_inicial ? <Chip size="small" label="Saldo inicial" color="info" variant="outlined" /> : r.historico ? <Chip size="small" label="Histórico" variant="outlined" /> : <Chip size="small" label={r.estado_cxc} color={r.estado_cxc === "parcial" ? "warning" : "default"} /> },
    { field: "total", headerName: "Total", renderCell: (r) => `S/ ${(r.es_saldo_inicial ? r.monto_original : r.total).toFixed(2)}` },
    { field: "saldo", headerName: "Saldo", renderCell: (r) => <Chip size="small" color="warning" label={`S/ ${r.saldo.toFixed(2)}`} /> },
    {
      field: "acciones",
      headerName: "Acciones",
      align: "right",
      sortable: false,
      renderCell: (r) =>
        <Stack direction="row" spacing={0.5}>{puedeCobrar && <Tooltip title="Registrar cobro"><IconButton size="small" color="primary" onClick={() => abrirCobro(r)}><PaymentIcon fontSize="small" /></IconButton></Tooltip>}{hasRole("admin") && r.es_saldo_inicial && <Tooltip title="Editar saldo inicial"><IconButton size="small" color="primary" onClick={() => abrirEdicionSaldoInicial(r)}><EditIcon fontSize="small" /></IconButton></Tooltip>}</Stack>,
    },
  ];

  return (
    <Box>
      <Stack direction={{ xs: "column", sm: "row" }} justifyContent="flex-end" sx={{ mb: 2 }}>{hasRole("admin") && <Button variant="contained" onClick={() => setSaldoInicialOpen(true)}>Registrar saldo inicial por cobrar</Button>}</Stack><DataTable columns={columns} rows={rows} loading={loading} searchPlaceholder="Buscar venta…" defaultOrderBy="fecha" />

      <FormDialog open={saldoInicialOpen} onClose={() => setSaldoInicialOpen(false)} title="Saldo inicial por cobrar"><Stack spacing={2}><Alert severity="info">Úsalo únicamente para deudas de ventas anteriores al ERP. No genera una venta nueva ni descuenta inventario.</Alert><TextField select required label="Entidad" value={saldoInicial.entidad_id} onChange={(e) => setSaldoInicial({ ...saldoInicial, entidad_id: e.target.value })}>{entidades.map((entidad) => <MenuItem key={entidad.id} value={entidad.id}>{entidad.nombre}</MenuItem>)}</TextField><TextField required label="Cliente" value={saldoInicial.cliente_nombre} onChange={(e) => setSaldoInicial({ ...saldoInicial, cliente_nombre: e.target.value })} helperText="Si no existe, se creará automáticamente." /><TextField required type="number" inputProps={{ min: 0.01, step: 0.01 }} label="Monto pendiente (S/)" value={saldoInicial.monto} onChange={(e) => setSaldoInicial({ ...saldoInicial, monto: e.target.value })} /><TextField required type="date" label="Fecha de corte" InputLabelProps={{ shrink: true }} value={saldoInicial.fecha} onChange={(e) => setSaldoInicial({ ...saldoInicial, fecha: e.target.value })} /><TextField label="Descripción" value={saldoInicial.descripcion} onChange={(e) => setSaldoInicial({ ...saldoInicial, descripcion: e.target.value })} /><Stack direction="row" justifyContent="flex-end" spacing={1}><Button onClick={() => setSaldoInicialOpen(false)}>Cancelar</Button><Button variant="contained" disabled={saving} onClick={registrarSaldoInicial}>{saving ? "Registrando…" : "Registrar"}</Button></Stack></Stack></FormDialog>

      <FormDialog open={!!saldoInicialEditando} onClose={() => setSaldoInicialEditando(null)} title="Editar saldo inicial por cobrar" disableClose={saving}><Stack spacing={2}><Alert severity="info">Solo puedes editar este registro si no tiene cobros aplicados. La modificación conserva la trazabilidad financiera.</Alert><TextField required label="Cliente" value={saldoInicialEdicion.cliente_nombre} onChange={(e) => setSaldoInicialEdicion({ ...saldoInicialEdicion, cliente_nombre: e.target.value })} /><TextField required type="number" inputProps={{ min: 0.01, step: 0.01 }} label="Monto pendiente (S/)" value={saldoInicialEdicion.monto} onChange={(e) => setSaldoInicialEdicion({ ...saldoInicialEdicion, monto: e.target.value })} /><TextField required type="date" label="Fecha" InputLabelProps={{ shrink: true }} value={saldoInicialEdicion.fecha} onChange={(e) => setSaldoInicialEdicion({ ...saldoInicialEdicion, fecha: e.target.value })} /><TextField label="Observación (opcional)" value={saldoInicialEdicion.descripcion} onChange={(e) => setSaldoInicialEdicion({ ...saldoInicialEdicion, descripcion: e.target.value })} /><Stack direction="row" justifyContent="flex-end" spacing={1}><Button onClick={() => setSaldoInicialEditando(null)}>Cancelar</Button><Button variant="contained" disabled={saving} onClick={guardarEdicionSaldoInicial}>{saving ? "Guardando…" : "Guardar cambios"}</Button></Stack></Stack></FormDialog>

      <FormDialog open={!!cobrando} onClose={() => setCobrando(null)} title={`Cobrar venta — folio ${cobrando?.folio}`}>
        <Box component="form" onSubmit={handleSubmit(onSubmit)} noValidate>
          {turno ? (
                      <Chip
                        size="small"
                        icon={<PointOfSaleIcon />}
                        color="success"
                        variant="outlined"
                        label={`Se registrará en: ${turno.caja_nombre || "caja abierta"}`}
                        sx={{ mb: 2 }}
                      />
                    ) : (
                      <Alert severity="warning" sx={{ mb: 2 }}>
                        No tienes una caja abierta. El efectivo no estará disponible; usa una cuenta financiera para otro medio.
                      </Alert>
                    )}
          <Stack spacing={2}>
            {pagosArray.fields.map((field, index) => (
              <Grid container spacing={2} key={field.id} alignItems="center">
                <Grid item xs={6} sm={5}>
                  <TextField
                    label="Monto"
                    type="number"
                    fullWidth
                    inputProps={{ step: "0.01" }}
                    {...register(`pagos.${index}.monto`)}
                    error={!!errors.pagos?.[index]?.monto}
                    helperText={errors.pagos?.[index]?.monto?.message}
                  />
                </Grid>
                <Grid item xs={5} sm={5}>
                  <Controller
                    name={`pagos.${index}.metodoPago`}
                    control={control}
                    render={({ field: f }) => (
                      <TextField select label="Método" fullWidth {...f}>
                        {METODOS_PAGO.map((m) => (
                          <MenuItem key={m} value={m}>
                            {m}
                          </MenuItem>
                        ))}
                      </TextField>
                    )}
                  />
                </Grid>
                {watchPagos?.[index]?.metodoPago !== "Efectivo" && !cobrando?.historico && (
                  <Grid item xs={11} sm={5}>
                    <Controller
                      name={`pagos.${index}.cuenta_financiera_id`}
                      control={control}
                      render={({ field: f }) => (
                        <TextField select label="Cuenta receptora" fullWidth {...f}>
                          {cuentasFinancieras
                            .filter((cuenta) => cuentaCompatibleConMetodo(cuenta, watchPagos?.[index]?.metodoPago))
                            .map((cuenta) => <MenuItem key={cuenta.id} value={cuenta.id}>{cuenta.nombre}</MenuItem>)}
                        </TextField>
                      )}
                    />
                  </Grid>
                )}
                <Grid item xs={1}>
                  <IconButton size="small" onClick={() => pagosArray.remove(index)} disabled={pagosArray.fields.length === 1}>
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Grid>
              </Grid>
            ))}
          </Stack>
          <Button size="small" startIcon={<AddIcon />} onClick={() => pagosArray.append({ monto: "", metodoPago: "Efectivo", cuenta_financiera_id: "" })} sx={{ mt: 1 }}>
            Agregar otro método
          </Button>

          <Stack direction="row" justifyContent="flex-end" spacing={1.5} sx={{ mt: 3 }}>
            <Button onClick={() => setCobrando(null)} color="inherit">
              Cancelar
            </Button>
            <Button type="submit" variant="contained" disabled={saving}>
              {saving ? "Guardando…" : "Registrar cobro"}
            </Button>
          </Stack>
        </Box>
      </FormDialog>
    </Box>
  );
}
