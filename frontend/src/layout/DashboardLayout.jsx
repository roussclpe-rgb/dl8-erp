import { useState, useMemo } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  Box,
  AppBar,
  Toolbar,
  Drawer,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  IconButton,
  Typography,
  Avatar,
  Menu,
  MenuItem,
  Divider,
  Tooltip,
  Badge,
  useMediaQuery,
} from "@mui/material";
import MenuIcon from "@mui/icons-material/Menu";
import DashboardIcon from "@mui/icons-material/DashboardOutlined";
import Inventory2Icon from "@mui/icons-material/Inventory2Outlined";
import LocalShippingIcon from "@mui/icons-material/LocalShippingOutlined";
import ShoppingCartIcon from "@mui/icons-material/ShoppingCartOutlined";
import MenuBookIcon from "@mui/icons-material/MenuBookOutlined";
import PrecisionManufacturingIcon from "@mui/icons-material/PrecisionManufacturingOutlined";
import TuneIcon from "@mui/icons-material/TuneOutlined";
import DeleteSweepIcon from "@mui/icons-material/DeleteSweepOutlined";
import AssessmentIcon from "@mui/icons-material/AssessmentOutlined";
import EventNoteIcon from "@mui/icons-material/EventNoteOutlined";
import SettingsIcon from "@mui/icons-material/SettingsOutlined";
import GroupIcon from "@mui/icons-material/GroupOutlined";
import LightModeIcon from "@mui/icons-material/LightModeOutlined";
import DarkModeIcon from "@mui/icons-material/DarkModeOutlined";
import NotificationsIcon from "@mui/icons-material/NotificationsNoneOutlined";
import LogoutIcon from "@mui/icons-material/LogoutOutlined";
import BakeryDiningIcon from "@mui/icons-material/BakeryDiningOutlined";

import { useThemeMode } from "../context/ThemeModeContext";
import { useAuth } from "../context/AuthContext";

const DRAWER_WIDTH = 260;
const DRAWER_WIDTH_COLLAPSED = 76;

const MENU = [
  { section: "General", items: [{ label: "Dashboard", icon: <DashboardIcon />, to: "/" }] },
  {
  section: "Inventario",
  items: [
    { label: "Ingredientes", icon: <Inventory2Icon />, to: "/ingredientes" },
    { label: "Proveedores", icon: <LocalShippingIcon />, to: "/proveedores" },
    { label: "Compras", icon: <ShoppingCartIcon />, to: "/compras" },
    { label: "Ajustes de stock", icon: <TuneIcon />, to: "/ajustes" },
  ],
},
{
  section: "Ventas",
  items: [
    { label: "Ventas", icon: <ShoppingCartIcon />, to: "/ventas" },
  ],
},
  {
    section: "Producción",
    items: [
      { label: "Recetas", icon: <MenuBookIcon />, to: "/recetas" },
      { label: "Producciones", icon: <PrecisionManufacturingIcon />, to: "/producciones" },
      { label: "Mermas de producto", icon: <DeleteSweepIcon />, to: "/mermas" },
    ],
  },
  {
    section: "Administración",
    items: [
      { label: "Reportes", icon: <AssessmentIcon />, to: "/reportes" },
      { label: "Periodos contables", icon: <EventNoteIcon />, to: "/periodos" },
      { label: "Config. de costos", icon: <SettingsIcon />, to: "/config-costos" },
      { label: "Usuarios", icon: <GroupIcon />, to: "/usuarios", roles: ["admin"] },
    ],
  },
];

export default function DashboardLayout() {
  const { mode, toggleMode } = useThemeMode();
  const { usuario, logout, hasRole } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = useMediaQuery("(max-width:900px)");

  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [anchorEl, setAnchorEl] = useState(null);

  const drawerWidth = collapsed && !isMobile ? DRAWER_WIDTH_COLLAPSED : DRAWER_WIDTH;

  const currentTitle = useMemo(() => {
    for (const group of MENU) {
      const found = group.items.find((i) => i.to === location.pathname);
      if (found) return found.label;
    }
    return "DL8";
  }, [location.pathname]);

  const drawerContent = (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <Toolbar sx={{ px: 2, gap: 1 }}>
        <BakeryDiningIcon color="primary" />
        {!collapsed && (
          <Typography variant="subtitle1" noWrap sx={{ fontWeight: 700 }}>
            DL8
          </Typography>
        )}
      </Toolbar>
      <Box sx={{ flex: 1, overflowY: "auto", px: 1.5, pb: 2 }}>
        {MENU.map((group) => (
          <List
            key={group.section}
            subheader={
              !collapsed ? (
                <ListSubheader sx={{ bgcolor: "transparent", lineHeight: "28px", fontSize: 11, fontWeight: 700 }}>
                  {group.section}
                </ListSubheader>
              ) : null
            }
          >
            {group.items
              .filter((item) => !item.roles || hasRole(...item.roles))
              .map((item) => {
                const selected = location.pathname === item.to;
                const button = (
                  <ListItemButton
                    key={item.to}
                    selected={selected}
                    onClick={() => {
                      navigate(item.to);
                      if (isMobile) setMobileOpen(false);
                    }}
                    sx={{
                      justifyContent: collapsed ? "center" : "flex-start",
                      "&.Mui-selected": {
                        bgcolor: "primary.main",
                        color: "primary.contrastText",
                        "&:hover": { bgcolor: "primary.dark" },
                        "& .MuiListItemIcon-root": { color: "primary.contrastText" },
                      },
                    }}
                  >
                    <ListItemIcon sx={{ minWidth: collapsed ? 0 : 40, justifyContent: "center" }}>
                      {item.icon}
                    </ListItemIcon>
                    {!collapsed && <ListItemText primary={item.label} />}
                  </ListItemButton>
                );
                return collapsed ? (
                  <Tooltip title={item.label} placement="right" key={item.to}>
                    {button}
                  </Tooltip>
                ) : (
                  button
                );
              })}
          </List>
        ))}
      </Box>
    </Box>
  );

  return (
    <Box sx={{ display: "flex", minHeight: "100vh" }}>
      <AppBar
        position="fixed"
        sx={{
          width: { md: `calc(100% - ${drawerWidth}px)` },
          ml: { md: `${drawerWidth}px` },
          transition: "width 0.2s, margin 0.2s",
        }}
      >
        <Toolbar sx={{ gap: 1 }}>
          <IconButton
            edge="start"
            onClick={() => (isMobile ? setMobileOpen(true) : setCollapsed((c) => !c))}
            sx={{ mr: 1 }}
          >
            <MenuIcon />
          </IconButton>
          <Typography variant="h6" sx={{ flexGrow: 1, fontWeight: 700 }} noWrap>
            {currentTitle}
          </Typography>

          <Tooltip title={mode === "light" ? "Modo oscuro" : "Modo claro"}>
            <IconButton onClick={toggleMode}>{mode === "light" ? <DarkModeIcon /> : <LightModeIcon />}</IconButton>
          </Tooltip>

          <Tooltip title="Notificaciones">
            <IconButton>
              <Badge color="error" variant="dot" invisible>
                <NotificationsIcon />
              </Badge>
            </IconButton>
          </Tooltip>

          <Tooltip title="Cuenta">
            <IconButton onClick={(e) => setAnchorEl(e.currentTarget)} sx={{ ml: 0.5 }}>
              <Avatar sx={{ width: 34, height: 34, bgcolor: "primary.main", fontSize: 14 }}>
                {usuario?.nombre?.[0]?.toUpperCase() || "?"}
              </Avatar>
            </IconButton>
          </Tooltip>
          <Menu anchorEl={anchorEl} open={!!anchorEl} onClose={() => setAnchorEl(null)}>
            <Box sx={{ px: 2, py: 1 }}>
              <Typography variant="subtitle2">{usuario?.nombre}</Typography>
              <Typography variant="caption" color="text.secondary" sx={{ textTransform: "capitalize" }}>
                {usuario?.rol}
              </Typography>
            </Box>
            <Divider />
            <MenuItem
              onClick={() => {
                logout();
                navigate("/login");
              }}
            >
              <LogoutIcon fontSize="small" sx={{ mr: 1.5 }} /> Cerrar sesión
            </MenuItem>
          </Menu>
        </Toolbar>
      </AppBar>

      <Box component="nav" sx={{ width: { md: drawerWidth }, flexShrink: { md: 0 }, transition: "width 0.2s" }}>
        <Drawer
          variant="temporary"
          open={mobileOpen}
          onClose={() => setMobileOpen(false)}
          ModalProps={{ keepMounted: true }}
          sx={{ display: { xs: "block", md: "none" }, "& .MuiDrawer-paper": { width: DRAWER_WIDTH } }}
        >
          {drawerContent}
        </Drawer>
        <Drawer
          variant="permanent"
          sx={{
            display: { xs: "none", md: "block" },
            "& .MuiDrawer-paper": { width: drawerWidth, boxSizing: "border-box", transition: "width 0.2s" },
          }}
          open
        >
          {drawerContent}
        </Drawer>
      </Box>

      <Box
        component="main"
        sx={{
          flexGrow: 1,
          width: { md: `calc(100% - ${drawerWidth}px)` },
          bgcolor: "background.default",
          minHeight: "100vh",
        }}
      >
        <Toolbar />
        <Box sx={{ p: { xs: 2, sm: 3 } }}>
          <Outlet />
        </Box>
      </Box>
    </Box>
  );
}
