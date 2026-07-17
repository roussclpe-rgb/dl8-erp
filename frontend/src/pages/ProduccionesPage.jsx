import { useEffect, useState, useCallback } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Box, Grid, TextField, MenuItem, Button, Stack, IconButton, Tooltip, Alert,
  ToggleButtonGroup, ToggleButton, Typography, Divider,
} from "@mui/material";
import EditIcon from "@mui/icons-material/EditOutlined";

import PageHeader from "../components/PageHeader";
import DataTable from "../components/DataTable";
import FormDialog from "../components/FormDialog";
import { useAuth } from "../context/AuthContext";
import { useNotify } from "../hooks/useNotify";
import { formatoNumero, formatoFecha, fechaHoyISO } from "../utils/format";
import { listarProducciones, crearProduccion, editarProduccion, listarRecetas, crearExistenciaProducto, factibilidadProduccion, generarListaCompraFaltantes } from "../api/endpoints";

const schema = z.object({
  receta_id: z.coerce.number({ invalid_type_error: "Selecciona una receta" }).positive("Selecciona una receta"),
  tandas: z.coerce.number().positive("Debe ser mayor a 0"),
  fecha: z.string().min(1, "La fecha es obligatoria"),
});

const defaultValues = { receta_id: "", tandas: 1, fecha: fechaHoyISO() };
const stockExistenteSchema = z.object({
  grupo_receta_id: z.coerce.number({ invalid_type_error: "Selecciona un producto" }).positive("Selecciona un producto"),
  cantidad: z.coerce.number().positive("Debe ser mayor a 0"),
  fecha: z.string().min(1, "La fecha es obligatoria"),
  motivo: z.string().optional(),
});
const stockExistenteDefaultValues = { grupo_receta_id: "", cantidad: "", fecha: fechaHoyISO(), motivo: "Stock que ya tenía" };

export default function ProduccionesPage() {
  const { hasRole } = useAuth();
  const notify = useNotify();
  const [rows, setRows] = useState([]);
  const [recetas, setRecetas] = useState([]);
  const [factibilidad, setFactibilidad] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [stockExistenteOpen, setStockExistenteOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);

  const [modoCantidad, setModoCantidad] = useState("tandas");
  const [unidadesDeseadas, setUnidadesDeseadas] = useState("");

  const {
    register, handleSubmit, control, reset, watch, setValue,
    formState: { errors },
  } = useForm({ resolver: zodResolver(schema), defaultValues });
  const {
    register: registerStockExistente, handleSubmit: handleSubmitStockExistente,
    control: controlStockExistente, reset: resetStockExistente,
    formState: { errors: errorsStockExistente },
  } = useForm({ resolver: zodResolver(stockExistenteSchema), defaultValues: stockExistenteDefaultValues });

  const recetaId = watch("receta_id");
  const tandasValue = watch("tandas");
  const recetaSeleccionada = recetas.find((r) => r.id === recetaId);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const [prod, rec, fact] = await Promise.all([listarProducciones(), listarRecetas(), factibilidadProduccion()]);
      setRows(prod);
      setRecetas(rec);
      setFactibilidad(fact);
    } catch (e) {
      notify.error(e);
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  // Calculo puro: no depende de "tandas" ni de nada que el propio calculo
  // modifique, asi que no puede haber retroalimentacion ni doble division.
  const calcularTandasDesdeUnidades = (unidades, receta) => {
    const n = Number(unidades);
    if (!receta || !unidades || !Number.isFinite(n) || n <= 0) return 0;
    return n / receta.rendimiento;
  };

  // Se ejecuta solo en el evento de escritura, nunca en un efecto reactivo.
  const handleUnidadesChange = (e) => {
    const valorTecleado = e.target.value;
    setUnidadesDeseadas(valorTecleado);
    const tandas = calcularTandasDesdeUnidades(valorTecleado, recetaSeleccionada);
    setValue("tandas", tandas, { shouldValidate: true });
  };

  const cambiarModo = (_, val) => {
    if (!val) return;
    setModoCantidad(val);
    if (val === "unidades") {
      setUnidadesDeseadas("");
      setValue("tandas", 0, { shouldValidate: false });
    } else {
      setValue("tandas", 1, { shouldValidate: false });
    }
  };

  const abrirNuevo = () => {
    setEditing(null);
    reset(defaultValues);
    setModoCantidad("tandas");
    setUnidadesDeseadas("");
    setDialogOpen(true);
  };

  const abrirEditar = (row) => {
    setEditing(row);
    reset({ receta_id: row.receta_id, tandas: row.tandas, fecha: row.fecha });
    setModoCantidad("tandas");
    setUnidadesDeseadas("");
    setDialogOpen(true);
  };

  const onSubmit = async (data) => {
    setSaving(true);
    try {
      if (editing) {
        await editarProduccion(editing.id, data);
        notify.success("Producción actualizada");
      } else {
        await crearProduccion({ ...data, modo: modoCantidad, unidades: modoCantidad === "unidades" ? Number(unidadesDeseadas) : undefined });
        notify.success("Producción registrada y stock descontado");
      }
      setDialogOpen(false);
      cargar();
    } catch (e) {
      notify.error(e);
    } finally {
      setSaving(false);
    }
  };

  const abrirStockExistente = () => {
    resetStockExistente(stockExistenteDefaultValues);
    setStockExistenteOpen(true);
  };

  const onSubmitStockExistente = async (data) => {
    setSaving(true);
    try {
      await crearExistenciaProducto(data);
      notify.success("Stock existente registrado sin consumir ingredientes");
      setStockExistenteOpen(false);
    } catch (e) {
      notify.error(e);
    } finally {
      setSaving(false);
    }
  };

  const generarListaCompra = async () => {
    setSaving(true);
    try {
      const lista = await generarListaCompraFaltantes();
      notify.success(lista.items.length ? `Lista de compra creada con ${lista.items.length} ingrediente(s).` : "No hay faltantes para agregar a la lista.");
    } catch (e) { notify.error(e); } finally { setSaving(false); }
  };

  const puedeEscribir = hasRole("admin", "operador");

  const columns = [
    { field: "fecha", headerName: "Fecha", renderCell: (r) => formatoFecha(r.fecha) },
    { field: "nombre_producto", headerName: "Producto", minWidth: 160 },
    { field: "version", headerName: "Versión", align: "center" },
    { field: "tandas", headerName: "Tandas", align: "right", renderCell: (r) => formatoNumero(r.tandas, 3) },
    { field: "unidades_producidas", headerName: "Unidades", align: "right", renderCell: (r) => formatoNumero(r.unidades_producidas) },
    { field: "costo_total", headerName: "Costo total", align: "right", renderCell: (r) => formatoNumero(r.costo_total) },
    { field: "costo_unidad", headerName: "Costo/unidad", align: "right", renderCell: (r) => formatoNumero(r.costo_unidad, 4) },
    {
      field: "acciones",
      headerName: "Acciones",
      align: "right",
      sortable: false,
      renderCell: (r) =>
        puedeEscribir ? (
          <Tooltip title="Editar (revierte y recalcula)">
            <IconButton size="small" onClick={() => abrirEditar(r)}>
              <EditIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        ) : null,
    },
  ];

  const unidadesEquivalentes =
    recetaSeleccionada && tandasValue ? formatoNumero(recetaSeleccionada.rendimiento * Number(tandasValue)) : null;
  const columnasFactibilidad = [
    { field: "receta", headerName: "Receta", minWidth: 170 },
    { field: "tandas_posibles", headerName: "Tandas posibles", align: "right" },
    { field: "unidades_posibles", headerName: "Unidades posibles", align: "right", renderCell: (r) => formatoNumero(r.unidades_posibles) },
    { field: "estado", headerName: "Estado", renderCell: (r) => r.estado === "disponible" ? "Disponible" : "Stock insuficiente" },
    { field: "ingrediente_limitante", headerName: "Ingrediente limitante", minWidth: 170, renderCell: (r) => r.ingrediente_limitante?.nombre || "—" },
    { field: "faltantes", headerName: "Faltantes para la siguiente tanda", minWidth: 250, renderCell: (r) => r.faltantes.length ? r.faltantes.map((item) => `${formatoNumero(item.cantidad_base)} ${item.unidad_base} de ${item.nombre}`).join(", ") : "—" },
  ];

  return (
    <Box>
      <PageHeader
        title="Producciones"
        subtitle="Registra tandas producidas: descuenta materia prima FIFO y calcula el costo completo."
        actionLabel={puedeEscribir ? "Nueva producción" : null}
        onAction={abrirNuevo}
        extra={puedeEscribir ? <Button variant="outlined" onClick={abrirStockExistente}>Registrar stock existente</Button> : null}
      />

      <DataTable columns={columns} rows={rows} loading={loading} searchPlaceholder="Buscar por producto…" defaultOrderBy="fecha" defaultOrder="desc" />

      <Divider sx={{ my: 4 }} />
      <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" alignItems={{ sm: "center" }} spacing={1} sx={{ mb: 2 }}>
        <Box><Typography variant="h6">Faltantes para producir</Typography><Typography variant="body2" color="text.secondary">Factibilidad calculada con el stock FIFO actual y las cantidades base ya convertidas de cada receta.</Typography></Box>
        {puedeEscribir && <Button variant="contained" onClick={generarListaCompra} disabled={saving || !factibilidad.some((item) => item.estado === "stock_insuficiente")}>Generar lista de compra</Button>}
      </Stack>
      <DataTable columns={columnasFactibilidad} rows={factibilidad} loading={loading} searchPlaceholder="Buscar receta…" defaultOrderBy="receta" />

      <FormDialog open={dialogOpen} onClose={() => setDialogOpen(false)} title={editing ? "Editar producción" : "Nueva producción"}>
        <Box component="form" onSubmit={handleSubmit(onSubmit)} noValidate>
          {editing && (
            <Alert severity="info" sx={{ mb: 2 }}>
              Editar revierte el consumo de materia prima de la versión anterior y registra una nueva con los datos actualizados.
            </Alert>
          )}
          <Grid container spacing={2}>
            <Grid item xs={12}>
              <Controller
                name="receta_id"
                control={control}
                render={({ field }) => (
                  <TextField {...field} select label="Receta" fullWidth error={!!errors.receta_id} helperText={errors.receta_id?.message}>
                    <MenuItem value="">Selecciona…</MenuItem>
                    {recetas.map((r) => (
                      <MenuItem key={r.id} value={r.id}>
                        {r.nombre_producto} (v{r.version}) — rinde {r.rendimiento}
                      </MenuItem>
                    ))}
                  </TextField>
                )}
              />
            </Grid>

            <Grid item xs={12}>
              <ToggleButtonGroup value={modoCantidad} exclusive size="small" onChange={cambiarModo}>
                <ToggleButton value="tandas">Por tandas</ToggleButton>
                <ToggleButton value="unidades">Por unidades a producir</ToggleButton>
              </ToggleButtonGroup>
            </Grid>

            {modoCantidad === "tandas" ? (
              <Grid item xs={6}>
                <TextField
                  label="Tandas"
                  type="number"
                  fullWidth
                  inputProps={{ step: "any" }}
                  {...register("tandas")}
                  error={!!errors.tandas}
                  helperText={errors.tandas?.message || (unidadesEquivalentes ? `Equivale a ${unidadesEquivalentes} unidades` : " ")}
                />
              </Grid>
            ) : (
              <Grid item xs={6}>
                <TextField
                  label="Unidades a producir"
                  type="number"
                  fullWidth
                  disabled={!recetaSeleccionada}
                  inputProps={{ step: "any" }}
                  value={unidadesDeseadas}
                  onChange={handleUnidadesChange}
                  error={!!errors.tandas}
                  helperText={
                    errors.tandas?.message ||
                    (!recetaSeleccionada ? "Selecciona primero una receta" : `Equivale a ${formatoNumero(Number(tandasValue) || 0, 3)} tandas`)
                  }
                />
              </Grid>
            )}

            <Grid item xs={6}>
              <TextField
                label="Fecha"
                type="date"
                fullWidth
                InputLabelProps={{ shrink: true }}
                {...register("fecha")}
                error={!!errors.fecha}
                helperText={errors.fecha?.message}
              />
            </Grid>
          </Grid>
          <Stack direction="row" justifyContent="flex-end" spacing={1.5} sx={{ mt: 3 }}>
            <Button onClick={() => setDialogOpen(false)} color="inherit">
              Cancelar
            </Button>
            <Button type="submit" variant="contained" disabled={saving}>
              {saving ? "Guardando…" : "Guardar"}
            </Button>
          </Stack>
        </Box>
      </FormDialog>

      <FormDialog open={stockExistenteOpen} onClose={() => setStockExistenteOpen(false)} title="Registrar stock ya existente">
        <Box component="form" onSubmit={handleSubmitStockExistente(onSubmitStockExistente)} noValidate>
          <Alert severity="info" sx={{ mb: 2 }}>
            Estas unidades se podrán vender o mermar, sin crear producción ni descontar ingredientes.
          </Alert>
          <Grid container spacing={2}>
            <Grid item xs={12}>
              <Controller name="grupo_receta_id" control={controlStockExistente} render={({ field }) => (
                <TextField {...field} select label="Producto" fullWidth error={!!errorsStockExistente.grupo_receta_id} helperText={errorsStockExistente.grupo_receta_id?.message}>
                  <MenuItem value="">Selecciona…</MenuItem>
                  {recetas.map((r) => <MenuItem key={r.grupo_id} value={r.grupo_id}>{r.nombre_producto}</MenuItem>)}
                </TextField>
              )} />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField label="Unidades existentes" type="number" fullWidth inputProps={{ step: "any" }} {...registerStockExistente("cantidad")} error={!!errorsStockExistente.cantidad} helperText={errorsStockExistente.cantidad?.message} />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField label="Fecha" type="date" fullWidth InputLabelProps={{ shrink: true }} {...registerStockExistente("fecha")} error={!!errorsStockExistente.fecha} helperText={errorsStockExistente.fecha?.message} />
            </Grid>
            <Grid item xs={12}>
              <TextField label="Nota" fullWidth {...registerStockExistente("motivo")} />
            </Grid>
          </Grid>
          <Stack direction="row" justifyContent="flex-end" spacing={1.5} sx={{ mt: 3 }}>
            <Button onClick={() => setStockExistenteOpen(false)} color="inherit">Cancelar</Button>
            <Button type="submit" variant="contained" disabled={saving}>{saving ? "Guardando…" : "Registrar stock"}</Button>
          </Stack>
        </Box>
      </FormDialog>
    </Box>
  );
}
