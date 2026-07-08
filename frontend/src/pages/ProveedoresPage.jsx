import { useEffect, useState, useCallback } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Box, Grid, TextField, Button, Stack, IconButton, Tooltip } from "@mui/material";
import EditIcon from "@mui/icons-material/EditOutlined";
import DeleteIcon from "@mui/icons-material/DeleteOutline";

import PageHeader from "../components/PageHeader";
import DataTable from "../components/DataTable";
import FormDialog from "../components/FormDialog";
import ConfirmDialog from "../components/ConfirmDialog";
import { useAuth } from "../context/AuthContext";
import { useNotify } from "../hooks/useNotify";
import { listarProveedores, crearProveedor, editarProveedor, eliminarProveedor } from "../api/endpoints";

const schema = z.object({
  nombre: z.string().min(1, "El nombre es obligatorio"),
  contacto: z.string().optional(),
  telefono: z.string().optional(),
  email: z.union([z.string().email("Email inválido"), z.literal("")]).optional(),
  notas: z.string().optional(),
});

const defaultValues = { nombre: "", contacto: "", telefono: "", email: "", notas: "" };

export default function ProveedoresPage() {
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
    reset,
    formState: { errors },
  } = useForm({ resolver: zodResolver(schema), defaultValues });

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await listarProveedores());
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
      contacto: row.contacto || "",
      telefono: row.telefono || "",
      email: row.email || "",
      notas: row.notas || "",
    });
    setDialogOpen(true);
  };

  const onSubmit = async (data) => {
    setSaving(true);
    try {
      if (editing) {
        await editarProveedor(editing.id, data);
        notify.success("Proveedor actualizado");
      } else {
        await crearProveedor(data);
        notify.success("Proveedor creado");
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
      await eliminarProveedor(toDelete.id);
      notify.success("Proveedor desactivado");
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
    { field: "contacto", headerName: "Contacto", renderCell: (r) => r.contacto || "—" },
    { field: "telefono", headerName: "Teléfono", renderCell: (r) => r.telefono || "—" },
    { field: "email", headerName: "Email", renderCell: (r) => r.email || "—" },
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
        title="Proveedores"
        subtitle="Contactos y datos de tus proveedores de materia prima."
        actionLabel={puedeEscribir ? "Nuevo proveedor" : null}
        onAction={abrirNuevo}
      />

      <DataTable columns={columns} rows={rows} loading={loading} searchPlaceholder="Buscar proveedor…" defaultOrderBy="nombre" />

      <FormDialog open={dialogOpen} onClose={() => setDialogOpen(false)} title={editing ? "Editar proveedor" : "Nuevo proveedor"}>
        <Box component="form" onSubmit={handleSubmit(onSubmit)} noValidate>
          <Grid container spacing={2}>
            <Grid item xs={12}>
              <TextField label="Nombre" fullWidth autoFocus {...register("nombre")} error={!!errors.nombre} helperText={errors.nombre?.message} />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField label="Contacto" fullWidth {...register("contacto")} />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField label="Teléfono" fullWidth {...register("telefono")} />
            </Grid>
            <Grid item xs={12}>
              <TextField label="Email" fullWidth {...register("email")} error={!!errors.email} helperText={errors.email?.message} />
            </Grid>
            <Grid item xs={12}>
              <TextField label="Notas" fullWidth multiline minRows={2} {...register("notas")} />
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
        title="Desactivar proveedor"
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
