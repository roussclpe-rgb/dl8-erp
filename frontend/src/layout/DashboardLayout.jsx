import { useEffect, useMemo, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { AppBar, Avatar, Badge, Box, Breadcrumbs, Collapse, Divider, Drawer, IconButton, InputAdornment, List, ListItemButton, ListItemIcon, ListItemText, ListSubheader, Menu, MenuItem, Stack, TextField, Toolbar, Tooltip, Typography, useMediaQuery, useTheme } from "@mui/material";
import MenuIcon from "@mui/icons-material/Menu";
import DashboardIcon from "@mui/icons-material/DashboardOutlined";
import Inventory2Icon from "@mui/icons-material/Inventory2Outlined";
import LocalShippingIcon from "@mui/icons-material/LocalShippingOutlined";
import ShoppingCartIcon from "@mui/icons-material/ShoppingCartOutlined";
import PointOfSaleIcon from "@mui/icons-material/PointOfSaleOutlined";
import MenuBookIcon from "@mui/icons-material/MenuBookOutlined";
import PrecisionManufacturingIcon from "@mui/icons-material/PrecisionManufacturingOutlined";
import TuneIcon from "@mui/icons-material/TuneOutlined";
import DeleteSweepIcon from "@mui/icons-material/DeleteSweepOutlined";
import AssessmentIcon from "@mui/icons-material/AssessmentOutlined";
import EventNoteIcon from "@mui/icons-material/EventNoteOutlined";
import SettingsIcon from "@mui/icons-material/SettingsOutlined";
import GroupIcon from "@mui/icons-material/GroupOutlined";
import AccountBalanceIcon from "@mui/icons-material/AccountBalanceOutlined";
import NotificationsIcon from "@mui/icons-material/NotificationsNoneOutlined";
import SearchIcon from "@mui/icons-material/Search";
import KeyboardDoubleArrowLeftIcon from "@mui/icons-material/KeyboardDoubleArrowLeftOutlined";
import KeyboardDoubleArrowRightIcon from "@mui/icons-material/KeyboardDoubleArrowRightOutlined";
import LogoutIcon from "@mui/icons-material/LogoutOutlined";
import DarkModeIcon from "@mui/icons-material/DarkModeOutlined";
import LightModeIcon from "@mui/icons-material/LightModeOutlined";
import BakeryDiningIcon from "@mui/icons-material/BakeryDiningOutlined";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { useAuth } from "../context/AuthContext";
import { useThemeMode } from "../context/ThemeModeContext";

const DRAWER_WIDTH = 272;
const COLLAPSED_WIDTH = 78;
const FINANZAS = [
  { label: "Resumen y catálogos", to: "/finanzas" },
  { label: "Políticas", to: "/politicas-financieras" },
  { label: "Operaciones especiales", to: "/movimientos-especiales" },
  { label: "Dónde está mi dinero", to: "/donde-esta-mi-dinero" },
  { label: "Flujo del dinero", to: "/flujo-dinero" },
  { label: "Auditoría", to: "/auditoria-financiera" },
  { label: "Metas", to: "/metas-financieras" },
  { label: "Alertas", to: "/alertas-financieras" },
  { label: "Escenarios", to: "/escenarios-financieros" },
  { label: "Predicciones", to: "/predicciones-financieras" },
];
const MENU = [
  { section: "Principal", items: [{ label: "Dashboard", icon: <DashboardIcon />, to: "/" }] },
  { section: "Operación", items: [{ label: "Ingredientes", icon: <Inventory2Icon />, to: "/ingredientes" }, { label: "Proveedores", icon: <LocalShippingIcon />, to: "/proveedores" }, { label: "Compras", icon: <ShoppingCartIcon />, to: "/compras" }, { label: "Ajustes de stock", icon: <TuneIcon />, to: "/ajustes" }, { label: "Ventas", icon: <ShoppingCartIcon />, to: "/ventas" }, { label: "Caja", icon: <PointOfSaleIcon />, to: "/caja" }] },
  { section: "Producción", items: [{ label: "Recetas", icon: <MenuBookIcon />, to: "/recetas" }, { label: "Producciones", icon: <PrecisionManufacturingIcon />, to: "/producciones" }, { label: "Mermas", icon: <DeleteSweepIcon />, to: "/mermas" }] },
  { section: "Gestión", items: [{ label: "Reportes", icon: <AssessmentIcon />, to: "/reportes" }, { label: "Finanzas", icon: <AccountBalanceIcon />, to: "/finanzas", children: FINANZAS }, { label: "Periodos", icon: <EventNoteIcon />, to: "/periodos" }, { label: "Costos", icon: <SettingsIcon />, to: "/config-costos" }, { label: "Usuarios", icon: <GroupIcon />, to: "/usuarios", roles: ["admin"] }] },
];
const paginas = MENU.flatMap((group) => group.items.flatMap((item) => item.children || [item]));
const rutasFinanzas = new Set(FINANZAS.map((item) => item.to));

export default function DashboardLayout() {
  const { usuario, logout, hasRole } = useAuth();
  const { mode, toggleMode } = useThemeMode();
  const navigate = useNavigate(); const location = useLocation(); const theme = useTheme();
  const mobile = useMediaQuery(theme.breakpoints.down("md"));
  const [mobileOpen, setMobileOpen] = useState(false); const [collapsed, setCollapsed] = useState(false);
  const [accountAnchor, setAccountAnchor] = useState(null); const [finanzasOpen, setFinanzasOpen] = useState(rutasFinanzas.has(location.pathname));
  useEffect(() => { if (rutasFinanzas.has(location.pathname)) setFinanzasOpen(true); }, [location.pathname]);
  const drawerWidth = collapsed && !mobile ? COLLAPSED_WIDTH : DRAWER_WIDTH;
  const page = useMemo(() => paginas.find((item) => item.to === location.pathname) || { label: "DL8" }, [location.pathname]);
  const ir = (to) => { navigate(to); setMobileOpen(false); };

  const navigation = (compact = false) => <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
    <Stack direction="row" alignItems="center" spacing={1.25} sx={{ minHeight: 72, px: compact ? 2.25 : 2.5 }}><Box sx={{ width: 34, height: 34, display: "grid", placeItems: "center", borderRadius: 2, bgcolor: "primary.main", color: "primary.contrastText" }}><BakeryDiningIcon fontSize="small" /></Box>{!compact && <Box><Typography variant="subtitle1" sx={{ lineHeight: 1.15 }}>DL8 ERP</Typography><Typography variant="caption" color="text.secondary">Gestión operativa</Typography></Box>}</Stack>
    <Divider />
    <Box sx={{ flex: 1, overflowY: "auto", px: 1.25, py: 1.5 }}>{MENU.map((group) => <List key={group.section} disablePadding subheader={!compact && <ListSubheader disableSticky sx={{ bgcolor: "transparent", px: 1.25, lineHeight: "30px", fontSize: 10.5, fontWeight: 700, letterSpacing: ".07em", textTransform: "uppercase" }}>{group.section}</ListSubheader>}>
      {group.items.filter((item) => !item.roles || hasRole(...item.roles)).map((item) => {
        const selected = item.to === location.pathname || item.children?.some((child) => child.to === location.pathname);
        const onClick = item.children && !compact ? () => setFinanzasOpen((open) => !open) : () => ir(item.to);
        const content = <ListItemButton selected={selected} onClick={onClick} sx={{ justifyContent: compact ? "center" : "flex-start", px: compact ? 0 : 1.25 }}><ListItemIcon sx={{ minWidth: compact ? 0 : 38, color: "text.secondary", justifyContent: "center" }}>{item.icon}</ListItemIcon>{!compact && <><ListItemText primary={item.label} primaryTypographyProps={{ fontSize: 14, fontWeight: selected ? 650 : 500 }} />{item.children && (finanzasOpen ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />)}</>}</ListItemButton>;
        return <Box key={item.to}>{compact ? <Tooltip title={item.label} placement="right">{content}</Tooltip> : content}{item.children && !compact && <Collapse in={finanzasOpen} timeout="auto" unmountOnExit><List disablePadding>{item.children.map((child) => <ListItemButton key={child.to} selected={location.pathname === child.to} onClick={() => ir(child.to)} sx={{ pl: 6.1, py: 0.65 }}><ListItemText primary={child.label} primaryTypographyProps={{ fontSize: 13 }} /></ListItemButton>)}</List></Collapse>}</Box>;
      })}
    </List>)}</Box>
    {!mobile && <Box sx={{ px: 1.25, pb: 1.5 }}><ListItemButton onClick={() => setCollapsed((value) => !value)} sx={{ justifyContent: compact ? "center" : "flex-start", px: compact ? 0 : 1.25 }}><ListItemIcon sx={{ minWidth: compact ? 0 : 38, justifyContent: "center" }}>{compact ? <KeyboardDoubleArrowRightIcon /> : <KeyboardDoubleArrowLeftIcon />}</ListItemIcon>{!compact && <ListItemText primary="Contraer menú" primaryTypographyProps={{ fontSize: 13 }} />}</ListItemButton></Box>}
  </Box>;

  return <Box sx={{ display: "flex", minHeight: "100vh" }}>
    <Box component="nav" sx={{ width: { md: drawerWidth }, flexShrink: { md: 0 }, transition: "width .2s ease" }}><Drawer variant="temporary" open={mobileOpen} onClose={() => setMobileOpen(false)} ModalProps={{ keepMounted: true }} sx={{ display: { xs: "block", md: "none" }, "& .MuiDrawer-paper": { width: DRAWER_WIDTH } }}>{navigation(false)}</Drawer><Drawer variant="permanent" open sx={{ display: { xs: "none", md: "block" }, "& .MuiDrawer-paper": { width: drawerWidth, boxSizing: "border-box", transition: "width .2s ease" } }}>{navigation(collapsed)}</Drawer></Box>
    <Box component="main" sx={{ flexGrow: 1, width: { md: `calc(100% - ${drawerWidth}px)` }, minWidth: 0, bgcolor: "background.default" }}><AppBar position="sticky"><Toolbar sx={{ minHeight: "72px !important", px: { xs: 2, sm: 3 }, gap: 1.5 }}><IconButton onClick={() => setMobileOpen(true)} sx={{ display: { md: "none" } }}><MenuIcon /></IconButton><Box sx={{ display: { xs: "none", sm: "block" }, flex: 1 }}><Breadcrumbs separator={<ChevronRightIcon fontSize="small" />}><Typography variant="caption" color="text.secondary">Inicio</Typography><Typography variant="caption" color="text.primary">{page.label}</Typography></Breadcrumbs></Box><TextField placeholder="Buscar en el ERP…" size="small" sx={{ width: { xs: 44, sm: 260 }, "& .MuiOutlinedInput-root": { bgcolor: "background.default" } }} InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }} /><Tooltip title={mode === "light" ? "Cambiar a modo oscuro" : "Cambiar a modo claro"}><IconButton onClick={toggleMode}>{mode === "light" ? <DarkModeIcon /> : <LightModeIcon />}</IconButton></Tooltip><Tooltip title="Notificaciones"><IconButton><Badge color="error" variant="dot" invisible><NotificationsIcon /></Badge></IconButton></Tooltip><Tooltip title="Cuenta"><IconButton onClick={(event) => setAccountAnchor(event.currentTarget)} sx={{ p: 0.25 }}><Avatar sx={{ width: 34, height: 34, fontSize: 13, bgcolor: "primary.main" }}>{usuario?.nombre?.[0]?.toUpperCase() || "?"}</Avatar></IconButton></Tooltip><Menu anchorEl={accountAnchor} open={Boolean(accountAnchor)} onClose={() => setAccountAnchor(null)} PaperProps={{ sx: { minWidth: 210, mt: 1 } }}><Box sx={{ px: 2, py: 1.25 }}><Typography variant="subtitle2">{usuario?.nombre || "Usuario"}</Typography><Typography variant="caption" color="text.secondary" sx={{ textTransform: "capitalize" }}>{usuario?.rol}</Typography></Box><Divider /><MenuItem onClick={() => { logout(); navigate("/login"); }}><LogoutIcon fontSize="small" sx={{ mr: 1.5 }} />Cerrar sesión</MenuItem></Menu></Toolbar></AppBar><Box sx={{ px: { xs: 2, sm: 3, lg: 4 }, py: { xs: 2.5, sm: 3.5 }, maxWidth: 1680, mx: "auto" }}><Outlet /></Box></Box>
  </Box>;
}
