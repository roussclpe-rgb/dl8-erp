import { useEffect, useState, useCallback, useRef } from "react";
import { useForm, useFieldArray, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Box, Grid, TextField, Button, Stack, IconButton, Tooltip, MenuItem, Chip, Alert } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/DeleteOutline";
import PaymentIcon from "@mui/icons-material/PaymentsOutlined";
import PointOfSaleIcon from "@mui/icons-material/PointOfSaleOutlined";
import DataTable from "../DataTable";
import FormDialog from "../FormDialog";
import { useAuth } from "../../context/AuthContext";
import { useNotify } from "../../hooks/useNotify";
import { useCajaActiva } from "../../hooks/useCajaActiva";
import { listarVentasPendientes, registrarPago, listarCuentasFinancieras } from "../../api/endpoints";

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

  const columns = [
    { field: "folio", headerName: "Folio", minWidth: 80 },
    { field: "fecha", headerName: "Fecha" },
    { field: "cliente_nombre", headerName: "Cliente", minWidth: 160 },
    { field: "origen", headerName: "Origen", renderCell: (r) => r.historico ? <Chip size="small" label="Histórico" variant="outlined" /> : <Chip size="small" label={r.estado_cxc} color={r.estado_cxc === "parcial" ? "warning" : "default"} /> },
    { field: "total", headerName: "Total", renderCell: (r) => `S/ ${r.total.toFixed(2)}` },
    { field: "saldo", headerName: "Saldo", renderCell: (r) => <Chip size="small" color="warning" label={`S/ ${r.saldo.toFixed(2)}`} /> },
    {
      field: "acciones",
      headerName: "Acciones",
      align: "right",
      sortable: false,
      renderCell: (r) =>
        puedeCobrar && (
          <Tooltip title="Registrar cobro">
            <IconButton size="small" color="primary" onClick={() => abrirCobro(r)}>
              <PaymentIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        ),
    },
  ];

  return (
    <Box>
      <DataTable columns={columns} rows={rows} loading={loading} searchPlaceholder="Buscar venta…" defaultOrderBy="fecha" />

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
                            .filter((cuenta) => ({ Yape: "billetera", Plin: "billetera", Transferencia: "banco", Tarjeta: "procesador" }[watchPagos?.[index]?.metodoPago] === cuenta.tipo))
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
