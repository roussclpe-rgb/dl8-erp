import { Chip } from "@mui/material";

const VARIANTES = {
  success: { color: "success" },
  warning: { color: "warning" },
  error: { color: "error" },
  default: { color: "default" },
  info: { color: "info" },
};

export default function StatusChip({ label, tone = "default", size = "small" }) {
  const variante = VARIANTES[tone] || VARIANTES.default;
  return <Chip label={label} color={variante.color} size={size} variant={tone === "default" ? "outlined" : "filled"} />;
}
