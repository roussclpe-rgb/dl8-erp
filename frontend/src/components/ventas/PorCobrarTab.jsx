import { useEffect, useState, useCallback } from "react";
import { useForm, useFieldArray, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Box, Grid, TextField, Button, Stack, IconButton, Tooltip, MenuItem, Chip } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/DeleteOutline";
import PaymentIcon from "@mui/icons-material/PaymentsOutlined";

import DataTable from "../DataTable";
import FormDialog from "../FormDialog";
import { useAuth } from "../../context/AuthContext";
import { useNotify } from "../../hooks/useNotify";
import { listarVentasPendientes, registrarPago } from "../../api/endpoints";

const METODOS_PAGO = ["Efectivo", "Yape", "Transferencia", "Tarjeta"];

const schema = z.object({
  pagos: z
    .array(
      z.object({
        monto: z.coerce.number().positive("Monto inválido"),
        metodoPago: z.string().min(1),
      })
    )
    .min(1, "Agrega al menos un pago"),
});

export default function PorCobrarTab() {
  const { hasRole } = useAuth();
  const notify = useNotify();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [cobrando, setCobrando] = useState(null); // venta seleccionada para cobrar
  const [saving, setSaving] = useState(false);

  const { control, register, handleSubmit, reset, formState: { errors } } = useForm({
    resolver: zodResolver(schema),
    defaultValues: { pagos: [{ monto: "", metodoPago: "Efectivo" }] },
  });
  const pagosArray = useFieldArray({ control, name: "pagos" });

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await listarVentasPendientes());
    } catch (e) {
      notify.error(e);
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const abrirCobro = (venta) => {
    setCobrando(venta);
    reset({ pagos: [{ monto: venta.saldo, metodoPago: "Efectivo" }] });
  };

  const onSubmit = async (data) => {
    setSaving(true);
    try {
      await registrarPago(cobrando.id, data.pagos);
      notify.success("Cobro registrado");
      setCobrando(null);
      cargar();
    } catch (e) {
      notify.error(e);
    } finally {
      setSaving(false);
    }
  };

  const puedeCobrar = hasRole("admin", "operador", "vendedor");

  const columns = [
    { field: "folio", headerName: "Folio", minWidth: 80 },
    { field: "fecha", headerName: "Fecha" },
    { field: "cliente_nombre", headerName: "Cliente", minWidth: 160 },
    { field: "total", headerName: "Total", renderCell: (r) => `S/ ${r.total.toFixed(2)}` },
    { field: "saldo", headerName: "Saldo", renderCell: (r) => <Chip size="small" color="warning" label={`S/ ${r.saldo.toFixed(2)}`} /> },
    {
      field: "acciones",
      headerName: "Acciones",
      align: "right",
      sortable: false,
      renderCell: (r) =>
        puedeCobrar && (
          <Tooltip title="Registrar cobro">
            <IconButton size="small" color="primary" onClick={() => abrirCobro(r)}>
              <PaymentIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        ),
    },
  ];

  return (
    <Box>
      <DataTable columns={columns} rows={rows} loading={loading} searchPlaceholder="Buscar venta…" defaultOrderBy="fecha" />

      <FormDialog open={!!cobrando} onClose={() => setCobrando(null)} title={`Cobrar venta — folio ${cobrando?.folio}`}>
        <Box component="form" onSubmit={handleSubmit(onSubmit)} noValidate>
          <Stack spacing={2}>
            {pagosArray.fields.map((field, index) => (
              <Grid container spacing={2} key={field.id} alignItems="center">
                <Grid item xs={6} sm={5}>
                  <TextField
                    label="Monto"
                    type="number"
                    fullWidth
                    inputProps={{ step: "0.01" }}
                    {...register(`pagos.${index}.monto`)}
                    error={!!errors.pagos?.[index]?.monto}
                    helperText={errors.pagos?.[index]?.monto?.message}
                  />
                </Grid>
                <Grid item xs={5} sm={5}>
                  <Controller
                    name={`pagos.${index}.metodoPago`}
                    control={control}
                    render={({ field: f }) => (
                      <TextField select label="Método" fullWidth {...f}>
                        {METODOS_PAGO.map((m) => (
                          <MenuItem key={m} value={m}>
                            {m}
                          </MenuItem>
                        ))}
                      </TextField>
                    )}
                  />
                </Grid>
                <Grid item xs={1}>
                  <IconButton size="small" onClick={() => pagosArray.remove(index)} disabled={pagosArray.fields.length === 1}>
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Grid>
              </Grid>
            ))}
          </Stack>
          <Button size="small" startIcon={<AddIcon />} onClick={() => pagosArray.append({ monto: "", metodoPago: "Efectivo" })} sx={{ mt: 1 }}>
            Agregar otro método
          </Button>

          <Stack direction="row" justifyContent="flex-end" spacing={1.5} sx={{ mt: 3 }}>
            <Button onClick={() => setCobrando(null)} color="inherit">
              Cancelar
            </Button>
            <Button type="submit" variant="contained" disabled={saving}>
              {saving ? "Guardando…" : "Registrar cobro"}
            </Button>
          </Stack>
        </Box>
      </FormDialog>
    </Box>
  );
}
