import { Skeleton, Stack } from "@mui/material";

export default function ContentSkeleton({ lines = 4, compact = false }) {
  return <Stack spacing={1.25} sx={{ p: compact ? 2 : 2.5 }} aria-label="Cargando contenido">
    {Array.from({ length: lines }, (_, index) => <Skeleton key={index} animation="wave" variant="rounded" height={index === 0 ? 28 : 18} width={index === 0 ? "42%" : index === lines - 1 ? "72%" : "100%"} />)}
  </Stack>;
}
