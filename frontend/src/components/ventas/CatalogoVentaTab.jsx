import { useEffect, useState, useCallback } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Box, Grid, TextField, Button, Stack, IconButton, Tooltip, MenuItem, Chip, InputAdornment } from "@mui/material";
import EditIcon from "@mui/icons-material/EditOutlined";
import AddIcon from "@mui/icons-material/Add";

import PageHeader from "../PageHeader";
import DataTable from "../DataTable";
import FormDialog from "../FormDialog";
import { useAuth } from "../../context/AuthContext";
import { useNotify } from "../../hooks/useNotify";
import {
  listarProductosVenta,
  listarRecetasSinPrecio,
  crearProductoVenta,
  editarProductoVenta,
} from "../../api/endpoints";

const schema = z.object({
  receta_grupo_id: z.number({ required_error: "Selecciona un producto" }),
  precio_normal: z.coerce.number().positive("Debe ser mayor a 0"),
  precio_mayorista: z.coerce.number().positive("Debe ser mayor a 0"),
});

export default function CatalogoVentaTab() {
  const { hasRole } = useAuth();
  const notify = useNotify();
  const [rows, setRows] = useState([]);
  const [sinPrecio, setSinPrecio] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);

  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm({ resolver: zodResolver(schema) });

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const [productos, faltantes] = await Promise.all([listarProductosVenta(), listarRecetasSinPrecio()]);
      setRows(productos);
      setSinPrecio(faltantes);
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
    reset({ receta_grupo_id: undefined, precio_normal: "", precio_mayorista: "" });
    setDialogOpen(true);
  };

  const abrirEditar = (row) => {
    setEditing(row);
    reset({
      receta_grupo_id: row.receta_grupo_id,
      precio_normal: row.precio_normal,
      precio_mayorista: row.precio_mayorista,
    });
    setDialogOpen(true);
  };

  const onSubmit = async (data) => {
    setSaving(true);
    try {
      if (editing) {
        await editarProductoVenta(editing.receta_grupo_id, data);
        notify.success("Precio actualizado");
      } else {
        await crearProductoVenta(data);
        notify.success("Producto agregado al catálogo de ventas");
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
    { field: "nombre_producto", headerName: "Producto", minWidth: 200 },
    { field: "precio_normal", headerName: "Precio normal", renderCell: (r) => `S/ ${r.precio_normal.toFixed(2)}` },
    { field: "precio_mayorista", headerName: "Precio mayorista", renderCell: (r) => `S/ ${r.precio_mayorista.toFixed(2)}` },
    {
      field: "stockDisponible",
      headerName: "Stock disponible",
      renderCell: (r) => (
        <Chip
          size="small"
          label={r.stockDisponible}
          color={r.stockDisponible > 0 ? "success" : "error"}
          variant="outlined"
        />
      ),
    },
    {
      field: "acciones",
      headerName: "Acciones",
      align: "right",
      sortable: false,
      renderCell: (r) =>
        puedeEscribir && (
          <Tooltip title="Editar precios">
            <IconButton size="small" onClick={() => abrirEditar(r)}>
              <EditIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        ),
    },
  ];

  return (
    <Box>
      <PageHeader
        title="Catálogo de precios"
        subtitle="Precios de venta por producto (según receta vigente) y stock disponible."
        actionLabel={puedeEscribir ? "Agregar producto" : null}
        onAction={abrirNuevo}
      />

      <DataTable columns={columns} rows={rows} loading={loading} searchPlaceholder="Buscar producto…" defaultOrderBy="nombre_producto" />

      <FormDialog open={dialogOpen} onClose={() => setDialogOpen(false)} title={editing ? "Editar precios" : "Agregar producto al catálogo"}>
        <Box component="form" onSubmit={handleSubmit(onSubmit)} noValidate>
          <Grid container spacing={2}>
            <Grid item xs={12}>
              <Controller
                name="receta_grupo_id"
                control={control}
                render={({ field }) => (
                  <TextField
                    select
                    label="Producto (receta)"
                    fullWidth
                    disabled={!!editing}
                    value={field.value ?? ""}
                    onChange={(e) => field.onChange(Number(e.target.value))}
                    error={!!errors.receta_grupo_id}
                    helperText={errors.receta_grupo_id?.message}
                  >
                    {editing ? (
                      <MenuItem value={editing.receta_grupo_id}>{editing.nombre_producto}</MenuItem>
                    ) : sinPrecio.length === 0 ? (
                      <MenuItem disabled value="">
                        Todas las recetas ya tienen precio asignado
                      </MenuItem>
                    ) : (
                      sinPrecio.map((r) => (
                        <MenuItem key={r.receta_grupo_id} value={r.receta_grupo_id}>
                          {r.nombre_producto}
                        </MenuItem>
                      ))
                    )}
                  </TextField>
                )}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                label="Precio normal"
                type="number"
                fullWidth
                inputProps={{ step: "0.01" }}
                InputProps={{ startAdornment: <InputAdornment position="start">S/</InputAdornment> }}
                {...register("precio_normal")}
                error={!!errors.precio_normal}
                helperText={errors.precio_normal?.message}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                label="Precio mayorista"
                type="number"
                fullWidth
                inputProps={{ step: "0.01" }}
                InputProps={{ startAdornment: <InputAdornment position="start">S/</InputAdornment> }}
                {...register("precio_mayorista")}
                error={!!errors.precio_mayorista}
                helperText={errors.precio_mayorista?.message}
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
