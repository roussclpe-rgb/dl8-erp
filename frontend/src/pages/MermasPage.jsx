import { useEffect, useState, useCallback } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Box, Grid, TextField, MenuItem, Button, Stack, Alert } from "@mui/material";

import PageHeader from "../components/PageHeader";
import DataTable from "../components/DataTable";
import FormDialog from "../components/FormDialog";
import { useAuth } from "../context/AuthContext";
import { useNotify } from "../hooks/useNotify";
import { formatoNumero, formatoFecha, fechaHoyISO } from "../utils/format";
import { listarMermas, crearMerma, stockProducto, listarRecetas } from "../api/endpoints";

const schema = z.object({
  grupo_receta_id: z.coerce.number({ invalid_type_error: "Selecciona un producto" }).positive("Selecciona un producto"),
  cantidad: z.coerce.number().positive("Debe ser mayor a 0"),
  motivo: z.string().min(1, "El motivo es obligatorio"),
  fecha: z.string().min(1, "La fecha es obligatoria"),
});

const defaultValues = { grupo_receta_id: "", cantidad: "", motivo: "", fecha: fechaHoyISO() };

export default function MermasPage() {
  const { hasRole } = useAuth();
  const notify = useNotify();
  const [rows, setRows] = useState([]);
  const [recetas, setRecetas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [stockDisponible, setStockDisponible] = useState(null);

  const {
    register,
    handleSubmit,
    control,
    reset,
    watch,
    formState: { errors },
  } = useForm({ resolver: zodResolver(schema), defaultValues });

  const grupoRecetaId = watch("grupo_receta_id");

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const [mer, rec] = await Promise.all([listarMermas(), listarRecetas()]);
      setRows(mer);
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

  useEffect(() => {
    if (!grupoRecetaId) {
      setStockDisponible(null);
      return;
    }
    stockProducto(grupoRecetaId)
      .then(setStockDisponible)
      .catch(() => setStockDisponible(null));
  }, [grupoRecetaId]);

  const abrirNuevo = () => {
    reset(defaultValues);
    setStockDisponible(null);
    setDialogOpen(true);
  };

  const onSubmit = async (data) => {
    setSaving(true);
    try {
      await crearMerma(data);
      notify.success("Merma registrada");
      setDialogOpen(false);
      cargar();
    } catch (e) {
      notify.error(e);
    } finally {
      setSaving(false);
    }
  };

  const puedeEscribir = hasRole("admin", "operador");

  const nombrePorGrupo = (grupoId) => recetas.find((r) => r.grupo_id === grupoId)?.nombre_producto || `Grupo #${grupoId}`;

  const columns = [
    { field: "fecha", headerName: "Fecha", renderCell: (r) => formatoFecha(r.fecha) },
    { field: "grupo_receta_id", headerName: "Producto", renderCell: (r) => nombrePorGrupo(r.grupo_receta_id) },
    { field: "cantidad", headerName: "Cantidad", align: "right", renderCell: (r) => formatoNumero(r.cantidad) },
    { field: "motivo", headerName: "Motivo", minWidth: 200 },
    { field: "usuario_nombre", headerName: "Registrado por" },
  ];

  return (
    <Box>
      <PageHeader
        title="Mermas de producto terminado"
        subtitle="Producto ya horneado que se pierde, se rompe o caduca."
        actionLabel={puedeEscribir ? "Nueva merma" : null}
        onAction={abrirNuevo}
      />

      <DataTable columns={columns} rows={rows} loading={loading} searchPlaceholder="Buscar por motivo…" defaultOrderBy="fecha" defaultOrder="desc" />

      <FormDialog open={dialogOpen} onClose={() => setDialogOpen(false)} title="Nueva merma de producto">
        <Box component="form" onSubmit={handleSubmit(onSubmit)} noValidate>
          <Grid container spacing={2}>
            <Grid item xs={12}>
              <Controller
                name="grupo_receta_id"
                control={control}
                render={({ field }) => (
                  <TextField {...field} select label="Producto (receta)" fullWidth error={!!errors.grupo_receta_id} helperText={errors.grupo_receta_id?.message}>
                    <MenuItem value="">Selecciona…</MenuItem>
                    {recetas.map((r) => (
                      <MenuItem key={r.grupo_id} value={r.grupo_id}>
                        {r.nombre_producto}
                      </MenuItem>
                    ))}
                  </TextField>
                )}
              />
            </Grid>
            {stockDisponible && (
              <Grid item xs={12}>
                <Alert severity="info">
                  Stock disponible de producto terminado: <strong>{formatoNumero(stockDisponible.stock)}</strong> unidades
                  (producido {formatoNumero(stockDisponible.producido)}, mermado {formatoNumero(stockDisponible.mermado)}).
                </Alert>
              </Grid>
            )}
            <Grid item xs={12} sm={6}>
              <TextField
                label="Cantidad"
                type="number"
                fullWidth
                inputProps={{ step: "any" }}
                {...register("cantidad")}
                error={!!errors.cantidad}
                helperText={errors.cantidad?.message}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
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
            <Grid item xs={12}>
              <TextField label="Motivo" fullWidth multiline minRows={2} {...register("motivo")} error={!!errors.motivo} helperText={errors.motivo?.message} />
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
