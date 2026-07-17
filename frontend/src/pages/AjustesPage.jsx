import { useEffect, useState, useCallback } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Box, Grid, TextField, MenuItem, Button, Stack } from "@mui/material";

import PageHeader from "../components/PageHeader";
import DataTable from "../components/DataTable";
import FormDialog from "../components/FormDialog";
import StatusChip from "../components/StatusChip";
import { useAuth } from "../context/AuthContext";
import { useNotify } from "../hooks/useNotify";
import { formatoNumero, formatoFecha, fechaHoyISO } from "../utils/format";
import { listarAjustes, crearAjuste, crearInventarioInicial, listarIngredientes } from "../api/endpoints";

const TIPOS = [
  { value: "merma", label: "Merma" },
  { value: "uso_externo", label: "Uso externo" },
  { value: "sobra", label: "Sobra por conteo" },
];

const schema = z.object({
  ingrediente_id: z.coerce.number({ invalid_type_error: "Selecciona un ingrediente" }).positive("Selecciona un ingrediente"),
  tipo: z.enum(["merma", "uso_externo", "sobra"], { errorMap: () => ({ message: "Selecciona un tipo" }) }),
  cantidad: z.coerce.number().positive("Debe ser mayor a 0"),
  motivo: z.string().min(1, "El motivo es obligatorio"),
  fecha: z.string().min(1, "La fecha es obligatoria"),
});

const defaultValues = { ingrediente_id: "", tipo: "merma", cantidad: "", motivo: "", fecha: fechaHoyISO() };

const TONO_TIPO = { merma: "error", uso_externo: "warning", conteo_sobra: "success", sobra: "success", inventario_inicial: "info" };
const LABEL_TIPO = { merma: "Merma", uso_externo: "Uso externo", conteo_sobra: "Sobra por conteo", inventario_inicial: "Inventario inicial" };
const inventarioInicialVacio = () => ({ ingrediente_id: "", cantidad: "", costo_total: "", motivo: "Inventario existente al iniciar ERP", fecha: fechaHoyISO() });

export default function AjustesPage() {
  const { hasRole } = useAuth();
  const notify = useNotify();
  const [rows, setRows] = useState([]);
  const [ingredientes, setIngredientes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dialogInventarioInicial, setDialogInventarioInicial] = useState(false);
  const [inventarioInicial, setInventarioInicial] = useState(inventarioInicialVacio);

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
      const [aj, ing] = await Promise.all([listarAjustes(), listarIngredientes()]);
      setRows(aj);
      setIngredientes(ing);
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
  const abrirInventarioInicial = () => { setInventarioInicial(inventarioInicialVacio()); setDialogInventarioInicial(true); };
  const guardarInventarioInicial = async () => {
    if (!inventarioInicial.ingrediente_id || !(Number(inventarioInicial.cantidad) > 0) || !(Number(inventarioInicial.costo_total) > 0)) return notify.error("Selecciona ingrediente e ingresa cantidad y costo total.");
    setSaving(true);
    try { await crearInventarioInicial({ ...inventarioInicial, ingrediente_id: Number(inventarioInicial.ingrediente_id), cantidad: Number(inventarioInicial.cantidad), costo_total: Number(inventarioInicial.costo_total) }); notify.success("Inventario inicial registrado"); setDialogInventarioInicial(false); cargar(); } catch (error) { notify.error(error); } finally { setSaving(false); }
  };

  const onSubmit = async (data) => {
    setSaving(true);
    try {
      await crearAjuste(data);
      notify.success("Ajuste registrado");
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
    { field: "fecha", headerName: "Fecha", renderCell: (r) => formatoFecha(r.fecha) },
    { field: "ingrediente_nombre", headerName: "Ingrediente", minWidth: 160 },
    {
      field: "tipo",
      headerName: "Tipo",
      align: "center",
      renderCell: (r) => <StatusChip label={LABEL_TIPO[r.tipo] || r.tipo} tone={TONO_TIPO[r.tipo] || "default"} />,
    },
    { field: "cantidad_base", headerName: "Cantidad", align: "right", renderCell: (r) => formatoNumero(Math.abs(r.cantidad_base)) },
    { field: "motivo", headerName: "Motivo", minWidth: 200 },
    { field: "usuario_nombre", headerName: "Registrado por" },
  ];

  return (
    <Box>
      <PageHeader
        title="Ajustes de inventario"
        subtitle="Mermas, uso externo o sobras encontradas en conteo físico."
        actionLabel={puedeEscribir ? "Nuevo ajuste" : null}
        onAction={abrirNuevo}
      />
      {puedeEscribir && <Stack direction="row" justifyContent="flex-end" sx={{ mb: 2 }}><Button variant="outlined" onClick={abrirInventarioInicial}>Registrar inventario inicial</Button></Stack>}

      <DataTable columns={columns} rows={rows} loading={loading} searchPlaceholder="Buscar por ingrediente o motivo…" defaultOrderBy="fecha" defaultOrder="desc" />

      <FormDialog open={dialogOpen} onClose={() => setDialogOpen(false)} title="Nuevo ajuste de inventario">
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
                name="tipo"
                control={control}
                render={({ field }) => (
                  <TextField {...field} select label="Tipo de ajuste" fullWidth error={!!errors.tipo} helperText={errors.tipo?.message}>
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
                label="Cantidad (unidad base)"
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
      <FormDialog open={dialogInventarioInicial} onClose={() => setDialogInventarioInicial(false)} title="Registrar inventario inicial"><Stack spacing={2}><TextField select required label="Ingrediente" value={inventarioInicial.ingrediente_id} onChange={(e) => setInventarioInicial({ ...inventarioInicial, ingrediente_id: e.target.value })}><MenuItem value="">Selecciona…</MenuItem>{ingredientes.map((ingrediente) => <MenuItem key={ingrediente.id} value={ingrediente.id}>{ingrediente.nombre} ({ingrediente.unidad_base})</MenuItem>)}</TextField><TextField required type="number" inputProps={{ min: 0.0001, step: "any" }} label="Cantidad actual (unidad base)" value={inventarioInicial.cantidad} onChange={(e) => setInventarioInicial({ ...inventarioInicial, cantidad: e.target.value })} /><TextField required type="number" inputProps={{ min: 0.01, step: "0.01" }} label="Costo total que pagaste (S/)" value={inventarioInicial.costo_total} onChange={(e) => setInventarioInicial({ ...inventarioInicial, costo_total: e.target.value })} helperText="No crea una compra, deuda ni salida de dinero." /><TextField required type="date" label="Fecha de corte" InputLabelProps={{ shrink: true }} value={inventarioInicial.fecha} onChange={(e) => setInventarioInicial({ ...inventarioInicial, fecha: e.target.value })} /><TextField required label="Motivo" value={inventarioInicial.motivo} onChange={(e) => setInventarioInicial({ ...inventarioInicial, motivo: e.target.value })} /><Stack direction="row" justifyContent="flex-end" spacing={1}><Button onClick={() => setDialogInventarioInicial(false)}>Cancelar</Button><Button variant="contained" disabled={saving} onClick={guardarInventarioInicial}>{saving ? "Guardando…" : "Registrar"}</Button></Stack></Stack></FormDialog>
    </Box>
  );
}
