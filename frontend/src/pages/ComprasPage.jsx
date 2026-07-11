import { useEffect, useState, useCallback, useRef } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Box, Grid, TextField, MenuItem, Button, Stack, IconButton, Tooltip, Tab, Tabs, Chip } from "@mui/material";
import EditIcon from "@mui/icons-material/EditOutlined";
import CancelIcon from "@mui/icons-material/CancelOutlined";

import PageHeader from "../components/PageHeader";
import DataTable from "../components/DataTable";
import FormDialog from "../components/FormDialog";
import ConfirmDialog from "../components/ConfirmDialog";
import PorPagarTab from "../components/compras/PorPagarTab";
import ComprasHistoricasTab from "../components/compras/ComprasHistoricasTab";
import { useAuth } from "../context/AuthContext";
import { useNotify } from "../hooks/useNotify";
import { formatoNumero, formatoFecha, fechaHoyISO } from "../utils/format";
import { anularCompra, listarCompras, crearCompra, editarCompra, unidadesCompatibles, listarIngredientes, listarProveedores, listarEntidadesFinancieras } from "../api/endpoints";

const schemaComun = z.object({
  entidad_id: z.union([z.coerce.number().positive(), z.literal("")]).optional(),
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
const schemaNueva = schemaComun.extend({
  entidad_id: z.coerce.number({ invalid_type_error: "Selecciona una entidad" }).positive("Selecciona una entidad"),
  proveedor_id: z.coerce.number({ invalid_type_error: "Selecciona un proveedor" }).positive("Selecciona un proveedor"),
});

const defaultValues = {
  entidad_id: "",
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
  const [entidades, setEntidades] = useState([]);
  const [unidades, setUnidades] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState(0);
  const [anulando, setAnulando] = useState(null);
  const [anulandoEnvio, setAnulandoEnvio] = useState(false);
  const [historicosVersion, setHistoricosVersion] = useState(0);
  const idempotencyKeyRef = useRef(null);
  const anulacionKeyRef = useRef(null);

  const {
    register,
    handleSubmit,
    control,
    reset,
    watch,
    formState: { errors },
  } = useForm({ resolver: (...args) => zodResolver(editing ? schemaComun : schemaNueva)(...args), defaultValues });

  const ingredienteId = watch("ingrediente_id");

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const [compras, ing, prov, ent] = await Promise.all([listarCompras(), listarIngredientes(), listarProveedores(), listarEntidadesFinancieras()]);
      setRows(compras);
      setIngredientes(ing);
      setProveedores(prov);
      setEntidades(ent);
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
    idempotencyKeyRef.current = null;
    reset(defaultValues);
    setDialogOpen(true);
  };

  const abrirEditar = (row) => {
    setEditing(row);
    reset({
      ingrediente_id: row.ingrediente_id,
      proveedor_id: row.proveedor_id || "",
      entidad_id: row.entidad_id || "",
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
    const payload = { ...data, proveedor_id: data.proveedor_id || null, entidad_id: data.entidad_id || null, fecha_vencimiento: data.fecha_vencimiento || null };
    setSaving(true);
    try {
      if (editing) {
        await editarCompra(editing.id, payload);
        notify.success("Compra actualizada");
        if (editing.historico) setHistoricosVersion((version) => version + 1);
      } else {
        idempotencyKeyRef.current ||= crypto.randomUUID();
        await crearCompra(payload, idempotencyKeyRef.current);
        notify.success("Compra registrada");
      }
      setDialogOpen(false);
      idempotencyKeyRef.current = null;
      cargar();
    } catch (e) {
      notify.error(e);
    } finally {
      setSaving(false);
    }
  };

  const puedeEscribir = hasRole("admin", "operador");
  const puedeAnular = hasRole("admin");
  const mensajeError = (error, accion) => {
    const prefijos = { 400: "Revisa los datos", 403: "No tienes permisos", 404: "El registro ya no existe", 409: "La operación está bloqueada" };
    notify.error(`${prefijos[error?.status] || `No se pudo ${accion}`}: ${error.message}`);
  };
  const confirmarAnulacion = async () => {
    if (!anulando) return;
    setAnulandoEnvio(true);
    try {
      anulacionKeyRef.current ||= crypto.randomUUID();
      await anularCompra(anulando.id, anulacionKeyRef.current);
      notify.success("Compra anulada");
      setAnulando(null);
      anulacionKeyRef.current = null;
      cargar();
    } catch (error) {
      mensajeError(error, "anular la compra");
    } finally {
      setAnulandoEnvio(false);
    }
  };

  const columns = [
    { field: "fecha_compra", headerName: "Fecha", renderCell: (r) => formatoFecha(r.fecha_compra) },
    { field: "ingrediente_nombre", headerName: "Ingrediente", minWidth: 160 },
    { field: "proveedor_nombre", headerName: "Proveedor", renderCell: (r) => r.proveedor_nombre || "—" },
    { field: "integracion", headerName: "Integración", renderCell: (r) => r.historico ? <Chip size="small" label="Histórica" variant="outlined" /> : <Chip size="small" label={`CxP ${r.estado_cxp}`} color={r.estado_cxp === "parcial" ? "warning" : r.estado_cxp === "pagada" ? "success" : "default"} /> },
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
        <Stack direction="row">
          {puedeEscribir && r.historico && <Tooltip title="Editar"><IconButton size="small" onClick={() => abrirEditar(r)}><EditIcon fontSize="small" /></IconButton></Tooltip>}
          {puedeAnular && !r.historico && r.estado_cxp !== "anulada" && <Tooltip title="Anular compra"><IconButton size="small" color="error" onClick={() => { anulacionKeyRef.current = crypto.randomUUID(); setAnulando(r); }}><CancelIcon fontSize="small" /></IconButton></Tooltip>}
        </Stack>,
    },
  ];

  return (
    <Box>
      <PageHeader
        title="Compras"
        subtitle="Registro de lotes de materia prima, con vencimiento y costo real."
        actionLabel={tab === 0 && puedeEscribir ? "Nueva compra" : null}
        onAction={abrirNuevo}
      />
      <Tabs value={tab} onChange={(_, value) => setTab(value)} sx={{ mb: 2 }}>
        <Tab label="Compras" />
        <Tab label="Históricas" />
        <Tab label="Por pagar" />
      </Tabs>

      {tab === 2 ? <PorPagarTab /> : tab === 1 ? <ComprasHistoricasTab proveedores={proveedores} ingredientes={ingredientes} onEdit={abrirEditar} refreshKey={historicosVersion} /> : <>
      <DataTable columns={columns} rows={rows} loading={loading} searchPlaceholder="Buscar por ingrediente o proveedor…" defaultOrderBy="fecha_compra" defaultOrder="desc" />

      <FormDialog open={dialogOpen} onClose={() => setDialogOpen(false)} title={editing ? "Editar compra" : "Nueva compra"} maxWidth="md">
        <Box component="form" onSubmit={handleSubmit(onSubmit)} noValidate>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6}>
              <Controller
                name="entidad_id"
                control={control}
                render={({ field }) => (
                  <TextField {...field} select label="Entidad económica" fullWidth error={!!errors.entidad_id} helperText={errors.entidad_id?.message}>
                    <MenuItem value="">Selecciona…</MenuItem>
                    {entidades.map((entidad) => <MenuItem key={entidad.id} value={entidad.id}>{entidad.nombre}</MenuItem>)}
                  </TextField>
                )}
              />
            </Grid>
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
                  <TextField {...field} select label="Proveedor" fullWidth error={!!errors.proveedor_id} helperText={errors.proveedor_id?.message}>
                    <MenuItem value="">Selecciona…</MenuItem>
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
      </>}
      <ConfirmDialog
        open={!!anulando}
        title="¿Anular compra?"
        message="Esta acción revierte la emisión y el inventario solo si la compra no tiene pagos ni consumo. No se puede deshacer."
        confirmText="Anular compra"
        danger
        loading={anulandoEnvio}
        onClose={() => !anulandoEnvio && setAnulando(null)}
        onConfirm={confirmarAnulacion}
      />
    </Box>
  );
}
