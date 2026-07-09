import { useEffect, useState, useCallback } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Box, Grid, TextField, Button, Stack, IconButton, Tooltip, MenuItem, Chip } from "@mui/material";
import EditIcon from "@mui/icons-material/EditOutlined";
import DeleteIcon from "@mui/icons-material/DeleteOutline";

import PageHeader from "../PageHeader";
import DataTable from "../DataTable";
import FormDialog from "../FormDialog";
import ConfirmDialog from "../ConfirmDialog";
import { useAuth } from "../../context/AuthContext";
import { useNotify } from "../../hooks/useNotify";
import { listarClientes, crearCliente, eliminarCliente } from "../../api/endpoints";

const schema = z.object({
  nombre: z.string().min(1, "El nombre es obligatorio"),
  tipo: z.enum(["minorista", "mayorista"]),
});

const defaultValues = { nombre: "", tipo: "minorista" };

export default function ClientesTab() {
  const { hasRole } = useAuth();
  const notify = useNotify();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toDelete, setToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm({ resolver: zodResolver(schema), defaultValues });

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await listarClientes());
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
    reset(defaultValues);
    setDialogOpen(true);
  };

  const onSubmit = async (data) => {
    setSaving(true);
    try {
      await crearCliente(data);
      notify.success("Cliente creado");
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
      await eliminarCliente(toDelete.id);
      notify.success("Cliente desactivado");
      setToDelete(null);
      cargar();
    } catch (e) {
      notify.error(e);
    } finally {
      setDeleting(false);
    }
  };

  const puedeEscribir = hasRole("admin", "operador", "vendedor");
  const puedeEliminar = hasRole("admin");

  const columns = [
    { field: "nombre", headerName: "Nombre", minWidth: 200 },
    {
      field: "tipo",
      headerName: "Tipo",
      renderCell: (r) => (
        <Chip
          size="small"
          label={r.tipo === "mayorista" ? "Mayorista" : "Minorista"}
          color={r.tipo === "mayorista" ? "primary" : "default"}
          variant={r.tipo === "mayorista" ? "filled" : "outlined"}
        />
      ),
    },
    {
      field: "acciones",
      headerName: "Acciones",
      align: "right",
      sortable: false,
      renderCell: (r) => (
        <Stack direction="row" spacing={0.5} justifyContent="flex-end">
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
        title="Clientes"
        subtitle="Clientes minoristas y mayoristas (el precio aplicado en una venta depende del tipo)."
        actionLabel={puedeEscribir ? "Nuevo cliente" : null}
        onAction={abrirNuevo}
      />

      <DataTable columns={columns} rows={rows} loading={loading} searchPlaceholder="Buscar cliente…" defaultOrderBy="nombre" />

      <FormDialog open={dialogOpen} onClose={() => setDialogOpen(false)} title="Nuevo cliente">
        <Box component="form" onSubmit={handleSubmit(onSubmit)} noValidate>
          <Grid container spacing={2}>
            <Grid item xs={12}>
              <TextField label="Nombre" fullWidth autoFocus {...register("nombre")} error={!!errors.nombre} helperText={errors.nombre?.message} />
            </Grid>
            <Grid item xs={12}>
              <Controller
                name="tipo"
                control={control}
                render={({ field }) => (
                  <TextField select label="Tipo de cliente" fullWidth {...field}>
                    <MenuItem value="minorista">Minorista</MenuItem>
                    <MenuItem value="mayorista">Mayorista</MenuItem>
                  </TextField>
                )}
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
        title="Desactivar cliente"
        message={`¿Desactivar a "${toDelete?.nombre}"?`}
        confirmText="Desactivar"
        danger
        loading={deleting}
        onClose={() => setToDelete(null)}
        onConfirm={confirmarEliminar}
      />
    </Box>
  );
}
