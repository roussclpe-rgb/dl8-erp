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
import EditIcon from "@mui/icons-material/EditOutlined";

import DataTable from "../DataTable";
import ConfirmDialog from "../ConfirmDialog";
import FormDialog from "../FormDialog";
import { useAuth } from "../../context/AuthContext";
import { useCajaActiva } from "../../hooks/useCajaActiva";
import { useNotify } from "../../hooks/useNotify";
import { cuentaCompatibleConMetodo } from "../../utils/cuentasFinancieras";
import {
  listarClientes,
  listarProductosVenta,
  crearVenta,
  listarVentas,
  obtenerVenta,
  anularVenta,
  corregirFechaVenta,
  listarEntidadesFinancieras,
  listarCuentasFinancieras,
  crearCliente,
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
  vueltos: z.array(z.object({ monto: z.coerce.number().positive("Monto inválido"), metodoPago: z.string().min(1), cuenta_financiera_id: z.coerce.number().positive().optional().or(z.literal("")) })).default([]),
  descuento_tipo: z.enum(["monto", "porcentaje"]).default("monto"),
  descuento_valor: z.coerce.number().min(0, "Debe ser 0 o mayor").default(0),
});

const defaultValues = {
  entidad_id: "",
  cliente_id: undefined,
  fecha: dayjs().format("YYYY-MM-DD"),
  items: [{ receta_grupo_id: undefined, cantidad: 1 }],
  pagos: [],
  vueltos: [],
  descuento_tipo: "monto",
  descuento_valor: 0,
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
  const [ventaFechaEditando, setVentaFechaEditando] = useState(null);
  const [fechaCorregida, setFechaCorregida] = useState("");
  const [corrigiendoFecha, setCorrigiendoFecha] = useState(false);
  const [ventaDetalle, setVentaDetalle] = useState(null);
  const [quickClientOpen, setQuickClientOpen] = useState(false);
  const [quickClientName, setQuickClientName] = useState("");
  const [quickClientType, setQuickClientType] = useState("minorista");
  const [creatingClient, setCreatingClient] = useState(false);

  const {
    control,
    register,
    handleSubmit,
    watch,
    reset,
    setValue,
    formState: { errors },
  } = useForm({ resolver: zodResolver(schema), defaultValues });

  const itemsArray = useFieldArray({ control, name: "items" });
  const pagosArray = useFieldArray({ control, name: "pagos" });
  const vueltosArray = useFieldArray({ control, name: "vueltos" });

  const watchItems = watch("items");
  const watchPagos = watch("pagos");
  const watchVueltos = watch("vueltos");
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

  // Subtotal en vivo, calculado con el precio del cliente seleccionado.
  const clienteSeleccionado = clientes.find((c) => c.id === watch("cliente_id"));
  const subtotal = (watchItems || []).reduce((acc, it) => {
    const producto = productos.find((p) => Number(p.receta_grupo_id) === Number(it.receta_grupo_id));
    if (!producto || !it.cantidad) return acc;
    const precio = clienteSeleccionado?.tipo === "mayorista" ? producto.precio_mayorista : producto.precio_normal;
    return acc + Number(precio || 0) * Number(it.cantidad);
  }, 0);

  const watchDescuentoTipo = watch("descuento_tipo");
  const watchDescuentoValor = watch("descuento_valor");
  const descuentoMonto = useMemo(() => {
    const valor = Number(watchDescuentoValor) || 0;
    if (valor <= 0) return 0;
    return watchDescuentoTipo === "porcentaje" ? subtotal * (Math.min(valor, 100) / 100) : Math.min(valor, subtotal);
  }, [watchDescuentoTipo, watchDescuentoValor, subtotal]);

  const total = Math.max(subtotal - descuentoMonto, 0);

  const totalPagado = (watchPagos || []).reduce((acc, p) => acc + (Number(p.monto) || 0), 0);
  const totalNoEfectivo = (watchPagos || []).filter((p) => p.metodoPago !== "Efectivo").reduce((acc, p) => acc + (Number(p.monto) || 0), 0);
  const efectivoRecibido = (watchPagos || []).filter((p) => p.metodoPago === "Efectivo").reduce((acc, p) => acc + (Number(p.monto) || 0), 0);
  const vuelto = Math.max(totalPagado - total, 0);
  const vueltoRegistrado = (watchVueltos || []).reduce((acc, v) => acc + (Number(v.monto) || 0), 0);
  const vueltoKey = JSON.stringify(watchVueltos || []);

  useEffect(() => {
    const filas = watchVueltos || [];
    if (!filas.length || vuelto <= 0) return;
    const ultimo = filas.length - 1;
    const antesDelUltimo = filas.slice(0, -1).reduce((totalAnterior, fila) => totalAnterior + (Number(fila.monto) || 0), 0);
    const automatico = Math.max(vuelto - antesDelUltimo, 0);
    if (Number(filas[ultimo]?.monto || 0) !== automatico) setValue(`vueltos.${ultimo}.monto`, automatico.toFixed(2), { shouldValidate: true });
  }, [vuelto, vueltoKey, setValue]);

  const onSubmit = async (data) => {
    if (Math.abs(vuelto - vueltoRegistrado) > 0.001) return notify.error("Registra el vuelto completo e indica cómo lo devolviste.");
    if (vuelto > 0 && data.pagos.filter((pago) => Number(pago.monto) > 0).length !== 1) return notify.error("Para registrar vuelto usa una sola forma de pago recibida.");
    let pendienteEfectivo = Math.max(total - totalNoEfectivo, 0);
    const pagosAplicados = data.pagos.map((pago) => {
      const recibido = Number(pago.monto) || 0;
      const monto = pago.metodoPago === "Efectivo" ? Math.min(recibido, pendienteEfectivo) : recibido;
      if (pago.metodoPago === "Efectivo") pendienteEfectivo -= monto;
      return { ...pago, monto, monto_recibido: recibido };
    }).filter((pago) => pago.monto > 0);
    setSaving(true);
    try {
      idempotencyKeyRef.current ||= crypto.randomUUID();
      await crearVenta({
      ...data, pagos: pagosAplicados,
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

  const abrirCorreccionFecha = (venta) => {
    setVentaFechaEditando(venta);
    setFechaCorregida(venta.fecha);
  };

  const guardarCorreccionFecha = async () => {
    if (!fechaCorregida) return notify.error("Indica la fecha correcta");
    setCorrigiendoFecha(true);
    try {
      await corregirFechaVenta(ventaFechaEditando.id, fechaCorregida, crypto.randomUUID());
      notify.success("Fecha de venta corregida");
      setVentaFechaEditando(null);
      cargarVentas();
    } catch (e) {
      notify.error(e);
    } finally {
      setCorrigiendoFecha(false);
    }
  };

  const openQuickClient = (name = "") => {
    setQuickClientName(name.trim());
    setQuickClientType("minorista");
    setQuickClientOpen(true);
  };

  const crearClienteRapido = async () => {
    const nombre = quickClientName.trim();
    if (!nombre) return notify.error("Ingresa el nombre del cliente");
    setCreatingClient(true);
    try {
      const creado = await crearCliente({ nombre, tipo: quickClientType });
      const nuevoCliente = { id: Number(creado.id), nombre, tipo: quickClientType };
      setClientes((actuales) => [...actuales, nuevoCliente].sort((a, b) => a.nombre.localeCompare(b.nombre)));
      setValue("cliente_id", nuevoCliente.id, { shouldValidate: true, shouldDirty: true });
      setQuickClientOpen(false);
      notify.success("Cliente creado y seleccionado para esta venta");
    } catch (e) {
      notify.error(e);
    } finally {
      setCreatingClient(false);
    }
  };

  const verVenta = async (venta) => {
    try {
      setVentaDetalle(await obtenerVenta(venta.id));
    } catch (e) {
      notify.error(e);
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
        puedeAnular && <Stack direction="row" justifyContent="flex-end" spacing={0.5}>
          <Tooltip title="Corregir fecha"><IconButton size="small" color="primary" onClick={() => abrirCorreccionFecha(r)}><EditIcon fontSize="small" /></IconButton></Tooltip>
          <Tooltip title="Anular venta"><IconButton size="small" color="error" onClick={() => setToAnular(r)}><BlockIcon fontSize="small" /></IconButton></Tooltip>
        </Stack>,
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
                      filterOptions={(options, state) => {
                        const texto = state.inputValue.trim();
                        const filtrados = options.filter((cliente) => cliente.nombre.toLowerCase().includes(texto.toLowerCase()));
                        const existe = options.some((cliente) => cliente.nombre.trim().toLowerCase() === texto.toLowerCase());
                        return texto && !existe ? [...filtrados, { inputValue: texto, crearRapido: true }] : filtrados;
                      }}
                      getOptionLabel={(o) => o.crearRapido ? `Crear cliente: ${o.inputValue}` : o.nombre || ""}
                      isOptionEqualToValue={(o, v) => o.id === v.id}
                      value={clientes.find((c) => c.id === field.value) || null}
                      onChange={(_, val) => {
                        if (val?.crearRapido) return openQuickClient(val.inputValue);
                        field.onChange(val?.id);
                      }}
                      renderOption={(props, option) => option.crearRapido ? (
                        <Box component="li" {...props} sx={{ color: "primary.main", fontWeight: 700 }}>
                          <AddIcon fontSize="small" sx={{ mr: 1 }} /> Crear cliente rápido: {option.inputValue}
                        </Box>
                      ) : <Box component="li" {...props}>{option.nombre}</Box>}
                      renderInput={(params) => (
                        <TextField {...params} label="Cliente" placeholder="Busca o escribe un cliente nuevo" error={!!errors.cliente_id} helperText={errors.cliente_id?.message} />
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
              Descuento (opcional)
            </Typography>
            <Grid container spacing={2} sx={{ mb: 1 }}>
              <Grid item xs={6} sm={4}>
                <Controller
                  name="descuento_tipo"
                  control={control}
                  render={({ field }) => (
                    <TextField select label="Tipo" fullWidth {...field}>
                      <MenuItem value="monto">Monto (S/)</MenuItem>
                      <MenuItem value="porcentaje">Porcentaje (%)</MenuItem>
                    </TextField>
                  )}
                />
              </Grid>
              <Grid item xs={6} sm={4}>
                <TextField
                  label={watchDescuentoTipo === "porcentaje" ? "Descuento (%)" : "Descuento (S/)"}
                  type="number"
                  fullWidth
                  inputProps={{ step: "0.01", min: "0" }}
                  {...register("descuento_valor")}
                  error={!!errors.descuento_valor}
                  helperText={errors.descuento_valor?.message}
                />
              </Grid>
            </Grid>

            <Divider sx={{ my: 3 }} />

            <Typography variant="subtitle2" sx={{ mb: 1.5 }}>
              Pagos (opcional — puedes dejarlo a crédito y cobrar después)
            </Typography>
            <Stack spacing={2}>
              {pagosArray.fields.map((field, index) => (
                <Grid container spacing={2} key={field.id} alignItems="center">
                  <Grid item xs={6} sm={4}>
                    <TextField
                      label={watchPagos?.[index]?.metodoPago === "Efectivo" ? "Efectivo recibido" : "Monto"}
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
                              .filter((cuenta) => cuentaCompatibleConMetodo(cuenta, watchPagos?.[index]?.metodoPago))
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
            {vuelto > 0 && <Box sx={{ mt: 2, p: 2, border: "1px solid", borderColor: "info.light", borderRadius: 1 }}><Typography variant="subtitle2" color="info.main">Vuelto pendiente: S/ {vuelto.toFixed(2)}</Typography><Typography variant="caption" color="text.secondary">Indica cómo devolviste el dinero. Puedes dividirlo entre efectivo, Yape u otros medios.</Typography><Stack spacing={2} sx={{ mt: 1.5 }}>{vueltosArray.fields.map((field, index) => <Grid container spacing={2} key={field.id} alignItems="center"><Grid item xs={5} sm={4}><TextField label="Monto devuelto" type="number" fullWidth InputLabelProps={{ shrink: true }} inputProps={{ step: "0.01", min: 0.01 }} {...register(`vueltos.${index}.monto`)} /></Grid><Grid item xs={5} sm={4}><Controller name={`vueltos.${index}.metodoPago`} control={control} render={({ field: f }) => <TextField select label="Devuelto por" fullWidth {...f}>{METODOS_PAGO.map((metodo) => <MenuItem key={metodo} value={metodo}>{metodo}</MenuItem>)}</TextField>} /></Grid>{watchVueltos?.[index]?.metodoPago !== "Efectivo" && <Grid item xs={11} sm={3}><Controller name={`vueltos.${index}.cuenta_financiera_id`} control={control} render={({ field: f }) => <TextField select label="Cuenta de salida" fullWidth {...f}>{cuentasFinancieras.filter((cuenta) => cuentaCompatibleConMetodo(cuenta, watchVueltos?.[index]?.metodoPago)).map((cuenta) => <MenuItem key={cuenta.id} value={cuenta.id}>{cuenta.nombre}</MenuItem>)}</TextField>} /></Grid>}<Grid item xs={1}><IconButton size="small" onClick={() => vueltosArray.remove(index)}><DeleteIcon fontSize="small" /></IconButton></Grid></Grid>)}</Stack><Button size="small" startIcon={<AddIcon />} onClick={() => vueltosArray.append({ monto: "", metodoPago: "Efectivo", cuenta_financiera_id: "" })} sx={{ mt: 1 }}>Agregar forma de vuelto</Button><Typography variant="caption" display="block" color={Math.abs(vuelto - vueltoRegistrado) < 0.001 ? "success.main" : "error.main"}>Registrado para devolver: S/ {vueltoRegistrado.toFixed(2)}</Typography></Box>}

            <Divider sx={{ my: 3 }} />

            <Stack direction="row" justifyContent="space-between" alignItems="center">
              <Box>
                <Typography variant="body2" color="text.secondary">
                  Subtotal: S/ {subtotal.toFixed(2)}
                  {descuentoMonto > 0 && <> · Descuento: -S/ {descuentoMonto.toFixed(2)}</>}
                  {" "}· <strong>Total: S/ {total.toFixed(2)}</strong> · Pagado: S/ {totalPagado.toFixed(2)} · Saldo:{" "}
                  <strong>S/ {Math.max(total - Math.min(totalPagado, total), 0).toFixed(2)}</strong>
                  {vuelto > 0 && <> · <strong style={{ color: "#1976d2" }}>Vuelto en efectivo: S/ {vuelto.toFixed(2)}</strong></>}
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
      <DataTable columns={columnsVentas} rows={ventas} loading={loadingVentas} searchPlaceholder="Buscar venta…" defaultOrderBy="fecha" onRowClick={verVenta} />

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
      <FormDialog open={!!ventaFechaEditando} onClose={() => !corrigiendoFecha && setVentaFechaEditando(null)} title="Corregir fecha de venta" maxWidth="xs" disableClose={corrigiendoFecha}>
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">La corrección conserva la trazabilidad: revierte la emisión anterior y crea una nueva con la fecha indicada. Si ya fue pagada, el cobro conserva su fecha real; por eso la fecha de venta no puede ser posterior al primer cobro.</Typography>
          <TextField label="Fecha correcta" type="date" fullWidth InputLabelProps={{ shrink: true }} value={fechaCorregida} onChange={(event) => setFechaCorregida(event.target.value)} />
          <Stack direction="row" justifyContent="flex-end" spacing={1}>
            <Button color="inherit" onClick={() => setVentaFechaEditando(null)} disabled={corrigiendoFecha}>Cancelar</Button>
            <Button variant="contained" onClick={guardarCorreccionFecha} disabled={corrigiendoFecha}>{corrigiendoFecha ? "Guardando…" : "Guardar fecha"}</Button>
          </Stack>
        </Stack>
      </FormDialog>
      <FormDialog open={quickClientOpen} onClose={() => !creatingClient && setQuickClientOpen(false)} title="Crear cliente rápido" maxWidth="xs" disableClose={creatingClient}>
        <Stack spacing={2.25}>
          <Typography variant="body2" color="text.secondary">Registra los datos mínimos y continúa con esta venta.</Typography>
          <TextField label="Nombre del cliente" fullWidth autoFocus value={quickClientName} onChange={(event) => setQuickClientName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); crearClienteRapido(); } }} />
          <TextField select label="Tipo de cliente" fullWidth value={quickClientType} onChange={(event) => setQuickClientType(event.target.value)}>
            <MenuItem value="minorista">Minorista</MenuItem>
            <MenuItem value="mayorista">Mayorista</MenuItem>
          </TextField>
          <Stack direction="row" justifyContent="flex-end" spacing={1.25}>
            <Button color="inherit" onClick={() => setQuickClientOpen(false)} disabled={creatingClient}>Cancelar</Button>
            <Button variant="contained" onClick={crearClienteRapido} disabled={creatingClient}>{creatingClient ? "Creando…" : "Crear y continuar"}</Button>
          </Stack>
        </Stack>
      </FormDialog>
      <FormDialog open={!!ventaDetalle} onClose={() => setVentaDetalle(null)} title={ventaDetalle ? `Venta ${ventaDetalle.folio}` : "Detalle de venta"} maxWidth="md">
        <Box component="pre" sx={{ m: 0, whiteSpace: "pre-wrap", fontSize: 12 }}>{JSON.stringify(ventaDetalle, null, 2)}</Box>
      </FormDialog>
    </Box>
  );
}
