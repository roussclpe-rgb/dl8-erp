import { useEffect, useState, useCallback } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Box, Grid, TextField, Button, Stack, IconButton, Tooltip, MenuItem } from "@mui/material";
import DeleteIcon from "@mui/icons-material/DeleteOutline";
import SettingsIcon from "@mui/icons-material/SettingsOutlined";

import PageHeader from "../PageHeader";
import DataTable from "../DataTable";
import FormDialog from "../FormDialog";
import ConfirmDialog from "../ConfirmDialog";
import StatusChip from "../StatusChip";
import { useNotify } from "../../hooks/useNotify";
import { listarCajas, crearCaja, eliminarCaja, configurarCajaFinanciera, listarEntidadesFinancieras, listarCuentasFinancieras } from "../../api/endpoints";

const schema = z.object({ nombre: z.string().min(1, "El nombre es obligatorio"), entidad_id: z.coerce.number().positive("Selecciona una entidad"), cuenta_financiera_id: z.coerce.number().positive("Selecciona una cuenta") });

export default function CajasAdminTab() {
  const notify = useNotify();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [configCaja, setConfigCaja] = useState(null);
  const [saving, setSaving] = useState(false);
  const [toDelete, setToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [entidades, setEntidades] = useState([]);
  const [cuentas, setCuentas] = useState([]);

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    formState: { errors },
  } = useForm({ resolver: zodResolver(schema), defaultValues: { nombre: "", entidad_id: "", cuenta_financiera_id: "" } });
  const configForm = useForm({ resolver: zodResolver(schema.omit({ nombre: true })), defaultValues: { entidad_id: "", cuenta_financiera_id: "" } });

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
    listarEntidadesFinancieras().then(setEntidades).catch(() => setEntidades([]));
  }, [cargar]);

  const abrirNuevo = () => {
    reset({ nombre: "", entidad_id: "", cuenta_financiera_id: "" });
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

  const seleccionarEntidad = async (entidadId) => {
    setValue("entidad_id", entidadId);
    setValue("cuenta_financiera_id", "");
    setCuentas((await listarCuentasFinancieras(entidadId)).filter((cuenta) => cuenta.tipo === "caja" && cuenta.estado === "activa"));
  };

  const abrirConfiguracion = async (caja) => {
    setConfigCaja(caja);
    configForm.reset({ entidad_id: caja.entidad_id || "", cuenta_financiera_id: caja.cuenta_financiera_id || "" });
    if (!caja.entidad_id) return setCuentas([]);
    try {
      setCuentas((await listarCuentasFinancieras(caja.entidad_id)).filter((cuenta) => cuenta.tipo === "caja" && cuenta.estado === "activa"));
    } catch (e) {
      setCuentas([]);
      notify.error(e);
    }
  };

  const seleccionarEntidadConfiguracion = async (entidadId) => {
    configForm.setValue("entidad_id", entidadId);
    configForm.setValue("cuenta_financiera_id", "");
    try {
      setCuentas((await listarCuentasFinancieras(entidadId)).filter((cuenta) => cuenta.tipo === "caja" && cuenta.estado === "activa"));
    } catch (e) {
      setCuentas([]);
      notify.error(e);
    }
  };

  const guardarConfiguracion = async (data) => {
    setSaving(true);
    try {
      await configurarCajaFinanciera(configCaja.id, data);
      notify.success("Configuración financiera guardada");
      setConfigCaja(null);
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
    { field: "cuenta_financiera_id", headerName: "Configuración financiera", minWidth: 190, renderCell: (r) => r.cuenta_financiera_id ? <StatusChip label="Configurada" tone="success" /> : <StatusChip label="Pendiente" tone="warning" /> },
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
        <Stack direction="row" justifyContent="flex-end">
          {!r.cuenta_financiera_id && <Tooltip title="Configurar finanzas"><IconButton size="small" color="primary" onClick={() => abrirConfiguracion(r)}><SettingsIcon fontSize="small" /></IconButton></Tooltip>}
          <Tooltip title={r.turnoAbiertoId ? "No puedes desactivar una caja con turno abierto" : "Desactivar"}>
            <span><IconButton size="small" color="error" disabled={!!r.turnoAbiertoId} onClick={() => setToDelete(r)}><DeleteIcon fontSize="small" /></IconButton></span>
          </Tooltip>
        </Stack>
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
            <Grid item xs={12} sm={6}>
              <TextField select label="Entidad económica" fullWidth {...register("entidad_id")} onChange={(e) => seleccionarEntidad(e.target.value)} error={!!errors.entidad_id} helperText={errors.entidad_id?.message}>
                <MenuItem value="">Selecciona una entidad</MenuItem>
                {entidades.map((entidad) => <MenuItem key={entidad.id} value={entidad.id}>{entidad.nombre}</MenuItem>)}
              </TextField>
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField select label="Cuenta financiera tipo Caja" fullWidth {...register("cuenta_financiera_id")} error={!!errors.cuenta_financiera_id} helperText={errors.cuenta_financiera_id?.message}>
                <MenuItem value="">Selecciona una cuenta</MenuItem>
                {cuentas.map((cuenta) => <MenuItem key={cuenta.id} value={cuenta.id}>{cuenta.nombre}</MenuItem>)}
              </TextField>
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

      <FormDialog open={!!configCaja} onClose={() => setConfigCaja(null)} title={`Configurar finanzas${configCaja ? `: ${configCaja.nombre}` : ""}`}>
        <Box component="form" onSubmit={configForm.handleSubmit(guardarConfiguracion)} noValidate>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6}>
              <TextField select label="Entidad económica" fullWidth {...configForm.register("entidad_id")} onChange={(e) => seleccionarEntidadConfiguracion(e.target.value)} error={!!configForm.formState.errors.entidad_id} helperText={configForm.formState.errors.entidad_id?.message}>
                <MenuItem value="">Selecciona una entidad</MenuItem>
                {entidades.map((entidad) => <MenuItem key={entidad.id} value={entidad.id}>{entidad.nombre}</MenuItem>)}
              </TextField>
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField select label="Cuenta financiera tipo Caja" fullWidth {...configForm.register("cuenta_financiera_id")} error={!!configForm.formState.errors.cuenta_financiera_id} helperText={configForm.formState.errors.cuenta_financiera_id?.message}>
                <MenuItem value="">Selecciona una cuenta</MenuItem>
                {cuentas.map((cuenta) => <MenuItem key={cuenta.id} value={cuenta.id}>{cuenta.nombre}</MenuItem>)}
              </TextField>
            </Grid>
          </Grid>
          <Stack direction="row" justifyContent="flex-end" spacing={1.5} sx={{ mt: 3 }}>
            <Button onClick={() => setConfigCaja(null)} color="inherit">Cancelar</Button>
            <Button type="submit" variant="contained" disabled={saving}>{saving ? "Guardando…" : "Guardar"}</Button>
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
