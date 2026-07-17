import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useNavigate, useLocation } from "react-router-dom";
import { Box, Paper, Stack, TextField, Button, Typography, InputAdornment, IconButton, CircularProgress } from "@mui/material";
import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import BakeryDiningIcon from "@mui/icons-material/BakeryDiningOutlined";
import MailOutlineIcon from "@mui/icons-material/MailOutline";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import { useAuth } from "../context/AuthContext";
import { useNotify } from "../hooks/useNotify";

const schema = z.object({
  email: z.string().min(1, "El email es obligatorio").email("Email inválido"),
  password: z.string().min(1, "La contraseña es obligatoria"),
});

export default function Login() {
  const { login } = useAuth();
  const notify = useNotify();
  const navigate = useNavigate();
  const location = useLocation();
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const { register, handleSubmit, formState: { errors } } = useForm({ resolver: zodResolver(schema), defaultValues: { email: "", password: "" } });

  const onSubmit = async (data) => {
    setLoading(true);
    try {
      await login(data.email, data.password);
      navigate(location.state?.from?.pathname || "/", { replace: true });
    } catch (error) {
      notify.error(error);
    } finally {
      setLoading(false);
    }
  };

  return <Box sx={{ minHeight: "100vh", display: "grid", placeItems: "center", p: { xs: 2, sm: 3 }, overflow: "hidden", position: "relative", bgcolor: "background.default", "&::before": { content: '""', position: "absolute", inset: 0, background: "radial-gradient(circle at 12% 12%, rgba(91,91,214,.17), transparent 29%), radial-gradient(circle at 90% 84%, rgba(14,147,132,.14), transparent 26%)", pointerEvents: "none" } }}>
    <Paper variant="outlined" sx={{ width: "100%", maxWidth: 440, p: { xs: 3, sm: 4.5 }, borderRadius: 4, position: "relative", boxShadow: "0 24px 70px rgba(25,34,55,.1)" }}>
      <Stack spacing={1.5} sx={{ mb: 4 }}>
        <Box sx={{ width: 48, height: 48, display: "grid", placeItems: "center", borderRadius: 2.5, bgcolor: "primary.main", color: "primary.contrastText", boxShadow: "0 8px 20px rgba(91,91,214,.25)" }}><BakeryDiningIcon /></Box>
        <Box><Typography variant="h4">Bienvenido a DL8</Typography><Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>Ingresa para continuar con la operación de tu negocio.</Typography></Box>
      </Stack>
      <Box component="form" onSubmit={handleSubmit(onSubmit)} noValidate>
        <Stack spacing={2.25}>
          <TextField label="Correo electrónico" fullWidth autoFocus autoComplete="email" {...register("email")} error={!!errors.email} helperText={errors.email?.message} InputProps={{ startAdornment: <InputAdornment position="start"><MailOutlineIcon fontSize="small" /></InputAdornment> }} />
          <TextField label="Contraseña" type={showPassword ? "text" : "password"} fullWidth autoComplete="current-password" {...register("password")} error={!!errors.password} helperText={errors.password?.message} InputProps={{ startAdornment: <InputAdornment position="start"><LockOutlinedIcon fontSize="small" /></InputAdornment>, endAdornment: <InputAdornment position="end"><IconButton onClick={() => setShowPassword((value) => !value)} edge="end" size="small" aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}>{showPassword ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}</IconButton></InputAdornment> }} />
          <Button type="submit" variant="contained" size="large" disabled={loading} startIcon={loading ? <CircularProgress size={18} color="inherit" /> : null}>{loading ? "Ingresando…" : "Iniciar sesión"}</Button>
        </Stack>
      </Box>
    </Paper>
  </Box>;
}
