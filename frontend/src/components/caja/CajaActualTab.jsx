import { useEffect, useState, useCallback } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Box,
  Grid,
  TextField,
  MenuItem,
  Button,
  Stack,
  Paper,
  Typography,
  Chip,
  Alert,
  Divider,
} from "@mui/material";
import LockOpenIcon from "@mui/icons-material/LockOpenOutlined";
import LockIcon from "@mui/icons-material/LockOutlined";
import AddIcon from "@mui/icons-material/Add";

import DataTable from "../DataTable";
import FormDialog from "../FormDialog";
import StatusChip from "../StatusChip";
import KpiCard from "../KpiCard";
import { useAuth } from "../../context/AuthContext";
import { useNotify } from "../../hooks/useNotify";
import { useCajaActiva } from "../../hooks/useCajaActiva";
import { formatoMoneda, formatoFecha } from "../../utils/format";
import { listarCajas, abrirCaja, cerrarTurnoCaja, registrarMovimientoCaja } from "../../api/endpoints";

const METODOS_PAGO = ["Efectivo", "Yape", "Transferencia", "Tarjeta"];

const schemaApertura = z.object({
  monto_apertura: z.coerce.number().min(0, "Debe ser 0 o mayor"),
  notas: z.string().optional(),
});

const schemaCierre = z.object({
  monto_contado: z.coerce.number().min(0, "Debe ser 0 o mayor"),
  notas: z.string().optional(),
});

const schemaMovimiento = z.object({
  tipo: z.enum(["ingreso", "egreso"], { errorMap: () => ({ message: "Selecciona un tipo" }) }),
  monto: z.coerce.number().positive("Debe ser mayor a 0"),
  metodo_pago: z.string().min(1),
  motivo: z.string().min(1, "El motivo es obligatorio"),
});

const TIPO_LABEL = { apertura: "Apertura", venta: "Venta", cobro: "Cobro", ingreso: "Ingreso", egreso: "Egreso", cierre: "Cierre" };
const TIPO_TONO = { apertura: "info", venta: "success", cobro: "success", ingreso: "success", egreso: "warning", cierre: "default" };

export default function CajaActualTab() {
  const { hasRole } = useAuth();
  const notify = useNotify();
  const { cajaId, setCajaId, turno, loading, refrescar } = useCajaActiva();

  const [cajas, setCajas] = useState([]);
  const [dialogApertura, setDialogApertura] = useState(false);
  const [dialogCierre, setDialogCierre] = useState(false);
  const [dialogMovimiento, setDialogMovimiento] = useState(false);
  const [saving, setSaving] = useState(false);

  const formApertura = useForm({ resolver: zodResolver(schemaApertura), defaultValues: { monto_apertura: "", notas: "" } });
  const formCierre = useForm({ resolver: zodResolver(schemaCierre), defaultValues: { monto_contado: "", notas: "" } });
  const formMovimiento = useForm({
    resolver: zodResolver(schemaMovimiento),
    defaultValues: { tipo: "ingreso", monto: "", metodo_pago: "Efectivo", motivo: "" },
  });

  const cargarCajas = useCallback(async () => {
    try {
      const data = await listarCajas();
      setCajas(data);
      if (!cajaId && data.length > 0) setCajaId(data[0].id);
    } catch (e) {
      notify.error(e);
    }
  }, [notify, cajaId, setCajaId]);

  useEffect(() => {
    cargarCajas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const puedeOperar = hasRole("admin", "operador", "vendedor");
  const cajaSeleccionada = cajas.find((c) => c.id === cajaId);

  const onAbrir = async (data) => {
    setSaving(true);
    try {
      await abrirCaja(cajaId, data);
      notify.success("Caja abierta");
      setDialogApertura(false);
      formApertura.reset({ monto_apertura: "", notas: "" });
      refrescar();
      cargarCajas();
    } catch (e) {
      notify.error(e);
    } finally {
      setSaving(false);
    }
  };

  const onCerrar = async (data) => {
    setSaving(true);
    try {
      const resultado = await cerrarTurnoCaja(turno.id, data);
      const dif = resultado.diferencia;
      if (Math.abs(dif) < 0.01) {
        notify.success("Caja cerrada sin diferencias");
      } else if (dif > 0) {
        notify.warning(`Caja cerrada con sobrante de ${formatoMoneda(dif)}`);
      } else {
        notify.warning(`Caja cerrada con faltante de ${formatoMoneda(Math.abs(dif))}`);
      }
      setDialogCierre(false);
      formCierre.reset({ monto_contado: "", notas: "" });
      refrescar();
      cargarCajas();
    } catch (e) {
      notify.error(e);
    } finally {
      setSaving(false);
    }
  };

  const onMovimiento = async (data) => {
    setSaving(true);
    try {
      await registrarMovimientoCaja({ ...data, turno_id: turno.id });
      notify.success(data.tipo === "ingreso" ? "Ingreso registrado" : "Egreso registrado");
      setDialogMovimiento(false);
      formMovimiento.reset({ tipo: "ingreso", monto: "", metodo_pago: "Efectivo", motivo: "" });
      refrescar();
    } catch (e) {
      notify.error(e);
    } finally {
      setSaving(false);
    }
  };

  const columns = [
    { field: "fecha", headerName: "Fecha", renderCell: (r) => formatoFecha(r.fecha) },
    { field: "tipo", headerName: "Tipo", renderCell: (r) => <StatusChip label={TIPO_LABEL[r.tipo] || r.tipo} tone={TIPO_TONO[r.tipo] || "default"} /> },
    { field: "metodo_pago", headerName: "Método", renderCell: (r) => r.metodo_pago || "—" },
    {
      field: "monto",
      headerName: "Monto",
      align: "right",
      renderCell: (r) => (
        <Typography variant="body2" color={r.monto < 0 ? "error.main" : "success.main"} sx={{ fontWeight: 600 }}>
          {r.monto < 0 ? "-" : "+"}
          {formatoMoneda(Math.abs(r.monto))}
        </Typography>
      ),
    },
    { field: "motivo", headerName: "Motivo", minWidth: 200, renderCell: (r) => r.motivo || "—" },
    { field: "usuario_nombre", headerName: "Registrado por" },
  ];

  return (
    <Box>
      <Grid container spacing={2} alignItems="center" sx={{ mb: 3 }}>
        <Grid item xs={12} sm={5}>
          <TextField
            select
            label="Caja"
            fullWidth
            value={cajaId || ""}
            onChange={(e) => setCajaId(Number(e.target.value))}
          >
            {cajas.length === 0 && (
              <MenuItem disabled value="">
                No hay cajas registradas
              </MenuItem>
            )}
            {cajas.map((c) => (
              <MenuItem key={c.id} value={c.id}>
                {c.nombre}
              </MenuItem>
            ))}
          </TextField>
        </Grid>
        <Grid item xs={12} sm={7}>
          {turno ? (
            <Chip icon={<LockOpenIcon />} label="Turno abierto" color="success" variant="filled" />
          ) : (
            <Chip icon={<LockIcon />} label="Sin turno abierto" color="default" variant="outlined" />
          )}
        </Grid>
      </Grid>

      {!cajaId && cajas.length === 0 && (
        <Alert severity="info">
          Todavía no hay cajas registradas. Pide a un administrador que cree una en "Nueva caja".
        </Alert>
      )}

      {cajaId && !loading && !turno && (
        <Paper variant="outlined" sx={{ p: 3, borderRadius: 3, textAlign: "center" }}>
          <Typography variant="subtitle1" sx={{ mb: 1 }}>
            {cajaSeleccionada?.nombre} está cerrada
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Abre un turno para empezar a registrar ventas, cobros e ingresos/egresos en esta caja.
          </Typography>
          {puedeOperar && (
            <Button variant="contained" startIcon={<LockOpenIcon />} onClick={() => setDialogApertura(true)}>
              Abrir caja
            </Button>
          )}
        </Paper>
      )}

      {turno && (
        <>
          <Grid container spacing={2.5} sx={{ mb: 3 }}>
            <Grid item xs={12} sm={6} md={3}>
              <KpiCard title="Efectivo esperado" value={formatoMoneda(turno.efectivoEsperado)} color="primary" />
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <KpiCard title="Total ingresos" value={formatoMoneda(turno.totalIngresos)} color="success" />
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <KpiCard title="Total egresos" value={formatoMoneda(turno.totalEgresos)} color="warning" />
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <KpiCard
                title="Apertura"
                value={formatoMoneda(turno.monto_apertura)}
                subtitle={formatoFecha(turno.fecha_apertura)}
                color="info"
              />
            </Grid>
          </Grid>

          {Object.keys(turno.porMetodo || {}).length > 0 && (
            <Paper variant="outlined" sx={{ p: 2, mb: 3, borderRadius: 3 }}>
              <Typography variant="subtitle2" sx={{ mb: 1.5 }}>
                Movimientos por método de pago
              </Typography>
              <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
                {Object.entries(turno.porMetodo).map(([metodo, monto]) => (
                  <Chip key={metodo} label={`${metodo}: ${formatoMoneda(monto)}`} variant="outlined" />
                ))}
              </Stack>
            </Paper>
          )}

          {puedeOperar && (
            <Stack direction="row" spacing={1.5} sx={{ mb: 2 }}>
              <Button variant="outlined" startIcon={<AddIcon />} onClick={() => setDialogMovimiento(true)}>
                Ingreso / egreso
              </Button>
              <Button variant="contained" color="error" startIcon={<LockIcon />} onClick={() => setDialogCierre(true)}>
                Cerrar caja
              </Button>
            </Stack>
          )}

          <DataTable
            columns={columns}
            rows={turno.movimientos || []}
            searchPlaceholder="Buscar por motivo…"
            defaultOrderBy="fecha"
            defaultOrder="desc"
            emptyMessage="Sin movimientos en este turno todavía."
          />
        </>
      )}

      {/* Apertura */}
      <FormDialog open={dialogApertura} onClose={() => setDialogApertura(false)} title={`Abrir ${cajaSeleccionada?.nombre || "caja"}`}>
        <Box component="form" onSubmit={formApertura.handleSubmit(onAbrir)} noValidate>
          <Grid container spacing={2}>
            <Grid item xs={12}>
              <TextField
                label="Monto inicial en efectivo"
                type="number"
                fullWidth
                autoFocus
                inputProps={{ step: "0.01" }}
                {...formApertura.register("monto_apertura")}
                error={!!formApertura.formState.errors.monto_apertura}
                helperText={formApertura.formState.errors.monto_apertura?.message}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField label="Notas (opcional)" fullWidth multiline minRows={2} {...formApertura.register("notas")} />
            </Grid>
          </Grid>
          <Stack direction="row" justifyContent="flex-end" spacing={1.5} sx={{ mt: 3 }}>
            <Button onClick={() => setDialogApertura(false)} color="inherit">
              Cancelar
            </Button>
            <Button type="submit" variant="contained" disabled={saving}>
              {saving ? "Abriendo…" : "Abrir caja"}
            </Button>
          </Stack>
        </Box>
      </FormDialog>

      {/* Movimiento manual */}
      <FormDialog open={dialogMovimiento} onClose={() => setDialogMovimiento(false)} title="Nuevo ingreso / egreso">
        <Box component="form" onSubmit={formMovimiento.handleSubmit(onMovimiento)} noValidate>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6}>
              <Controller
                name="tipo"
                control={formMovimiento.control}
                render={({ field }) => (
                  <TextField {...field} select label="Tipo" fullWidth>
                    <MenuItem value="ingreso">Ingreso</MenuItem>
                    <MenuItem value="egreso">Egreso</MenuItem>
                  </TextField>
                )}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <Controller
                name="metodo_pago"
                control={formMovimiento.control}
                render={({ field }) => (
                  <TextField {...field} select label="Método" fullWidth>
                    {METODOS_PAGO.map((m) => (
                      <MenuItem key={m} value={m}>
                        {m}
                      </MenuItem>
                    ))}
                  </TextField>
                )}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                label="Monto"
                type="number"
                fullWidth
                inputProps={{ step: "0.01" }}
                {...formMovimiento.register("monto")}
                error={!!formMovimiento.formState.errors.monto}
                helperText={formMovimiento.formState.errors.monto?.message}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                label="Motivo"
                fullWidth
                multiline
                minRows={2}
                {...formMovimiento.register("motivo")}
                error={!!formMovimiento.formState.errors.motivo}
                helperText={formMovimiento.formState.errors.motivo?.message}
              />
            </Grid>
          </Grid>
          <Stack direction="row" justifyContent="flex-end" spacing={1.5} sx={{ mt: 3 }}>
            <Button onClick={() => setDialogMovimiento(false)} color="inherit">
              Cancelar
            </Button>
            <Button type="submit" variant="contained" disabled={saving}>
              {saving ? "Guardando…" : "Guardar"}
            </Button>
          </Stack>
        </Box>
      </FormDialog>

      {/* Cierre */}
      <FormDialog open={dialogCierre} onClose={() => setDialogCierre(false)} title="Cerrar caja — arqueo">
        <Box component="form" onSubmit={formCierre.handleSubmit(onCerrar)} noValidate>
          {turno && (
            <Alert severity="info" sx={{ mb: 2 }}>
              Efectivo esperado según el sistema: <strong>{formatoMoneda(turno.efectivoEsperado)}</strong>. Cuenta el
              efectivo físico e ingrésalo abajo.
            </Alert>
          )}
          <Grid container spacing={2}>
            <Grid item xs={12}>
              <TextField
                label="Efectivo contado"
                type="number"
                fullWidth
                autoFocus
                inputProps={{ step: "0.01" }}
                {...formCierre.register("monto_contado")}
                error={!!formCierre.formState.errors.monto_contado}
                helperText={formCierre.formState.errors.monto_contado?.message}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField label="Notas del cierre (opcional)" fullWidth multiline minRows={2} {...formCierre.register("notas")} />
            </Grid>
          </Grid>
          <Divider sx={{ my: 2 }} />
          <Stack direction="row" justifyContent="flex-end" spacing={1.5}>
            <Button onClick={() => setDialogCierre(false)} color="inherit">
              Cancelar
            </Button>
            <Button type="submit" variant="contained" color="error" disabled={saving}>
              {saving ? "Cerrando…" : "Confirmar cierre"}
            </Button>
          </Stack>
        </Box>
      </FormDialog>
    </Box>
  );
}
