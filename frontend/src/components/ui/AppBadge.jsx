import { Chip } from "@mui/material";

const tones = { neutral: "default", info: "info", success: "success", warning: "warning", danger: "error" };

export default function AppBadge({ label, tone = "neutral" }) {
  return <Chip label={label} size="small" color={tones[tone] || "default"} variant={tone === "neutral" ? "outlined" : "filled"} />;
}
