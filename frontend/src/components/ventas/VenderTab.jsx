import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useForm, Controller, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import dayjs from "dayjs";
import {
  Box,
  Grid,
  TextField,
  Button,
  Stack,
  IconButton,
  Tooltip,
  MenuItem,
  Autocomplete,
  Paper,
  Typography,
  Divider,
  Chip,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/DeleteOutline";
import BlockIcon from "@mui/icons-material/BlockOutlined";

import DataTable from "../DataTable";
import ConfirmDialog from "../ConfirmDialog";
import { useAuth } from "../../context/AuthContext";
import { useCajaActiva } from "../../hooks/useCajaActiva";
import { useNotify } from "../../hooks/useNotify";
import {
  listarClientes,
  listarProductosVenta,
  crearVenta,
  listarVentas,
  anularVenta,
  listarEntidadesFinancieras,
  listarCuentasFinancieras,
} from "../../api/endpoints";

const METODOS_PAGO = ["Efectivo", "Yape", "Plin", "Transferencia", "Tarjeta"];

const schema = z.object({
  entidad_id: z.coerce.number().positive("Selecciona una entidad económica"),
  cliente_id: z.number({ required_error: "Selecciona un cliente" }),
  fecha: z.string().min(1),
  items: z
    .array(
      z.object({
        receta_grupo_id: z.number({ required_error: "Selecciona un producto" }),
        cantidad: z.coerce.number().positive("Cantidad inválida"),
      })
    )
    .min(1, "Agrega al menos un producto"),
  pagos: z.array(
      z.object({
        monto: z.coerce.number().positive("Monto inválido"),
        metodoPago: z.string().min(1),
        cuenta_financiera_id: z.coerce.number().positive().optional().or(z.literal("")),
    })
  ),
});

const defaultValues = {
  entidad_id: "",
  cliente_id: undefined,
  fecha: dayjs().format("YYYY-MM-DD"),
  items: [{ receta_grupo_id: undefined, cantidad: 1 }],
  pagos: [],
};

export default function VenderTab() {
  const { hasRole } = useAuth();
  const notify = useNotify();
  const { turno } = useCajaActiva();
  const idempotencyKeyRef = useRef(null);

  const [clientes, setClientes] = useState([]);
  const [entidades, setEntidades] = useState([]);
  const [cuentasFinancieras, setCuentasFinancieras] = useState([]);
  const [productos, setProductos] = useState([]);
  const [ventas, setVentas] = useState([]);
  const [loadingVentas, setLoadingVentas] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toAnular, setToAnular] = useState(null);
  const [anulando, setAnulando] = useState(false);

  const {
    control,
    register,
    handleSubmit,
    watch,
    reset,
    formState: { errors },
  } = useForm({ resolver: zodResolver(schema), defaultValues });

  const itemsArray = useFieldArray({ control, name: "items" });
  const pagosArray = useFieldArray({ control, name: "pagos" });

  const watchItems = watch("items");
  const watchPagos = watch("pagos");
  const entidadId = watch("entidad_id");

  useEffect(() => {
    if (!entidadId) return setCuentasFinancieras([]);
    listarCuentasFinancieras(entidadId).then(setCuentasFinancieras).catch(() => setCuentasFinancieras([]));
  }, [entidadId]);

  const cargarBase = useCallback(async () => {
    try {
      const [c, p, e] = await Promise.all([listarClientes(), listarProductosVenta(), listarEntidadesFinancieras()]);
      setClientes(c);
      setProductos(p);
      setEntidades(e);
    } catch (e) {
      notify.error(e);
    }
  }, [notify]);

  const cargarVentas = useCallback(async () => {
    setLoadingVentas(true);
    try {
      setVentas(await listarVentas());
    } catch (e) {
      notify.error(e);
    } finally {
      setLoadingVentas(false);
    }
  }, [notify]);

  useEffect(() => {
    cargarBase();
    cargarVentas();
  }, [cargarBase, cargarVentas]);

  // Total en vivo, calculado con el precio del cliente seleccionado.
  const clienteSeleccionado = clientes.find((c) => c.id === watch("cliente_id"));
  const total = useMemo(() => {
    if (!clienteSeleccionado) return 0;
    return (watchItems || []).reduce((acc, it) => {
      const producto = productos.find((p) => p.receta_grupo_id === it.receta_grupo_id);
      if (!producto || !it.cantidad) return acc;
      const precio = clienteSeleccionado.tipo === "mayorista" ? producto.precio_mayorista : producto.precio_normal;
      return acc + precio * Number(it.cantidad);
    }, 0);
  }, [watchItems, productos, clienteSeleccionado]);

  const totalPagado = (watchPagos || []).reduce((acc, p) => acc + (Number(p.monto) || 0), 0);

  const onSubmit = async (data) => {
    setSaving(true);
    try {
      idempotencyKeyRef.current ||= crypto.randomUUID();
      await crearVenta({
      ...data,
      turno_caja_id: turno?.id,
   }, idempotencyKeyRef.current);
      notify.success("Venta registrada");
      idempotencyKeyRef.current = null;
      reset(defaultValues);
      cargarBase();
      cargarVentas();
    } catch (e) {
      notify.error(e);
    } finally {
      setSaving(false);
    }
  };

  const confirmarAnular = async () => {
    setAnulando(true);
    try {
      await anularVenta(toAnular.id);
      notify.success("Venta anulada");
      setToAnular(null);
      cargarBase(); // el stock se libera solo, pero refrescamos por si acaso
      cargarVentas();
    } catch (e) {
      notify.error(e);
    } finally {
      setAnulando(false);
    }
  };

  const puedeVender = hasRole("admin", "operador", "vendedor");
  const puedeAnular = hasRole("admin");

  const columnsVentas = [
    { field: "folio", headerName: "Folio", minWidth: 80 },
    { field: "fecha", headerName: "Fecha" },
    { field: "cliente_nombre", headerName: "Cliente", minWidth: 160 },
    { field: "total", headerName: "Total", renderCell: (r) => `S/ ${r.total.toFixed(2)}` },
    {
      field: "saldo",
      headerName: "Saldo",
      renderCell: (r) =>
        r.saldo > 0.01 ? (
          <Chip size="small" color="warning" label={`S/ ${r.saldo.toFixed(2)}`} />
        ) : (
          <Chip size="small" color="success" label="Pagada" variant="outlined" />
        ),
    },
    {
      field: "acciones",
      headerName: "Acciones",
      align: "right",
      sortable: false,
      renderCell: (r) =>
        puedeAnular && (
          <Tooltip title="Anular venta">
            <IconButton size="small" color="error" onClick={() => setToAnular(r)}>
              <BlockIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        ),
    },
  ];

  return (
    <Box>
      {puedeVender && (
        <Paper variant="outlined" sx={{ p: 3, mb: 4 }}>
          <Typography variant="h6" sx={{ mb: 2, fontWeight: 700 }}>
            Nueva venta
          </Typography>

          <Box component="form" onSubmit={handleSubmit(onSubmit)} noValidate>
            <Grid container spacing={2}>
              <Grid item xs={12} sm={5}>
                <Controller
                  name="entidad_id"
                  control={control}
                  render={({ field }) => (
                    <TextField select label="Entidad económica" fullWidth {...field} error={!!errors.entidad_id} helperText={errors.entidad_id?.message}>
                      {entidades.map((entidad) => (
                        <MenuItem key={entidad.id} value={entidad.id}>{entidad.nombre}</MenuItem>
                      ))}
                    </TextField>
                  )}
                />
              </Grid>
              <Grid item xs={12} sm={7}>
                <Controller
                  name="cliente_id"
                  control={control}
                  render={({ field }) => (
                    <Autocomplete
                      options={clientes}
                      getOptionLabel={(o) => o.nombre || ""}
                      isOptionEqualToValue={(o, v) => o.id === v.id}
                      value={clientes.find((c) => c.id === field.value) || null}
                      onChange={(_, val) => field.onChange(val?.id)}
                      renderInput={(params) => (
                        <TextField {...params} label="Cliente" error={!!errors.cliente_id} helperText={errors.cliente_id?.message} />
                      )}
                    />
                  )}
                />
              </Grid>
              <Grid item xs={12} sm={5}>
                <TextField label="Fecha" type="date" fullWidth InputLabelProps={{ shrink: true }} {...register("fecha")} />
              </Grid>
            </Grid>

            <Divider sx={{ my: 3 }} />

            <Typography variant="subtitle2" sx={{ mb: 1.5 }}>
              Productos
            </Typography>
            <Stack spacing={2}>
              {itemsArray.fields.map((field, index) => {
                const producto = productos.find((p) => p.receta_grupo_id === watchItems?.[index]?.receta_grupo_id);
                return (
                  <Grid container spacing={2} key={field.id} alignItems="center">
                    <Grid item xs={12} sm={6}>
                      <Controller
                        name={`items.${index}.receta_grupo_id`}
                        control={control}
                        render={({ field: f }) => (
                          <Autocomplete
                            options={productos}
                            getOptionLabel={(o) => o.nombre_producto || ""}
                            isOptionEqualToValue={(o, v) => o.receta_grupo_id === v.receta_grupo_id}
                            value={productos.find((p) => p.receta_grupo_id === f.value) || null}
                            onChange={(_, val) => f.onChange(val?.receta_grupo_id)}
                            renderInput={(params) => (
                              <TextField
                                {...params}
                                label="Producto"
                                error={!!errors.items?.[index]?.receta_grupo_id}
                                helperText={errors.items?.[index]?.receta_grupo_id?.message}
                              />
                            )}
                          />
                        )}
                      />
                    </Grid>
                    <Grid item xs={7} sm={3}>
                      <TextField
                        label="Cantidad"
                        type="number"
                        fullWidth
                        inputProps={{ step: "1", min: "1" }}
                        {...register(`items.${index}.cantidad`)}
                        error={!!errors.items?.[index]?.cantidad}
                        helperText={
                          errors.items?.[index]?.cantidad?.message ||
                          (producto ? `Disponible: ${producto.stockDisponible}` : "")
                        }
                      />
                    </Grid>
                    <Grid item xs={4} sm={2}>
                      <Typography variant="body2" color="text.secondary">
                        {producto && clienteSeleccionado
                          ? `S/ ${(
                              (clienteSeleccionado.tipo === "mayorista" ? producto.precio_mayorista : producto.precio_normal) *
                              (Number(watchItems?.[index]?.cantidad) || 0)
                            ).toFixed(2)}`
                          : "—"}
                      </Typography>
                    </Grid>
                    <Grid item xs={1}>
                      <IconButton size="small" onClick={() => itemsArray.remove(index)} disabled={itemsArray.fields.length === 1}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Grid>
                  </Grid>
                );
              })}
            </Stack>
            <Button
              size="small"
              startIcon={<AddIcon />}
              onClick={() => itemsArray.append({ receta_grupo_id: undefined, cantidad: 1 })}
              sx={{ mt: 1 }}
            >
              Agregar producto
            </Button>
            {errors.items?.message && (
              <Typography color="error" variant="caption" display="block" sx={{ mt: 1 }}>
                {errors.items.message}
              </Typography>
            )}

            <Divider sx={{ my: 3 }} />

            <Typography variant="subtitle2" sx={{ mb: 1.5 }}>
              Pagos (opcional — puedes dejarlo a crédito y cobrar después)
            </Typography>
            <Stack spacing={2}>
              {pagosArray.fields.map((field, index) => (
                <Grid container spacing={2} key={field.id} alignItems="center">
                  <Grid item xs={6} sm={4}>
                    <TextField
                      label="Monto"
                      type="number"
                      fullWidth
                      inputProps={{ step: "0.01" }}
                      {...register(`pagos.${index}.monto`)}
                      error={!!errors.pagos?.[index]?.monto}
                    />
                  </Grid>
                  <Grid item xs={5} sm={4}>
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
                  {watchPagos?.[index]?.metodoPago !== "Efectivo" && (
                    <Grid item xs={11} sm={3}>
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
                    <IconButton size="small" onClick={() => pagosArray.remove(index)}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Grid>
                </Grid>
              ))}
            </Stack>
            <Button
              size="small"
              startIcon={<AddIcon />}
              onClick={() => pagosArray.append({ monto: "", metodoPago: "Efectivo", cuenta_financiera_id: "" })}
              sx={{ mt: 1 }}
            >
              Agregar pago
            </Button>

            <Divider sx={{ my: 3 }} />

            <Stack direction="row" justifyContent="space-between" alignItems="center">
              <Box>
                <Typography variant="body2" color="text.secondary">
                  Total: <strong>S/ {total.toFixed(2)}</strong> · Pagado: S/ {totalPagado.toFixed(2)} · Saldo:{" "}
                  <strong>S/ {Math.max(total - totalPagado, 0).toFixed(2)}</strong>
                </Typography>
              </Box>
              <Button type="submit" variant="contained" disabled={saving}>
                {saving ? "Guardando…" : "Registrar venta"}
              </Button>
            </Stack>
          </Box>
        </Paper>
      )}

      <Typography variant="h6" sx={{ mb: 2, fontWeight: 700 }}>
        Ventas recientes
      </Typography>
      <DataTable columns={columnsVentas} rows={ventas} loading={loadingVentas} searchPlaceholder="Buscar venta…" defaultOrderBy="fecha" />

      <ConfirmDialog
        open={!!toAnular}
        title="Anular venta"
        message={`¿Anular la venta con folio ${toAnular?.folio}? El stock vendido se libera automáticamente.`}
        confirmText="Anular"
        danger
        loading={anulando}
        onClose={() => setToAnular(null)}
        onConfirm={confirmarAnular}
      />
    </Box>
  );
}
