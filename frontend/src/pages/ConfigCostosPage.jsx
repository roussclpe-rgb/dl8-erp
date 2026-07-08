import { useEffect, useState, useCallback } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Box, Grid, TextField, MenuItem, Button, Stack, Paper, Typography, IconButton, Tooltip } from "@mui/material";
import DeleteIcon from "@mui/icons-material/DeleteOutline";

import PageHeader from "../components/PageHeader";
import DataTable from "../components/DataTable";
import FormDialog from "../components/FormDialog";
import ConfirmDialog from "../components/ConfirmDialog";
import { useAuth } from "../context/AuthContext";
import { useNotify } from "../hooks/useNotify";
import { formatoMoneda } from "../utils/format";
import { obtenerConfigCostos, crearCostoIndirecto, eliminarCostoIndirecto, actualizarManoObra } from "../api/endpoints";

const TIPOS = [
  { value: "por_tanda", label: "Por tanda producida" },
  { value: "por_unidad", label: "Por unidad producida" },
  { value: "mensual_prorrateado", label: "Mensual prorrateado" },
];

const schemaIndirecto = z
  .object({
    nombre: z.string().min(1, "El nombre es obligatorio"),
    tipo: z.enum(["por_tanda", "por_unidad", "mensual_prorrateado"], { errorMap: () => ({ message: "Selecciona un tipo" }) }),
    valor: z.coerce.number().min(0, "Debe ser 0 o mayor"),
    unidades_estimadas_mes: z.union([z.coerce.number().positive(), z.literal("")]).optional(),
  })
  .refine((data) => data.tipo !== "mensual_prorrateado" || (data.unidades_estimadas_mes && data.unidades_estimadas_mes > 0), {
    message: "Los costos mensuales necesitan unidades estimadas por mes",
    path: ["unidades_estimadas_mes"],
  });

const schemaManoObra = z.object({
  nombre: z.string().min(1, "El nombre es obligatorio"),
  costo_por_hora: z.coerce.number().positive("Debe ser mayor a 0"),
});

export default function ConfigCostosPage() {
  const { hasRole } = useAuth();
  const notify = useNotify();
  const [costosIndirectos, setCostosIndirectos] = useState([]);
  const [manoObra, setManoObra] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dialogIndirecto, setDialogIndirecto] = useState(false);
  const [dialogManoObra, setDialogManoObra] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toDelete, setToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const formIndirecto = useForm({
    resolver: zodResolver(schemaIndirecto),
    defaultValues: { nombre: "", tipo: "por_tanda", valor: "", unidades_estimadas_mes: "" },
  });
  const tipoSeleccionado = formIndirecto.watch("tipo");

  const formManoObra = useForm({
    resolver: zodResolver(schemaManoObra),
    defaultValues: { nombre: "Costo por hora estándar", costo_por_hora: "" },
  });

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const data = await obtenerConfigCostos();
      setCostosIndirectos(data.costosIndirectos);
      setManoObra(data.manoObra);
    } catch (e) {
      notify.error(e);
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const puedeEscribir = hasRole("admin");

  const onSubmitIndirecto = async (data) => {
    setSaving(true);
    try {
      await crearCostoIndirecto({ ...data, unidades_estimadas_mes: data.unidades_estimadas_mes || null });
      notify.success("Costo indirecto agregado");
      setDialogIndirecto(false);
      formIndirecto.reset();
      cargar();
    } catch (e) {
      notify.error(e);
    } finally {
      setSaving(false);
    }
  };

  const confirmarEliminarIndirecto = async () => {
    setDeleting(true);
    try {
      await eliminarCostoIndirecto(toDelete.id);
      notify.success("Costo indirecto desactivado");
      setToDelete(null);
      cargar();
    } catch (e) {
      notify.error(e);
    } finally {
      setDeleting(false);
    }
  };

  const onSubmitManoObra = async (data) => {
    setSaving(true);
    try {
      await actualizarManoObra(data);
      notify.success("Costo por hora actualizado");
      setDialogManoObra(false);
      cargar();
    } catch (e) {
      notify.error(e);
    } finally {
      setSaving(false);
    }
  };

  const columns = [
    { field: "nombre", headerName: "Nombre", minWidth: 160 },
    { field: "tipo", headerName: "Tipo", renderCell: (r) => TIPOS.find((t) => t.value === r.tipo)?.label || r.tipo },
    { field: "valor", headerName: "Valor", align: "right", renderCell: (r) => formatoMoneda(r.valor) },
    { field: "unidades_estimadas_mes", headerName: "Unid. estimadas/mes", align: "right", renderCell: (r) => r.unidades_estimadas_mes ?? "—" },
    {
      field: "acciones",
      headerName: "Acciones",
      align: "right",
      sortable: false,
      renderCell: (r) =>
        puedeEscribir ? (
          <Tooltip title="Desactivar">
            <IconButton size="small" color="error" onClick={() => setToDelete(r)}>
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        ) : null,
    },
  ];

  return (
    <Box>
      <PageHeader title="Configuración de costos" subtitle="Costos indirectos y mano de obra usados en el costeo de producción." />

      <Grid container spacing={2.5} sx={{ mb: 3 }}>
        <Grid item xs={12} md={6}>
          <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 3, height: "100%" }}>
            <Typography variant="subtitle1">Mano de obra</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Solo hay una configuración vigente a la vez.
            </Typography>
            {manoObra ? (
              <Box>
                <Typography variant="h4" sx={{ fontWeight: 700 }}>
                  {formatoMoneda(manoObra.costo_por_hora)} / hora
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {manoObra.nombre}
                </Typography>
              </Box>
            ) : (
              <Typography variant="body2" color="text.secondary">
                Sin configurar todavía.
              </Typography>
            )}
            {puedeEscribir && (
              <Button
                sx={{ mt: 2 }}
                variant="outlined"
                onClick={() => {
                  formManoObra.reset({ nombre: manoObra?.nombre || "Costo por hora estándar", costo_por_hora: manoObra?.costo_por_hora || "" });
                  setDialogManoObra(true);
                }}
              >
                Actualizar costo por hora
              </Button>
            )}
          </Paper>
        </Grid>
      </Grid>

      <PageHeader
        title="Costos indirectos"
        actionLabel={puedeEscribir ? "Nuevo costo indirecto" : null}
        onAction={() => {
          formIndirecto.reset({ nombre: "", tipo: "por_tanda", valor: "", unidades_estimadas_mes: "" });
          setDialogIndirecto(true);
        }}
      />

      <DataTable columns={columns} rows={costosIndirectos} loading={loading} searchPlaceholder="Buscar costo indirecto…" defaultOrderBy="nombre" />

      <FormDialog open={dialogIndirecto} onClose={() => setDialogIndirecto(false)} title="Nuevo costo indirecto">
        <Box component="form" onSubmit={formIndirecto.handleSubmit(onSubmitIndirecto)} noValidate>
          <Grid container spacing={2}>
            <Grid item xs={12}>
              <TextField
                label="Nombre"
                fullWidth
                autoFocus
                {...formIndirecto.register("nombre")}
                error={!!formIndirecto.formState.errors.nombre}
                helperText={formIndirecto.formState.errors.nombre?.message}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <Controller
                name="tipo"
                control={formIndirecto.control}
                render={({ field }) => (
                  <TextField {...field} select label="Tipo" fullWidth>
                    {TIPOS.map((t) => (
                      <MenuItem key={t.value} value={t.value}>
                        {t.label}
                      </MenuItem>
                    ))}
                  </TextField>
                )}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                label="Valor (S/)"
                type="number"
                fullWidth
                inputProps={{ step: "any" }}
                {...formIndirecto.register("valor")}
                error={!!formIndirecto.formState.errors.valor}
                helperText={formIndirecto.formState.errors.valor?.message}
              />
            </Grid>
            {tipoSeleccionado === "mensual_prorrateado" && (
              <Grid item xs={12}>
                <TextField
                  label="Unidades estimadas al mes"
                  type="number"
                  fullWidth
                  {...formIndirecto.register("unidades_estimadas_mes")}
                  error={!!formIndirecto.formState.errors.unidades_estimadas_mes}
                  helperText={formIndirecto.formState.errors.unidades_estimadas_mes?.message}
                />
              </Grid>
            )}
          </Grid>
          <Stack direction="row" justifyContent="flex-end" spacing={1.5} sx={{ mt: 3 }}>
            <Button onClick={() => setDialogIndirecto(false)} color="inherit">
              Cancelar
            </Button>
            <Button type="submit" variant="contained" disabled={saving}>
              {saving ? "Guardando…" : "Guardar"}
            </Button>
          </Stack>
        </Box>
      </FormDialog>

      <FormDialog open={dialogManoObra} onClose={() => setDialogManoObra(false)} title="Actualizar costo por hora">
        <Box component="form" onSubmit={formManoObra.handleSubmit(onSubmitManoObra)} noValidate>
          <Grid container spacing={2}>
            <Grid item xs={12}>
              <TextField
                label="Nombre"
                fullWidth
                {...formManoObra.register("nombre")}
                error={!!formManoObra.formState.errors.nombre}
                helperText={formManoObra.formState.errors.nombre?.message}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                label="Costo por hora (S/)"
                type="number"
                fullWidth
                inputProps={{ step: "any" }}
                {...formManoObra.register("costo_por_hora")}
                error={!!formManoObra.formState.errors.costo_por_hora}
                helperText={formManoObra.formState.errors.costo_por_hora?.message}
              />
            </Grid>
          </Grid>
          <Stack direction="row" justifyContent="flex-end" spacing={1.5} sx={{ mt: 3 }}>
            <Button onClick={() => setDialogManoObra(false)} color="inherit">
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
        title="Desactivar costo indirecto"
        message={`¿Desactivar "${toDelete?.nombre}"? Dejará de aplicarse en nuevas producciones.`}
        confirmText="Desactivar"
        danger
        loading={deleting}
        onClose={() => setToDelete(null)}
        onConfirm={confirmarEliminarIndirecto}
      />
    </Box>
  );
}
