import { useEffect, useState, useCallback } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Box, Grid, TextField, MenuItem, Button, Stack, Switch, Tooltip } from "@mui/material";

import PageHeader from "../components/PageHeader";
import DataTable from "../components/DataTable";
import FormDialog from "../components/FormDialog";
import StatusChip from "../components/StatusChip";
import { useNotify } from "../hooks/useNotify";
import { formatoFecha } from "../utils/format";
import { listarUsuarios, crearUsuario, cambiarEstadoUsuario } from "../api/endpoints";

const ROLES = [
  { value: "admin", label: "Administrador" },
  { value: "operador", label: "Operador" },
  { value: "lectura", label: "Solo lectura" },
];

const schema = z.object({
  nombre: z.string().min(1, "El nombre es obligatorio"),
  email: z.string().min(1, "El email es obligatorio").email("Email inválido"),
  password: z.string().min(8, "Mínimo 8 caracteres"),
  rol: z.enum(["admin", "operador", "lectura"], { errorMap: () => ({ message: "Selecciona un rol" }) }),
});

const defaultValues = { nombre: "", email: "", password: "", rol: "operador" };

export default function UsuariosPage() {
  const notify = useNotify();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
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
      setRows(await listarUsuarios());
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
      await crearUsuario(data);
      notify.success("Usuario creado");
      setDialogOpen(false);
      cargar();
    } catch (e) {
      notify.error(e);
    } finally {
      setSaving(false);
    }
  };

  const toggleEstado = async (row) => {
    try {
      await cambiarEstadoUsuario(row.id, !row.activo);
      notify.success(row.activo ? "Usuario desactivado" : "Usuario activado");
      cargar();
    } catch (e) {
      notify.error(e);
    }
  };

  const columns = [
    { field: "nombre", headerName: "Nombre", minWidth: 160 },
    { field: "email", headerName: "Email", minWidth: 200 },
    { field: "rol", headerName: "Rol", renderCell: (r) => <StatusChip label={ROLES.find((x) => x.value === r.rol)?.label || r.rol} tone="info" /> },
    { field: "creado_en", headerName: "Creado", renderCell: (r) => formatoFecha(r.creado_en) },
    {
      field: "activo",
      headerName: "Activo",
      align: "center",
      sortable: false,
      renderCell: (r) => (
        <Tooltip title={r.activo ? "Desactivar" : "Activar"}>
          <Switch checked={!!r.activo} onChange={() => toggleEstado(r)} size="small" />
        </Tooltip>
      ),
    },
  ];

  return (
    <Box>
      <PageHeader title="Usuarios" subtitle="Empleados con acceso al sistema y su rol." actionLabel="Nuevo usuario" onAction={abrirNuevo} />

      <DataTable columns={columns} rows={rows} loading={loading} searchPlaceholder="Buscar por nombre o email…" defaultOrderBy="nombre" />

      <FormDialog open={dialogOpen} onClose={() => setDialogOpen(false)} title="Nuevo usuario">
        <Box component="form" onSubmit={handleSubmit(onSubmit)} noValidate>
          <Grid container spacing={2}>
            <Grid item xs={12}>
              <TextField label="Nombre" fullWidth autoFocus {...register("nombre")} error={!!errors.nombre} helperText={errors.nombre?.message} />
            </Grid>
            <Grid item xs={12}>
              <TextField label="Email" fullWidth {...register("email")} error={!!errors.email} helperText={errors.email?.message} />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                label="Contraseña"
                type="password"
                fullWidth
                {...register("password")}
                error={!!errors.password}
                helperText={errors.password?.message}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <Controller
                name="rol"
                control={control}
                render={({ field }) => (
                  <TextField {...field} select label="Rol" fullWidth error={!!errors.rol} helperText={errors.rol?.message}>
                    {ROLES.map((r) => (
                      <MenuItem key={r.value} value={r.value}>
                        {r.label}
                      </MenuItem>
                    ))}
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
    </Box>
  );
}
