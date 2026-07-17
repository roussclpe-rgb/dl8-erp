import { Box, Button, CircularProgress, Stack, Typography } from "@mui/material";
import InboxOutlinedIcon from "@mui/icons-material/InboxOutlined";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";

/** Estado reutilizable para vistas sin datos, en carga o con un error recuperable. */
export default function PageState({ type = "empty", title, description, actionLabel, onAction, icon }) {
  const loading = type === "loading";
  const error = type === "error";
  const visual = icon || (loading ? <CircularProgress size={28} /> : error ? <ErrorOutlineIcon /> : <InboxOutlinedIcon />);
  return <Box sx={{ border: "1px dashed", borderColor: error ? "error.main" : "divider", borderRadius: 3, px: 3, py: { xs: 5, sm: 7 }, bgcolor: error ? "error.light" : "transparent", textAlign: "center" }}>
    <Stack alignItems="center" spacing={1.25}>
      <Box sx={{ width: 44, height: 44, display: "grid", placeItems: "center", borderRadius: 2, color: error ? "error.main" : "primary.main", bgcolor: error ? "rgba(217,65,65,.1)" : "primary.light" }}>{visual}</Box>
      <Box><Typography variant="subtitle1">{title || (loading ? "Cargando información" : error ? "No fue posible cargar esta información" : "Aún no hay información")}</Typography>{description && <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, maxWidth: 420 }}>{description}</Typography>}</Box>
      {actionLabel && <Button size="small" variant={error ? "contained" : "outlined"} onClick={onAction}>{actionLabel}</Button>}
    </Stack>
  </Box>;
}
