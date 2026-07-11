import { Box, Skeleton, Stack, Typography } from "@mui/material";
import AppCard from "./AppCard";

const tones = {
  indigo: { bg: "primary.light", color: "primary.main" },
  teal: { bg: "secondary.light", color: "secondary.main" },
  green: { bg: "success.light", color: "success.main" },
  amber: { bg: "warning.light", color: "warning.main" },
  red: { bg: "error.light", color: "error.main" },
  slate: { bg: "action.hover", color: "text.secondary" },
};

export default function MetricCard({ label, value, helper, icon, tone = "indigo", loading = false, unavailable = false }) {
  const color = tones[tone] || tones.indigo;
  return (
    <AppCard sx={{ height: "100%" }}>
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" sx={{ p: 2.25 }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="body2" color="text.secondary" noWrap>{label}</Typography>
          {loading ? <Skeleton width={104} height={42} /> : <Typography variant="h5" sx={{ mt: 0.5, letterSpacing: "-0.03em" }} noWrap>{unavailable ? "—" : value}</Typography>}
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>{unavailable ? "Disponible al integrar datos" : helper}</Typography>
        </Box>
        <Box sx={{ display: "grid", placeItems: "center", width: 42, height: 42, flexShrink: 0, borderRadius: 2, bgcolor: color.bg, color: color.color }}>
          {icon}
        </Box>
      </Stack>
    </AppCard>
  );
}
