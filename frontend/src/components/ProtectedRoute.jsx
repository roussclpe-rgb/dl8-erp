import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { Box, Typography } from "@mui/material";

export default function ProtectedRoute({ children, roles = null }) {
  const { isAuthenticated, hasRole } = useAuth();
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (roles && !hasRole(...roles)) {
    return (
      <Box sx={{ p: 6, textAlign: "center" }}>
        <Typography variant="h6">No tienes permiso para ver esta sección.</Typography>
        <Typography variant="body2" color="text.secondary">
          Esta acción requiere rol: {roles.join(" o ")}.
        </Typography>
      </Box>
    );
  }

  return children;
}
