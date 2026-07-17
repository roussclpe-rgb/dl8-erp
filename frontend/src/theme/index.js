import { alpha, createTheme } from "@mui/material/styles";

const brand = {
  primary: "#5B5BD6",
  ink: "#182230",
  muted: "#667085",
  canvas: "#F7F8FC",
  border: "#E5E7EF",
};

export function buildTheme(mode) {
  const light = mode === "light";
  const paper = light ? "#FFFFFF" : "#151B28";
  const text = light
    ? { primary: brand.ink, secondary: brand.muted }
    : { primary: "#F4F6FA", secondary: "#A7B0C0" };
  const divider = light ? brand.border : "#293244";

  return createTheme({
    palette: {
      mode,
      primary: { main: brand.primary, dark: "#4545B6", light: "#EEEEFF", contrastText: "#FFFFFF" },
      secondary: { main: "#0E9384", dark: "#08766B", light: "#E7F8F5", contrastText: "#FFFFFF" },
      success: { main: "#139B62", light: "#EAF8F1" },
      warning: { main: "#D98A05", light: "#FFF7E5" },
      error: { main: "#D94141", light: "#FFF0F0" },
      info: { main: "#2878D4", light: "#ECF5FF" },
      background: { default: light ? brand.canvas : "#0F141F", paper },
      text,
      divider,
      action: {
        hover: light ? "#F1F3F8" : "#20293A",
        selected: alpha(brand.primary, light ? 0.11 : 0.28),
        focus: alpha(brand.primary, 0.14),
      },
    },
    shape: { borderRadius: 14 },
    spacing: 8,
    typography: {
      fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      h4: { fontWeight: 750, fontSize: "clamp(1.55rem, 2vw, 2rem)", letterSpacing: "-0.045em", lineHeight: 1.18 },
      h5: { fontWeight: 720, letterSpacing: "-0.035em", lineHeight: 1.25 },
      h6: { fontWeight: 700, letterSpacing: "-0.022em" },
      subtitle1: { fontWeight: 680 },
      subtitle2: { fontWeight: 650 },
      body2: { lineHeight: 1.55 },
      button: { textTransform: "none", fontWeight: 680, letterSpacing: 0 },
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          html: { backgroundColor: light ? brand.canvas : "#0F141F" },
          body: { scrollbarWidth: "thin", fontFeatureSettings: '"cv02", "cv03", "cv04", "cv11"' },
          "*": { boxSizing: "border-box" },
          "*::selection": { backgroundColor: alpha(brand.primary, 0.2) },
        },
      },
      MuiAppBar: { styleOverrides: { root: { backgroundColor: alpha(paper, 0.86), color: text.primary, boxShadow: "none", borderBottom: `1px solid ${divider}`, backdropFilter: "blur(16px) saturate(160%)" } } },
      MuiDrawer: { styleOverrides: { paper: { backgroundColor: paper, borderRight: `1px solid ${divider}`, backgroundImage: "none" } } },
      MuiPaper: { styleOverrides: { root: { backgroundImage: "none" }, outlined: { borderColor: divider, boxShadow: light ? "0 1px 2px rgba(16,24,40,.025), 0 1px 3px rgba(16,24,40,.025)" : "none" } } },
      MuiButton: { styleOverrides: { root: { minHeight: 38, borderRadius: 9, paddingInline: 15 }, contained: { boxShadow: "0 1px 2px rgba(20,20,80,.18)", "&:hover": { boxShadow: "0 4px 12px rgba(70,70,180,.22)" } } } },
      MuiIconButton: { styleOverrides: { root: { borderRadius: 9 } } },
      MuiOutlinedInput: { styleOverrides: { root: { borderRadius: 9, backgroundColor: paper, transition: "box-shadow .16s ease, border-color .16s ease", "&:hover .MuiOutlinedInput-notchedOutline": { borderColor: light ? "#B8C0CC" : "#526079" }, "&.Mui-focused": { boxShadow: `0 0 0 3px ${alpha(brand.primary, light ? 0.13 : 0.3)}` }, "&.Mui-focused .MuiOutlinedInput-notchedOutline": { borderWidth: 1, borderColor: brand.primary } } } },
      MuiTableCell: { styleOverrides: { head: { fontWeight: 700, fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".065em", color: text.secondary, backgroundColor: light ? "#FAFBFD" : "#1B2332", borderColor: divider }, root: { borderColor: divider } } },
      MuiTableRow: { styleOverrides: { root: { "&:last-child td": { borderBottom: 0 } } } },
      MuiChip: { styleOverrides: { root: { borderRadius: 7, fontWeight: 650, fontSize: 12 }, filled: { boxShadow: "none" } } },
      MuiListItemButton: { styleOverrides: { root: { borderRadius: 9, marginBottom: 2, minHeight: 42, transition: "background-color .15s ease, color .15s ease", "&.Mui-selected": { backgroundColor: alpha(brand.primary, light ? 0.11 : 0.28), color: light ? "#4747B8" : "#D0D0FF", "& .MuiListItemIcon-root": { color: "inherit" }, "&:hover": { backgroundColor: alpha(brand.primary, light ? 0.15 : 0.35) } } } } },
      MuiDialog: { styleOverrides: { paper: { borderRadius: 16, border: `1px solid ${divider}`, boxShadow: "0 20px 56px rgba(16,24,40,.18)" } } },
      MuiAlert: { styleOverrides: { root: { borderRadius: 10, alignItems: "center" } } },
      MuiSkeleton: { styleOverrides: { root: { borderRadius: 7 } } },
      MuiTooltip: { styleOverrides: { tooltip: { borderRadius: 7, fontSize: 11.5 } } },
    },
  });
}
