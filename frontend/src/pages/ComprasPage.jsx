import { useEffect, useState, useCallback } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Box, Grid, TextField, MenuItem, Button, Stack, IconButton, Tooltip } from "@mui/material";
import EditIcon from "@mui/icons-material/EditOutlined";

import PageHeader from "../components/PageHeader";
import DataTable from "../components/DataTable";
import FormDialog from "../components/FormDialog";
import { useAuth } from "../context/AuthContext";
import { useNotify } from "../hooks/useNotify";
import { formatoNumero, formatoFecha, fechaHoyISO } from "../utils/format";
import { listarCompras, crearCompra, editarCompra, unidadesCompatibles, listarIngredientes, listarProveedores } from "../api/endpoints";

const schema = z.object({
  ingrediente_id: z.coerce.number({ invalid_type_error: "Selecciona un ingrediente" }).positive("Selecciona un ingrediente"),
  proveedor_id: z.union([z.coerce.number().positive(), z.literal("")]).optional(),
  fecha_compra: z.string().min(1, "La fecha es obligatoria"),
  fecha_vencimiento: z.string().optional(),
  presentacion: z.string().optional(),
  cantidad_comprada: z.coerce.number().positive("Debe ser mayor a 0"),
  unidad_compra: z.string().min(1, "Selecciona una unidad"),
  contenido_por_presentacion: z.coerce.number().positive("Debe ser mayor a 0"),
  costo_total: z.coerce.number().positive("Debe ser mayor a 0"),
});

const defaultValues = {
  ingrediente_id: "",
  proveedor_id: "",
  fecha_compra: fechaHoyISO(),
  fecha_vencimiento: "",
  presentacion: "",
  cantidad_comprada: "",
  unidad_compra: "",
  contenido_por_presentacion: 1,
  costo_total: "",
};

export default function ComprasPage() {
  const { hasRole } = useAuth();
  const notify = useNotify();
  const [rows, setRows] = useState([]);
  const [ingredientes, setIngredientes] = useState([]);
  const [proveedores, setProveedores] = useState([]);
  const [unidades, setUnidades] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);

  const {
    register,
    handleSubmit,
    control,
    reset,
    watch,
    formState: { errors },
  } = useForm({ resolver: zodResolver(schema), defaultValues });

  const ingredienteId = watch("ingrediente_id");

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const [compras, ing, prov] = await Promise.all([listarCompras(), listarIngredientes(), listarProveedores()]);
      setRows(compras);
      setIngredientes(ing);
      setProveedores(prov);
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
    if (!ingredienteId) {
      setUnidades([]);
      return;
    }
    unidadesCompatibles(ingredienteId)
      .then(setUnidades)
      .catch(() => setUnidades([]));
  }, [ingredienteId]);

  const abrirNuevo = () => {
    setEditing(null);
    reset(defaultValues);
    setDialogOpen(true);
  };

  const abrirEditar = (row) => {
    setEditing(row);
    reset({
      ingrediente_id: row.ingrediente_id,
      proveedor_id: row.proveedor_id || "",
      fecha_compra: row.fecha_compra,
      fecha_vencimiento: row.fecha_vencimiento || "",
      presentacion: row.presentacion || "",
      cantidad_comprada: row.cantidad_comprada,
      unidad_compra: row.unidad_compra,
      contenido_por_presentacion: row.contenido_por_presentacion,
      costo_total: row.costo_total,
    });
    setDialogOpen(true);
  };

  const onSubmit = async (data) => {
    const payload = { ...data, proveedor_id: data.proveedor_id || null, fecha_vencimiento: data.fecha_vencimiento || null };
    setSaving(true);
    try {
      if (editing) {
        await editarCompra(editing.id, payload);
        notify.success("Compra actualizada");
      } else {
        await crearCompra(payload);
        notify.success("Compra registrada");
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
    { field: "fecha_compra", headerName: "Fecha", renderCell: (r) => formatoFecha(r.fecha_compra) },
    { field: "ingrediente_nombre", headerName: "Ingrediente", minWidth: 160 },
    { field: "proveedor_nombre", headerName: "Proveedor", renderCell: (r) => r.proveedor_nombre || "—" },
    {
      field: "cantidad_comprada",
      headerName: "Cantidad",
      align: "right",
      renderCell: (r) => `${formatoNumero(r.cantidad_comprada)} ${r.unidad_compra}`,
    },
    { field: "costo_total", headerName: "Costo total", align: "right", renderCell: (r) => formatoNumero(r.costo_total) },
    {
      field: "costo_unidad_base",
      headerName: `Costo / ${"unidad base"}`,
      align: "right",
      renderCell: (r) => `${formatoNumero(r.costo_unidad_base, 4)} / ${r.unidad_base}`,
    },
    { field: "fecha_vencimiento", headerName: "Vence", renderCell: (r) => (r.fecha_vencimiento ? formatoFecha(r.fecha_vencimiento) : "—") },
    {
      field: "acciones",
      headerName: "Acciones",
      align: "right",
      sortable: false,
      renderCell: (r) =>
        puedeEscribir ? (
          <Tooltip title="Editar">
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
        title="Compras"
        subtitle="Registro de lotes de materia prima, con vencimiento y costo real."
        actionLabel={puedeEscribir ? "Nueva compra" : null}
        onAction={abrirNuevo}
      />

      <DataTable columns={columns} rows={rows} loading={loading} searchPlaceholder="Buscar por ingrediente o proveedor…" defaultOrderBy="fecha_compra" defaultOrder="desc" />

      <FormDialog open={dialogOpen} onClose={() => setDialogOpen(false)} title={editing ? "Editar compra" : "Nueva compra"} maxWidth="md">
        <Box component="form" onSubmit={handleSubmit(onSubmit)} noValidate>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6}>
              <Controller
                name="ingrediente_id"
                control={control}
                render={({ field }) => (
                  <TextField {...field} select label="Ingrediente" fullWidth error={!!errors.ingrediente_id} helperText={errors.ingrediente_id?.message}>
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
            <Grid item xs={12} sm={6}>
              <Controller
                name="proveedor_id"
                control={control}
                render={({ field }) => (
                  <TextField {...field} select label="Proveedor (opcional)" fullWidth>
                    <MenuItem value="">Sin proveedor</MenuItem>
                    {proveedores.map((p) => (
                      <MenuItem key={p.id} value={p.id}>
                        {p.nombre}
                      </MenuItem>
                    ))}
                  </TextField>
                )}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                label="Fecha de compra"
                type="date"
                fullWidth
                InputLabelProps={{ shrink: true }}
                {...register("fecha_compra")}
                error={!!errors.fecha_compra}
                helperText={errors.fecha_compra?.message}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField label="Fecha de vencimiento (opcional)" type="date" fullWidth InputLabelProps={{ shrink: true }} {...register("fecha_vencimiento")} />
            </Grid>
            <Grid item xs={12} sm={4}>
              <TextField
                label="Cantidad comprada"
                type="number"
                fullWidth
                inputProps={{ step: "any" }}
                {...register("cantidad_comprada")}
                error={!!errors.cantidad_comprada}
                helperText={errors.cantidad_comprada?.message}
              />
            </Grid>
            <Grid item xs={12} sm={4}>
              <Controller
                name="unidad_compra"
                control={control}
                render={({ field }) => (
                  <TextField {...field} select label="Unidad de compra" fullWidth error={!!errors.unidad_compra} helperText={errors.unidad_compra?.message || "Elige primero el ingrediente"}>
                    <MenuItem value="">Selecciona…</MenuItem>
                    {unidades.map((u) => (
                      <MenuItem key={u} value={u}>
                        {u}
                      </MenuItem>
                    ))}
                  </TextField>
                )}
              />
            </Grid>
            <Grid item xs={12} sm={4}>
              <TextField
                label="Contenido por presentación"
                type="number"
                fullWidth
                inputProps={{ step: "any" }}
                {...register("contenido_por_presentacion")}
                error={!!errors.contenido_por_presentacion}
                helperText={errors.contenido_por_presentacion?.message || "Ej: 1 saco = 50 (kg)"}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField label="Presentación (opcional)" fullWidth placeholder="Ej: saco, bolsa, caja" {...register("presentacion")} />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                label="Costo total pagado"
                type="number"
                fullWidth
                inputProps={{ step: "any" }}
                {...register("costo_total")}
                error={!!errors.costo_total}
                helperText={errors.costo_total?.message}
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
