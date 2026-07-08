import { Box, Typography } from "@mui/material";

export default function EmptyState({ icon, title, subtitle }) {
  return (
    <Box sx={{ textAlign: "center", py: 6, color: "text.secondary" }}>
      {icon}
      <Typography variant="subtitle1" sx={{ mt: 1 }}>
        {title}
      </Typography>
      {subtitle && <Typography variant="body2">{subtitle}</Typography>}
    </Box>
  );
}
