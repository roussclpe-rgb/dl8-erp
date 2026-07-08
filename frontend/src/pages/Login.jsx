import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useNavigate, useLocation } from "react-router-dom";
import {
  Box,
  Paper,
  Stack,
  TextField,
  Button,
  Typography,
  InputAdornment,
  IconButton,
  CircularProgress,
  Avatar,
} from "@mui/material";
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

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({ resolver: zodResolver(schema), defaultValues: { email: "", password: "" } });

  const onSubmit = async (data) => {
    setLoading(true);
    try {
      await login(data.email, data.password);
      const destino = location.state?.from?.pathname || "/";
      navigate(destino, { replace: true });
    } catch (e) {
      notify.error(e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box
      sx={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        p: 2,
        background:
          "radial-gradient(circle at 20% 20%, rgba(79,70,229,0.15), transparent 40%), radial-gradient(circle at 80% 80%, rgba(20,184,166,0.15), transparent 40%), #F4F5F9",
      }}
    >
      <Paper elevation={0} variant="outlined" sx={{ width: "100%", maxWidth: 420, p: 4, borderRadius: 4 }}>
        <Stack alignItems="center" spacing={1.5} sx={{ mb: 3 }}>
          <Avatar sx={{ bgcolor: "primary.main", width: 52, height: 52 }}>
            <BakeryDiningIcon />
          </Avatar>
          <Typography variant="h5" sx={{ fontWeight: 700 }}>
            DL8
          </Typography>
          <Typography variant="body2" color="text.secondary" textAlign="center">
            Inicia sesión para gestionar inventario, producción y costos.
          </Typography>
        </Stack>

        <Box component="form" onSubmit={handleSubmit(onSubmit)} noValidate>
          <Stack spacing={2.5}>
            <TextField
              label="Correo electrónico"
              fullWidth
              autoFocus
              {...register("email")}
              error={!!errors.email}
              helperText={errors.email?.message}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <MailOutlineIcon fontSize="small" />
                  </InputAdornment>
                ),
              }}
            />
            <TextField
              label="Contraseña"
              type={showPassword ? "text" : "password"}
              fullWidth
              {...register("password")}
              error={!!errors.password}
              helperText={errors.password?.message}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <LockOutlinedIcon fontSize="small" />
                  </InputAdornment>
                ),
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton onClick={() => setShowPassword((s) => !s)} edge="end" size="small">
                      {showPassword ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
                    </IconButton>
                  </InputAdornment>
                ),
              }}
            />
            <Button
              type="submit"
              variant="contained"
              size="large"
              disabled={loading}
              startIcon={loading ? <CircularProgress size={18} color="inherit" /> : null}
            >
              {loading ? "Ingresando…" : "Iniciar sesión"}
            </Button>
          </Stack>
        </Box>
      </Paper>
    </Box>
  );
}
