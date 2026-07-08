import { useEffect, useState, useCallback } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Box, Grid, TextField, MenuItem, Button, Stack, Alert } from "@mui/material";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";

import PageHeader from "../components/PageHeader";
import DataTable from "../components/DataTable";
import ConfirmDialog from "../components/ConfirmDialog";
import StatusChip from "../components/StatusChip";
import { useAuth } from "../context/AuthContext";
import { useNotify } from "../hooks/useNotify";
import { formatoFecha } from "../utils/format";
import { listarPeriodos, cerrarPeriodo } from "../api/endpoints";

const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

const schema = z.object({
  anio: z.coerce.number().int().min(2000).max(2100),
  mes: z.coerce.number().int().min(1).max(12),
});

export default function PeriodosPage() {
  const { hasRole } = useAuth();
  const notify = useNotify();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [closing, setClosing] = useState(false);

  const now = new Date();
  const {
    control,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm({ resolver: zodResolver(schema), defaultValues: { anio: now.getFullYear(), mes: now.getMonth() + 1 } });
  const anio = watch("anio");
  const mes = watch("mes");

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await listarPeriodos());
    } catch (e) {
      notify.error(e);
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const onConfirmarCierre = async () => {
    setClosing(true);
    try {
      await cerrarPeriodo(anio, mes);
      notify.success(`Periodo ${mes}/${anio} cerrado`);
      setConfirmOpen(false);
      cargar();
    } catch (e) {
      notify.error(e);
    } finally {
      setClosing(false);
    }
  };

  const puedeCerrar = hasRole("admin");

  const columns = [
    { field: "mes", headerName: "Mes", renderCell: (r) => MESES[r.mes - 1] },
    { field: "anio", headerName: "Año" },
    {
      field: "estado",
      headerName: "Estado",
      align: "center",
      renderCell: (r) => (r.estado === "cerrado" ? <StatusChip label="Cerrado" tone="error" /> : <StatusChip label="Abierto" tone="success" />),
    },
    { field: "cerrado_en", headerName: "Cerrado el", renderCell: (r) => (r.cerrado_en ? formatoFecha(r.cerrado_en) : "—") },
  ];

  return (
    <Box>
      <PageHeader title="Periodos contables" subtitle="Cierra un periodo para bloquear ediciones sobre su historial." />

      {puedeCerrar && (
        <Box component="form" onSubmit={handleSubmit(() => setConfirmOpen(true))} noValidate sx={{ mb: 3 }}>
          <Alert severity="warning" sx={{ mb: 2 }}>
            Cerrar un periodo es una acción administrativa: ninguna compra, producción o ajuste con fecha dentro de él podrá editarse después.
          </Alert>
          <Grid container spacing={2} alignItems="center">
            <Grid item xs={6} sm={3}>
              <Controller
                name="mes"
                control={control}
                render={({ field }) => (
                  <TextField {...field} select label="Mes" fullWidth size="small" error={!!errors.mes}>
                    {MESES.map((m, i) => (
                      <MenuItem key={m} value={i + 1}>
                        {m}
                      </MenuItem>
                    ))}
                  </TextField>
                )}
              />
            </Grid>
            <Grid item xs={6} sm={3}>
              <Controller
                name="anio"
                control={control}
                render={({ field }) => <TextField {...field} type="number" label="Año" fullWidth size="small" error={!!errors.anio} />}
              />
            </Grid>
            <Grid item xs={12} sm={3}>
              <Button type="submit" variant="contained" color="error" startIcon={<LockOutlinedIcon />}>
                Cerrar periodo
              </Button>
            </Grid>
          </Grid>
        </Box>
      )}

      <DataTable columns={columns} rows={rows} loading={loading} searchable={false} defaultOrderBy="anio" defaultOrder="desc" />

      <ConfirmDialog
        open={confirmOpen}
        title="Cerrar periodo"
        message={`¿Confirmas cerrar el periodo ${MESES[mes - 1]} ${anio}? Esta acción es irreversible desde la app.`}
        confirmText="Sí, cerrar periodo"
        danger
        loading={closing}
        onClose={() => setConfirmOpen(false)}
        onConfirm={onConfirmarCierre}
      />
    </Box>
  );
}
