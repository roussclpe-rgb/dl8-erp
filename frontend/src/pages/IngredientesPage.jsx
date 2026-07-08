import { useEffect, useState, useCallback } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Box, Grid, TextField, MenuItem, Button, Stack, IconButton, Tooltip } from "@mui/material";
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
import { listarIngredientes, crearIngrediente, editarIngrediente, eliminarIngrediente } from "../api/endpoints";

const UNIDADES = ["g", "kg", "ml", "l", "unidad", "lb", "oz"];

const schema = z.object({
  nombre: z.string().min(1, "El nombre es obligatorio"),
  unidad_base: z.enum(UNIDADES, { errorMap: () => ({ message: "Selecciona una unidad válida" }) }),
  stock_minimo: z.coerce.number().min(0, "Debe ser 0 o mayor"),
  dias_cobertura_deseados: z.coerce.number().int().min(1, "Debe ser al menos 1 día"),
});

const defaultValues = { nombre: "", unidad_base: "g", stock_minimo: 0, dias_cobertura_deseados: 7 };

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

  const puedeEscribir = hasRole("admin", "operador");
  const puedeEliminar = hasRole("admin");

  const columns = [
    { field: "nombre", headerName: "Nombre", minWidth: 180 },
    { field: "unidad_base", headerName: "Unidad" },
    { field: "stock", headerName: "Stock", align: "right", renderCell: (r) => formatoNumero(r.stock) },
    { field: "costoPromedio", headerName: "Costo promedio", align: "right", renderCell: (r) => formatoNumero(r.costoPromedio) },
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
