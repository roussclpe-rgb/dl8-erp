import { alpha, createTheme } from "@mui/material/styles";

const colors = {
  indigo: "#635BFF",
  teal: "#0F9F8C",
  ink: "#172033",
  muted: "#667085",
  border: "#E7EAF0",
  canvas: "#F7F8FA",
};

export function buildTheme(mode) {
  const light = mode === "light";
  const background = light ? { default: colors.canvas, paper: "#FFFFFF" } : { default: "#111827", paper: "#182230" };
  const text = light ? { primary: colors.ink, secondary: colors.muted } : { primary: "#F8FAFC", secondary: "#98A2B3" };
  const divider = light ? colors.border : "#293548";

  return createTheme({
    palette: {
      mode,
      primary: { main: colors.indigo, dark: "#4F46E5", light: "#EEEDFF", contrastText: "#FFFFFF" },
      secondary: { main: colors.teal, dark: "#0A7C6D", light: "#E7F8F4", contrastText: "#FFFFFF" },
      success: { main: "#12B76A", light: "#ECFDF3" },
      warning: { main: "#F79009", light: "#FFFAEB" },
      error: { main: "#F04438", light: "#FEF3F2" },
      info: { main: "#2E90FA", light: "#EFF8FF" },
      background,
      text,
      divider,
      action: { hover: light ? "#F2F4F7" : "#243044", selected: alpha(colors.indigo, light ? 0.1 : 0.22) },
    },
    shape: { borderRadius: 12 },
    spacing: 8,
    typography: {
      fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      h4: { fontWeight: 720, letterSpacing: "-0.035em" },
      h5: { fontWeight: 700, letterSpacing: "-0.025em" },
      h6: { fontWeight: 700, letterSpacing: "-0.02em" },
      subtitle1: { fontWeight: 650 },
      subtitle2: { fontWeight: 650 },
      button: { textTransform: "none", fontWeight: 650, letterSpacing: 0 },
    },
    components: {
      MuiCssBaseline: { styleOverrides: { body: { scrollbarWidth: "thin", fontFeatureSettings: '"cv02", "cv03", "cv04", "cv11"' }, "*": { boxSizing: "border-box" } } },
      MuiAppBar: { styleOverrides: { root: { backgroundColor: alpha(background.paper, 0.92), color: text.primary, boxShadow: "none", borderBottom: `1px solid ${divider}`, backdropFilter: "blur(12px)" } } },
      MuiDrawer: { styleOverrides: { paper: { backgroundColor: background.paper, borderRight: `1px solid ${divider}`, backgroundImage: "none" } } },
      MuiPaper: { styleOverrides: { root: { backgroundImage: "none" }, outlined: { borderColor: divider, boxShadow: light ? "0 1px 2px rgba(16,24,40,.02)" : "none" } } },
      MuiButton: { styleOverrides: { root: { borderRadius: 9, minHeight: 38, paddingInline: 15 }, contained: { boxShadow: "none", "&:hover": { boxShadow: "0 2px 5px rgba(79,70,229,.18)" } } } },
      MuiTextField: { defaultProps: { size: "small" } },
      MuiOutlinedInput: { styleOverrides: { root: { borderRadius: 9, backgroundColor: background.paper, "&:hover .MuiOutlinedInput-notchedOutline": { borderColor: light ? "#B8C0CC" : "#475467" }, "&.Mui-focused .MuiOutlinedInput-notchedOutline": { borderWidth: 1.5 } } } },
      MuiTableCell: { styleOverrides: { head: { fontWeight: 650, fontSize: 11, textTransform: "uppercase", letterSpacing: ".055em", color: text.secondary, backgroundColor: light ? "#FAFBFC" : "#202B3C", borderColor: divider }, root: { borderColor: divider } } },
      MuiChip: { styleOverrides: { root: { borderRadius: 7, fontWeight: 650, fontSize: 12 } } },
      MuiListItemButton: { styleOverrides: { root: { borderRadius: 8, marginBottom: 2, minHeight: 42, "&.Mui-selected": { backgroundColor: alpha(colors.indigo, light ? 0.1 : 0.24), color: light ? "#4F46E5" : "#C7C5FF", "& .MuiListItemIcon-root": { color: "inherit" }, "&:hover": { backgroundColor: alpha(colors.indigo, light ? 0.14 : 0.3) } } } } },
      MuiDialog: { styleOverrides: { paper: { borderRadius: 16 } } },
      MuiAlert: { styleOverrides: { root: { borderRadius: 10 } } },
    },
  });
}
