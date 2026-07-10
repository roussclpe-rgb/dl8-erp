import { useEffect, useState, useCallback } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Box, Grid, TextField, Button, Stack, IconButton, Tooltip } from "@mui/material";
import DeleteIcon from "@mui/icons-material/DeleteOutline";

import PageHeader from "../PageHeader";
import DataTable from "../DataTable";
import FormDialog from "../FormDialog";
import ConfirmDialog from "../ConfirmDialog";
import StatusChip from "../StatusChip";
import { useNotify } from "../../hooks/useNotify";
import { listarCajas, crearCaja, eliminarCaja } from "../../api/endpoints";

const schema = z.object({ nombre: z.string().min(1, "El nombre es obligatorio") });

export default function CajasAdminTab() {
  const notify = useNotify();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toDelete, setToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm({ resolver: zodResolver(schema), defaultValues: { nombre: "" } });

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await listarCajas());
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
    reset({ nombre: "" });
    setDialogOpen(true);
  };

  const onSubmit = async (data) => {
    setSaving(true);
    try {
      await crearCaja(data);
      notify.success("Caja creada");
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
      await eliminarCaja(toDelete.id);
      notify.success("Caja desactivada");
      setToDelete(null);
      cargar();
    } catch (e) {
      notify.error(e);
    } finally {
      setDeleting(false);
    }
  };

  const columns = [
    { field: "nombre", headerName: "Nombre", minWidth: 200 },
    {
      field: "turnoAbiertoId",
      headerName: "Estado",
      align: "center",
      renderCell: (r) => (r.turnoAbiertoId ? <StatusChip label="Turno abierto" tone="success" /> : <StatusChip label="Cerrada" tone="default" />),
    },
    {
      field: "acciones",
      headerName: "Acciones",
      align: "right",
      sortable: false,
      renderCell: (r) => (
        <Tooltip title={r.turnoAbiertoId ? "No puedes desactivar una caja con turno abierto" : "Desactivar"}>
          <span>
            <IconButton size="small" color="error" disabled={!!r.turnoAbiertoId} onClick={() => setToDelete(r)}>
              <DeleteIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      ),
    },
  ];

  return (
    <Box>
      <PageHeader
        title="Cajas registradas"
        subtitle="Registros físicos de caja (mostrador, delivery, etc.) disponibles para abrir turnos."
        actionLabel="Nueva caja"
        onAction={abrirNuevo}
      />

      <DataTable columns={columns} rows={rows} loading={loading} searchPlaceholder="Buscar caja…" defaultOrderBy="nombre" />

      <FormDialog open={dialogOpen} onClose={() => setDialogOpen(false)} title="Nueva caja">
        <Box component="form" onSubmit={handleSubmit(onSubmit)} noValidate>
          <Grid container spacing={2}>
            <Grid item xs={12}>
              <TextField
                label="Nombre"
                fullWidth
                autoFocus
                placeholder="Ej: Caja mostrador, Caja delivery"
                {...register("nombre")}
                error={!!errors.nombre}
                helperText={errors.nombre?.message}
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
        title="Desactivar caja"
        message={`¿Desactivar "${toDelete?.nombre}"? Su historial de turnos se conserva.`}
        confirmText="Desactivar"
        danger
        loading={deleting}
        onClose={() => setToDelete(null)}
        onConfirm={confirmarEliminar}
      />
    </Box>
  );
}
