import { useEffect, useState, useCallback } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Box, Grid, TextField, MenuItem, Button, Stack, IconButton, Tooltip, Divider, Typography } from "@mui/material";
import EditIcon from "@mui/icons-material/EditOutlined";
import DeleteIcon from "@mui/icons-material/DeleteOutline";

import PageHeader from "../components/PageHeader";
import DataTable from "../components/DataTable";
import FormDialog from "../components/FormDialog";
import ConfirmDialog from "../components/ConfirmDialog";
import StatusChip from "../components/StatusChip";
import { useAuth } from "../context/AuthContext";
import { useNotify } from "../hooks/useNotify";
import { formatoNumero } from "../utils/format";
import { listarIngredientes, crearIngrediente, editarIngrediente, eliminarIngrediente, estimarNutricionIngrediente } from "../api/endpoints";

const UNIDADES = ["g", "kg", "ml", "l", "unidad", "lb", "oz"];

const schema = z.object({
  nombre: z.string().min(1, "El nombre es obligatorio"),
  unidad_base: z.enum(UNIDADES, { errorMap: () => ({ message: "Selecciona una unidad válida" }) }),
  stock_minimo: z.coerce.number().min(0, "Debe ser 0 o mayor"),
  dias_cobertura_deseados: z.coerce.number().int().min(1, "Debe ser al menos 1 día"),
  calorias_por_100: z.coerce.number().min(0), proteinas_por_100: z.coerce.number().min(0), carbohidratos_por_100: z.coerce.number().min(0),
  grasas_por_100: z.coerce.number().min(0), fibra_por_100: z.coerce.number().min(0), sodio_por_100: z.coerce.number().min(0),
});

const defaultValues = { nombre: "", unidad_base: "g", stock_minimo: 0, dias_cobertura_deseados: 7, calorias_por_100: 0, proteinas_por_100: 0, carbohidratos_por_100: 0, grasas_por_100: 0, fibra_por_100: 0, sodio_por_100: 0 };

export default function IngredientesPage() {
  const { hasRole } = useAuth();
  const notify = useNotify();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [toDelete, setToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const {
    register,
    handleSubmit,
    control,
    reset,
    getValues,
    setValue,
    formState: { errors },
  } = useForm({ resolver: zodResolver(schema), defaultValues });

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await listarIngredientes());
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
      nombre: row.nombre,
      unidad_base: row.unidad_base,
      stock_minimo: row.stock_minimo,
      dias_cobertura_deseados: row.dias_cobertura_deseados,
      calorias_por_100: row.calorias_por_100, proteinas_por_100: row.proteinas_por_100, carbohidratos_por_100: row.carbohidratos_por_100,
      grasas_por_100: row.grasas_por_100, fibra_por_100: row.fibra_por_100, sodio_por_100: row.sodio_por_100,
    });
    setDialogOpen(true);
  };

  const onSubmit = async (data) => {
    setSaving(true);
    try {
      if (editing) {
        await editarIngrediente(editing.id, data);
        notify.success("Ingrediente actualizado");
      } else {
        await crearIngrediente(data);
        notify.success("Ingrediente creado");
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
      await eliminarIngrediente(toDelete.id);
      notify.success("Ingrediente desactivado");
      setToDelete(null);
      cargar();
    } catch (e) {
      notify.error(e);
    } finally {
      setDeleting(false);
    }
  };

  const completarNutricion = async () => {
    const nombre = getValues("nombre")?.trim();
    if (!nombre) return notify.error("Escribe primero el nombre del ingrediente");
    setSaving(true);
    try {
      const datos = await estimarNutricionIngrediente(nombre);
      for (const campo of ["calorias", "proteinas", "carbohidratos", "grasas", "fibra", "sodio"]) setValue(`${campo}_por_100`, datos[campo], { shouldValidate: true });
      notify.success(`Macros completados con valores de ${datos.referencia}`);
    } catch (e) { notify.error(e); } finally { setSaving(false); }
  };

  const puedeEscribir = hasRole("admin", "operador");
  const puedeEliminar = hasRole("admin");

  const columns = [
    { field: "nombre", headerName: "Nombre", minWidth: 180 },
    { field: "unidad_base", headerName: "Unidad" },
    { field: "stock", headerName: "Stock", align: "right", renderCell: (r) => formatoNumero(r.stock) },
    { field: "costoPromedio", headerName: "Costo promedio", align: "right", renderCell: (r) => formatoNumero(r.costoPromedio) },
    { field: "calorias_por_100", headerName: "kcal / 100", align: "right", renderCell: (r) => formatoNumero(r.calorias_por_100, 0) },
    { field: "stock_minimo", headerName: "Stock mínimo", align: "right", renderCell: (r) => formatoNumero(r.stock_minimo) },
    { field: "dias_cobertura_deseados", headerName: "Cobertura (días)", align: "right" },
    {
      field: "bajoMinimo",
      headerName: "Estado",
      align: "center",
      sortable: false,
      renderCell: (r) => (r.bajoMinimo ? <StatusChip label="Bajo mínimo" tone="error" /> : <StatusChip label="OK" tone="success" />),
    },
    {
      field: "acciones",
      headerName: "Acciones",
      align: "right",
      sortable: false,
      renderCell: (r) => (
        <Stack direction="row" spacing={0.5} justifyContent="flex-end">
          {puedeEscribir && (
            <Tooltip title="Editar">
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
        title="Ingredientes"
        subtitle="Catálogo de materia prima, stock y costo promedio."
        actionLabel={puedeEscribir ? "Nuevo ingrediente" : null}
        onAction={abrirNuevo}
      />

      <DataTable columns={columns} rows={rows} loading={loading} searchPlaceholder="Buscar ingrediente…" defaultOrderBy="nombre" />

      <FormDialog open={dialogOpen} onClose={() => setDialogOpen(false)} title={editing ? "Editar ingrediente" : "Nuevo ingrediente"}>
        <Box component="form" onSubmit={handleSubmit(onSubmit)} noValidate>
          <Grid container spacing={2}>
            <Grid item xs={12}>
              <TextField
                label="Nombre"
                fullWidth
                autoFocus
                {...register("nombre")}
                error={!!errors.nombre}
                helperText={errors.nombre?.message}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <Controller
                name="unidad_base"
                control={control}
                render={({ field }) => (
                  <TextField {...field} select label="Unidad base" fullWidth error={!!errors.unidad_base} helperText={errors.unidad_base?.message}>
                    {UNIDADES.map((u) => (
                      <MenuItem key={u} value={u}>
                        {u}
                      </MenuItem>
                    ))}
                  </TextField>
                )}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                label="Stock mínimo"
                type="number"
                fullWidth
                inputProps={{ step: "any" }}
                {...register("stock_minimo")}
                error={!!errors.stock_minimo}
                helperText={errors.stock_minimo?.message}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                label="Días de cobertura deseados"
                type="number"
                fullWidth
                {...register("dias_cobertura_deseados")}
                error={!!errors.dias_cobertura_deseados}
                helperText={errors.dias_cobertura_deseados?.message}
              />
            </Grid>
            <Grid item xs={12}>
              <Divider sx={{ my: 0.5 }} />
              <Typography variant="subtitle2" sx={{ mt: 2 }}>Información nutricional</Typography>
              <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
                <Typography variant="caption" color="text.secondary">Valores por cada 100 unidades de la unidad base. Sodio en mg; los demás nutrientes en g.</Typography>
                <Button size="small" variant="outlined" onClick={completarNutricion} disabled={saving}>Completar automáticamente</Button>
              </Stack>
            </Grid>
            {[["calorias_por_100", "Calorías (kcal)"], ["proteinas_por_100", "Proteínas (g)"], ["carbohidratos_por_100", "Carbohidratos (g)"], ["grasas_por_100", "Grasas totales (g)"], ["fibra_por_100", "Fibra (g)"], ["sodio_por_100", "Sodio (mg)"]].map(([name, label]) => (
              <Grid item xs={6} sm={4} key={name}><TextField label={label} type="number" fullWidth inputProps={{ step: "any", min: 0 }} {...register(name)} error={!!errors[name]} helperText={errors[name]?.message} /></Grid>
            ))}
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

      <ConfirmDialog
        open={!!toDelete}
        title="Desactivar ingrediente"
        message={`¿Desactivar "${toDelete?.nombre}"? No podrá usarse en nuevas compras ni recetas.`}
        confirmText="Desactivar"
        danger
        loading={deleting}
        onClose={() => setToDelete(null)}
        onConfirm={confirmarEliminar}
      />
    </Box>
  );
}
