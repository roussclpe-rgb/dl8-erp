import { createTheme } from "@mui/material/styles";

const PRIMARY = "#4F46E5";
const PRIMARY_DARK = "#4338CA";
const SECONDARY = "#14B8A6";

export function buildTheme(mode) {
  const isLight = mode === "light";

  return createTheme({
    palette: {
      mode,
      primary: { main: PRIMARY, dark: PRIMARY_DARK, contrastText: "#fff" },
      secondary: { main: SECONDARY, contrastText: "#fff" },
      background: {
        default: isLight ? "#F4F5F9" : "#0F1117",
        paper: isLight ? "#FFFFFF" : "#171923",
      },
      text: {
        primary: isLight ? "#1F2430" : "#E5E7EB",
        secondary: isLight ? "#6B7280" : "#9CA3AF",
      },
      divider: isLight ? "#E5E7EB" : "#2A2E3A",
      success: { main: "#16A34A" },
      warning: { main: "#D97706" },
      error: { main: "#DC2626" },
      info: { main: "#2563EB" },
    },
    shape: { borderRadius: 10 },
    typography: {
      fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
      h4: { fontWeight: 700 },
      h5: { fontWeight: 700 },
      h6: { fontWeight: 600 },
      subtitle1: { fontWeight: 600 },
      button: { textTransform: "none", fontWeight: 600 },
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: { scrollbarWidth: "thin" },
        },
      },
      MuiAppBar: {
        styleOverrides: {
          root: {
            backgroundColor: isLight ? "#FFFFFF" : "#171923",
            color: isLight ? "#1F2430" : "#E5E7EB",
            boxShadow: "none",
            borderBottom: `1px solid ${isLight ? "#E5E7EB" : "#2A2E3A"}`,
          },
        },
      },
      MuiDrawer: {
        styleOverrides: {
          paper: {
            backgroundColor: isLight ? "#FFFFFF" : "#171923",
            borderRight: `1px solid ${isLight ? "#E5E7EB" : "#2A2E3A"}`,
          },
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: { backgroundImage: "none" },
          rounded: { borderRadius: 12 },
        },
      },
      MuiButton: {
        styleOverrides: {
          root: { borderRadius: 8 },
          contained: { boxShadow: "none", "&:hover": { boxShadow: "none" } },
        },
      },
      MuiTableCell: {
        styleOverrides: {
          head: {
            fontWeight: 700,
            fontSize: 12,
            textTransform: "uppercase",
            letterSpacing: 0.4,
            color: isLight ? "#6B7280" : "#9CA3AF",
            backgroundColor: isLight ? "#F9FAFB" : "#1D2130",
          },
        },
      },
      MuiChip: {
        styleOverrides: { root: { fontWeight: 600 } },
      },
      MuiListItemButton: {
        styleOverrides: {
          root: {
            borderRadius: 8,
            marginBottom: 2,
          },
        },
      },
    },
  });
}
