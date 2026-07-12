import { Box, Paper, Stack, Typography } from "@mui/material";

export default function AppCard({ title, subtitle, action, children, sx }) {
  return (
    <Paper variant="outlined" sx={{ borderRadius: 3, overflow: "hidden", ...sx }}>
      {(title || action) && (
        <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={2} sx={{ px: 2.5, pt: 2.25, pb: subtitle ? 0.75 : 1.5 }}>
          <Box>
            {title && <Typography variant="subtitle1">{title}</Typography>}
            {subtitle && <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>{subtitle}</Typography>}
          </Box>
          {action}
        </Stack>
      )}
      {children}
    </Paper>
  );
}
