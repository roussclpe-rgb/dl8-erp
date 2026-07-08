import { Paper, Stack, Box, Typography, Skeleton } from "@mui/material";

const PALETTE = {
  primary: { bg: "rgba(79,70,229,0.12)", fg: "#4F46E5" },
  secondary: { bg: "rgba(20,184,166,0.12)", fg: "#0F9C8C" },
  success: { bg: "rgba(22,163,74,0.12)", fg: "#16A34A" },
  warning: { bg: "rgba(217,119,6,0.12)", fg: "#D97706" },
  error: { bg: "rgba(220,38,38,0.12)", fg: "#DC2626" },
  info: { bg: "rgba(37,99,235,0.12)", fg: "#2563EB" },
};

export default function KpiCard({ title, value, subtitle, icon, color = "primary", loading = false }) {
  const palette = PALETTE[color] || PALETTE.primary;

  return (
    <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 3, height: "100%" }}>
      <Stack direction="row" spacing={2} alignItems="flex-start">
        <Box
          sx={{
            width: 44,
            height: 44,
            borderRadius: 2.5,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            bgcolor: palette.bg,
            color: palette.fg,
            flexShrink: 0,
          }}
        >
          {icon}
        </Box>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography variant="body2" color="text.secondary" noWrap>
            {title}
          </Typography>
          {loading ? (
            <Skeleton width={80} height={32} />
          ) : (
            <Typography variant="h5" sx={{ fontWeight: 700, mt: 0.25 }} noWrap>
              {value}
            </Typography>
          )}
          {subtitle && (
            <Typography variant="caption" color="text.secondary">
              {subtitle}
            </Typography>
          )}
        </Box>
      </Stack>
    </Paper>
  );
}
