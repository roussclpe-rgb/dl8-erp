import { useEffect, useState, useCallback } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Box, Grid, TextField, MenuItem, Button, Stack, IconButton, Tooltip, Alert } from "@mui/material";
import EditIcon from "@mui/icons-material/EditOutlined";

import PageHeader from "../components/PageHeader";
import DataTable from "../components/DataTable";
import FormDialog from "../components/FormDialog";
import { useAuth } from "../context/AuthContext";
import { useNotify } from "../hooks/useNotify";
import { formatoNumero, formatoFecha, fechaHoyISO } from "../utils/format";
import { listarProducciones, crearProduccion, editarProduccion, listarRecetas } from "../api/endpoints";

const schema = z.object({
  receta_id: z.coerce.number({ invalid_type_error: "Selecciona una receta" }).positive("Selecciona una receta"),
  tandas: z.coerce.number().positive("Debe ser mayor a 0"),
  fecha: z.string().min(1, "La fecha es obligatoria"),
});

const defaultValues = { receta_id: "", tandas: 1, fecha: fechaHoyISO() };

export default function ProduccionesPage() {
  const { hasRole } = useAuth();
  const notify = useNotify();
  const [rows, setRows] = useState([]);
  const [recetas, setRecetas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);

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
      const [prod, rec] = await Promise.all([listarProducciones(), listarRecetas()]);
      setRows(prod);
      setRecetas(rec);
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
    reset({ receta_id: row.receta_id, tandas: row.tandas, fecha: row.fecha });
    setDialogOpen(true);
  };

  const onSubmit = async (data) => {
    setSaving(true);
    try {
      if (editing) {
        await editarProduccion(editing.id, data);
        notify.success("Producción actualizada");
      } else {
        await crearProduccion(data);
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

  const puedeEscribir = hasRole("admin", "operador");

  const columns = [
    { field: "fecha", headerName: "Fecha", renderCell: (r) => formatoFecha(r.fecha) },
    { field: "nombre_producto", headerName: "Producto", minWidth: 160 },
    { field: "version", headerName: "Versión", align: "center" },
    { field: "tandas", headerName: "Tandas", align: "right" },
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

  return (
    <Box>
      <PageHeader
        title="Producciones"
        subtitle="Registra tandas producidas: descuenta materia prima FIFO y calcula el costo completo."
        actionLabel={puedeEscribir ? "Nueva producción" : null}
        onAction={abrirNuevo}
      />

      <DataTable columns={columns} rows={rows} loading={loading} searchPlaceholder="Buscar por producto…" defaultOrderBy="fecha" defaultOrder="desc" />

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
            <Grid item xs={6}>
              <TextField label="Tandas" type="number" fullWidth inputProps={{ step: "any" }} {...register("tandas")} error={!!errors.tandas} helperText={errors.tandas?.message} />
            </Grid>
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
    </Box>
  );
}
