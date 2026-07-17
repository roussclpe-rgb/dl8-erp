import { Stack, Box, Typography, Button } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";

export default function PageHeader({ title, subtitle, actionLabel, onAction, actionIcon = <AddIcon />, extra = null }) {
  return (
    <Stack
      direction={{ xs: "column", sm: "row" }}
      spacing={2}
      alignItems={{ sm: "center" }}
      justifyContent="space-between"
      sx={{ mb: { xs: 2.5, sm: 3.5 } }}
    >
      <Box>
        <Typography variant="h4">{title}</Typography>
        {subtitle && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75, maxWidth: 720 }}>
            {subtitle}
          </Typography>
        )}
      </Box>
      <Stack direction="row" spacing={1.25} alignItems="center" flexWrap="wrap" useFlexGap>
        {extra}
        {actionLabel && (
          <Button variant="contained" startIcon={actionIcon} onClick={onAction}>
            {actionLabel}
          </Button>
        )}
      </Stack>
    </Stack>
  );
}
