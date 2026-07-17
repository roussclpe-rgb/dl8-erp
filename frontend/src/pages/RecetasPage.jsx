import { useEffect, useState, useCallback } from "react";
import { useForm, Controller, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Box,
  Grid,
  TextField,
  MenuItem,
  Button,
  Stack,
  IconButton,
  Tooltip,
  Typography,
  Divider,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
} from "@mui/material";
import EditIcon from "@mui/icons-material/EditOutlined";
import DeleteIcon from "@mui/icons-material/DeleteOutline";
import AddIcon from "@mui/icons-material/Add";
import HistoryIcon from "@mui/icons-material/HistoryOutlined";
import NutritionIcon from "@mui/icons-material/MonitorHeartOutlined";

import PageHeader from "../components/PageHeader";
import DataTable from "../components/DataTable";
import FormDialog from "../components/FormDialog";
import ConfirmDialog from "../components/ConfirmDialog";
import StatusChip from "../components/StatusChip";
import { useAuth } from "../context/AuthContext";
import { useNotify } from "../hooks/useNotify";
import { formatoNumero, formatoFecha } from "../utils/format";
import { listarRecetas, crearReceta, editarReceta, eliminarReceta, historialReceta, listarIngredientes } from "../api/endpoints";

const schema = z.object({
  nombre_producto: z.string().min(1, "El nombre es obligatorio"),
  rendimiento: z.coerce.number().positive("Debe ser mayor a 0"),
  minutos_mano_obra: z.coerce.number().min(0, "Debe ser 0 o mayor"),
  items: z
    .array(
      z.object({
        ingrediente_id: z.coerce.number({ invalid_type_error: "Selecciona un ingrediente" }).positive("Selecciona un ingrediente"),
        cantidad_base: z.coerce.number().positive("Debe ser mayor a 0"),
      })
    )
    .min(1, "Agrega al menos un ingrediente"),
});

const defaultValues = { nombre_producto: "", rendimiento: "", minutos_mano_obra: 0, items: [{ ingrediente_id: "", cantidad_base: "" }] };

export default function RecetasPage() {
  const { hasRole } = useAuth();
  const notify = useNotify();
  const [rows, setRows] = useState([]);
  const [ingredientes, setIngredientes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [toDelete, setToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [historial, setHistorial] = useState(null);
  const [historialItems, setHistorialItems] = useState([]);
  const [nutricionReceta, setNutricionReceta] = useState(null);

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors },
  } = useForm({ resolver: zodResolver(schema), defaultValues });

  const { fields, append, remove } = useFieldArray({ control, name: "items" });

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const [rec, ing] = await Promise.all([listarRecetas(), listarIngredientes()]);
      setRows(rec);
      setIngredientes(ing);
    } catch (e) {
      notify.error(e);
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const abrirNuevo = () => {
    setEditing(null);
    reset(defaultValues);
    setDialogOpen(true);
  };

  const abrirEditar = (row) => {
    setEditing(row);
    reset({
      nombre_producto: row.nombre_producto,
      rendimiento: row.rendimiento,
      minutos_mano_obra: row.minutos_mano_obra,
      items: row.items.map((it) => ({ ingrediente_id: it.ingrediente_id, cantidad_base: it.cantidad_base })),
    });
    setDialogOpen(true);
  };

  const onSubmit = async (data) => {
    setSaving(true);
    try {
      if (editing) {
        await editarReceta(editing.id, data);
        notify.success("Nueva versión de la receta guardada");
      } else {
        await crearReceta(data);
        notify.success("Receta creada");
      }
      setDialogOpen(false);
      cargar();
    } catch (e) {
      notify.error(e);
    } finally {
      setSaving(false);
    }
  };

  const confirmarEliminar = async () => {
    setDeleting(true);
    try {
      await eliminarReceta(toDelete.id);
      notify.success("Receta desactivada");
      setToDelete(null);
      cargar();
    } catch (e) {
      notify.error(e);
    } finally {
      setDeleting(false);
    }
  };

  const abrirHistorial = async (row) => {
    setHistorial(row);
    try {
      setHistorialItems(await historialReceta(row.id));
    } catch (e) {
      notify.error(e);
    }
  };

  const puedeEscribir = hasRole("admin", "operador");
  const puedeEliminar = hasRole("admin");

  const columns = [
    { field: "nombre_producto", headerName: "Producto", minWidth: 180 },
    { field: "version", headerName: "Versión", align: "center" },
    { field: "rendimiento", headerName: "Rendimiento", align: "right" },
    { field: "minutos_mano_obra", headerName: "Min. mano de obra", align: "right" },
    { field: "costoMateriaPrima", headerName: "Costo M.P.", align: "right", renderCell: (r) => formatoNumero(r.costoMateriaPrima) },
    { field: "costoManoObra", headerName: "Costo M.O.", align: "right", renderCell: (r) => formatoNumero(r.costoManoObra) },
    { field: "calorias", headerName: "kcal / unidad", align: "right", renderCell: (r) => formatoNumero(r.nutricion?.porUnidad?.calorias, 0) },
    {
      field: "incompleto",
      headerName: "Estado",
      align: "center",
      sortable: false,
      renderCell: (r) => (r.incompleto ? <StatusChip label="Stock insuficiente" tone="warning" /> : <StatusChip label="OK" tone="success" />),
    },
    {
      field: "acciones",
      headerName: "Acciones",
      align: "right",
      sortable: false,
      renderCell: (r) => (
        <Stack direction="row" spacing={0.5} justifyContent="flex-end">
          <Tooltip title="Tabla nutricional">
            <IconButton size="small" color="primary" onClick={() => setNutricionReceta(r)}><NutritionIcon fontSize="small" /></IconButton>
          </Tooltip>
          <Tooltip title="Historial de versiones">
            <IconButton size="small" onClick={() => abrirHistorial(r)}>
              <HistoryIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          {puedeEscribir && (
            <Tooltip title="Editar (nueva versión)">
              <IconButton size="small" onClick={() => abrirEditar(r)}>
                <EditIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
          {puedeEliminar && (
            <Tooltip title="Desactivar">
              <IconButton size="small" color="error" onClick={() => setToDelete(r)}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
        </Stack>
      ),
    },
  ];

  return (
    <Box>
      <PageHeader
        title="Recetas"
        subtitle="Recetas versionadas: editar crea una versión nueva sin alterar el costo histórico."
        actionLabel={puedeEscribir ? "Nueva receta" : null}
        onAction={abrirNuevo}
      />

      <DataTable columns={columns} rows={rows} loading={loading} searchPlaceholder="Buscar receta…" defaultOrderBy="nombre_producto" />

      <FormDialog open={dialogOpen} onClose={() => setDialogOpen(false)} title={editing ? `Editar receta — ${editing.nombre_producto}` : "Nueva receta"} maxWidth="md">
        <Box component="form" onSubmit={handleSubmit(onSubmit)} noValidate>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6}>
              <TextField label="Nombre del producto" fullWidth autoFocus {...register("nombre_producto")} error={!!errors.nombre_producto} helperText={errors.nombre_producto?.message} />
            </Grid>
            <Grid item xs={6} sm={3}>
              <TextField label="Rendimiento (unidades)" type="number" fullWidth {...register("rendimiento")} error={!!errors.rendimiento} helperText={errors.rendimiento?.message} />
            </Grid>
            <Grid item xs={6} sm={3}>
              <TextField label="Min. mano de obra" type="number" fullWidth {...register("minutos_mano_obra")} error={!!errors.minutos_mano_obra} helperText={errors.minutos_mano_obra?.message} />
            </Grid>
          </Grid>

          <Divider sx={{ my: 2.5 }} />
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
            <Typography variant="subtitle2">Ingredientes de la receta</Typography>
            <Button size="small" startIcon={<AddIcon />} onClick={() => append({ ingrediente_id: "", cantidad_base: "" })}>
              Agregar ingrediente
            </Button>
          </Stack>
          {errors.items?.message && (
            <Typography variant="caption" color="error">
              {errors.items.message}
            </Typography>
          )}

          <Stack spacing={1.5} sx={{ mt: 1 }}>
            {fields.map((field, index) => (
              <Grid container spacing={1.5} key={field.id} alignItems="center">
                <Grid item xs={12} sm={7}>
                  <Controller
                    name={`items.${index}.ingrediente_id`}
                    control={control}
                    render={({ field: f }) => (
                      <TextField
                        {...f}
                        select
                        label="Ingrediente"
                        fullWidth
                        size="small"
                        error={!!errors.items?.[index]?.ingrediente_id}
                        helperText={errors.items?.[index]?.ingrediente_id?.message}
                      >
                        <MenuItem value="">Selecciona…</MenuItem>
                        {ingredientes.map((i) => (
                          <MenuItem key={i.id} value={i.id}>
                            {i.nombre} ({i.unidad_base})
                          </MenuItem>
                        ))}
                      </TextField>
                    )}
                  />
                </Grid>
                <Grid item xs={9} sm={4}>
                  <TextField
                    label="Cantidad (unidad base)"
                    type="number"
                    size="small"
                    fullWidth
                    inputProps={{ step: "any" }}
                    {...register(`items.${index}.cantidad_base`)}
                    error={!!errors.items?.[index]?.cantidad_base}
                    helperText={errors.items?.[index]?.cantidad_base?.message}
                  />
                </Grid>
                <Grid item xs={3} sm={1}>
                  <IconButton onClick={() => remove(index)} disabled={fields.length === 1} color="error">
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Grid>
              </Grid>
            ))}
          </Stack>

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

      <FormDialog open={!!historial} onClose={() => setHistorial(null)} title={`Historial — ${historial?.nombre_producto || ""}`} maxWidth="sm">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Versión</TableCell>
              <TableCell>Rendimiento</TableCell>
              <TableCell>Vigente</TableCell>
              <TableCell>Creada</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {historialItems.map((h) => (
              <TableRow key={h.id}>
                <TableCell>v{h.version}</TableCell>
                <TableCell>{h.rendimiento}</TableCell>
                <TableCell>{h.vigente ? <StatusChip label="Vigente" tone="success" /> : <StatusChip label="Anterior" tone="default" />}</TableCell>
                <TableCell>{formatoFecha(h.creado_en)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </FormDialog>

      <FormDialog open={!!nutricionReceta} onClose={() => setNutricionReceta(null)} title={`Tabla nutricional — ${nutricionReceta?.nombre_producto || ""}`} maxWidth="sm">
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>Valores estimados por unidad producida. La receta rinde {formatoNumero(nutricionReceta?.rendimiento)} unidades.</Typography>
        <Table size="small">
          <TableHead><TableRow><TableCell>Nutriente</TableCell><TableCell align="right">Por unidad</TableCell><TableCell align="right">Receta completa</TableCell></TableRow></TableHead>
          <TableBody>
            {[["Calorías", "calorias", "kcal"], ["Proteínas", "proteinas", "g"], ["Carbohidratos", "carbohidratos", "g"], ["Grasas totales", "grasas", "g"], ["Fibra", "fibra", "g"], ["Sodio", "sodio", "mg"]].map(([label, field, unit]) => (
              <TableRow key={field}><TableCell>{label}</TableCell><TableCell align="right">{formatoNumero(nutricionReceta?.nutricion?.porUnidad?.[field])} {unit}</TableCell><TableCell align="right">{formatoNumero(nutricionReceta?.nutricion?.total?.[field])} {unit}</TableCell></TableRow>
            ))}
          </TableBody>
        </Table>
      </FormDialog>

      <ConfirmDialog
        open={!!toDelete}
        title="Desactivar receta"
        message={`¿Desactivar "${toDelete?.nombre_producto}"? Si tiene producciones históricas, solo se desactivará (no se borra).`}
        confirmText="Desactivar"
        danger
        loading={deleting}
        onClose={() => setToDelete(null)}
        onConfirm={confirmarEliminar}
      />
    </Box>
  );
}
