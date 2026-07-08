import { Stack, Box, Typography, Button } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";

export default function PageHeader({ title, subtitle, actionLabel, onAction, actionIcon = <AddIcon />, extra = null }) {
  return (
    <Stack
      direction={{ xs: "column", sm: "row" }}
      spacing={2}
      alignItems={{ sm: "center" }}
      justifyContent="space-between"
      sx={{ mb: 3 }}
    >
      <Box>
        <Typography variant="h5">{title}</Typography>
        {subtitle && (
          <Typography variant="body2" color="text.secondary">
            {subtitle}
          </Typography>
        )}
      </Box>
      <Stack direction="row" spacing={1.5} alignItems="center">
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
