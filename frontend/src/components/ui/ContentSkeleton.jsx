import { Skeleton, Stack } from "@mui/material";

export default function ContentSkeleton({ lines = 4 }) {
  return <Stack spacing={1.25} sx={{ p: 2.5 }}>{Array.from({ length: lines }, (_, index) => <Skeleton key={index} variant="rounded" height={index === 0 ? 30 : 18} width={index === 0 ? "46%" : "100%"} />)}</Stack>;
}
