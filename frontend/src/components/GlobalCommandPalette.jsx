import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Box,
  Chip,
  CircularProgress,
  Dialog,
  DialogContent,
  Divider,
  IconButton,
  InputAdornment,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import StarIcon from "@mui/icons-material/Star";
import StarBorderIcon from "@mui/icons-material/StarBorder";
import HistoryIcon from "@mui/icons-material/HistoryOutlined";
import KeyboardReturnIcon from "@mui/icons-material/KeyboardReturn";
import DashboardIcon from "@mui/icons-material/DashboardOutlined";
import InventoryIcon from "@mui/icons-material/Inventory2Outlined";
import PeopleIcon from "@mui/icons-material/PeopleOutline";
import ShoppingCartIcon from "@mui/icons-material/ShoppingCartOutlined";
import LocalShippingIcon from "@mui/icons-material/LocalShippingOutlined";
import FactoryIcon from "@mui/icons-material/PrecisionManufacturingOutlined";
import MenuBookIcon from "@mui/icons-material/MenuBookOutlined";
import SettingsIcon from "@mui/icons-material/SettingsOutlined";
import GroupIcon from "@mui/icons-material/GroupOutlined";
import { useAuth } from "../context/AuthContext";
import {
  listarClientes,
  listarCompras,
  listarIngredientes,
  listarProducciones,
  listarProductosVenta,
  listarProveedores,
  listarRecetas,
  listarUsuarios,
  listarVentas,
} from "../api/endpoints";

const FAVORITES_KEY = "erp-command-palette:favorites";
const RECENTS_KEY = "erp-command-palette:recents";
const normalise = (value) => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const readStorage = (key) => { try { const value = JSON.parse(localStorage.getItem(key) || "[]"); return Array.isArray(value) ? value : []; } catch { return []; } };

const SCREENS = [
  { id: "screen-dashboard", label: "Dashboard", detail: "Inicio", to: "/", icon: <DashboardIcon /> },
  { id: "screen-products", label: "Productos", detail: "Catálogo de venta", to: "/ventas", icon: <InventoryIcon /> },
  { id: "screen-clients", label: "Clientes", detail: "Ventas", to: "/ventas", icon: <PeopleIcon /> },
  { id: "screen-providers", label: "Proveedores", detail: "Operación", to: "/proveedores", icon: <LocalShippingIcon /> },
  { id: "screen-sales", label: "Ventas", detail: "Operación", to: "/ventas", icon: <ShoppingCartIcon /> },
  { id: "screen-purchases", label: "Compras", detail: "Operación", to: "/compras", icon: <ShoppingCartIcon /> },
  { id: "screen-productions", label: "Producciones", detail: "Producción", to: "/producciones", icon: <FactoryIcon /> },
  { id: "screen-recipes", label: "Recetas", detail: "Producción", to: "/recetas", icon: <MenuBookIcon /> },
  { id: "screen-ingredients", label: "Insumos e ingredientes", detail: "Inventario", to: "/ingredientes", icon: <InventoryIcon /> },
  { id: "screen-stock-settings", label: "Ajustes de stock", detail: "Configuración", to: "/ajustes", icon: <SettingsIcon /> },
  { id: "screen-cost-settings", label: "Configuración de costos", detail: "Configuración", to: "/config-costos", icon: <SettingsIcon /> },
  { id: "screen-periods", label: "Períodos", detail: "Configuración", to: "/periodos", icon: <SettingsIcon /> },
  { id: "screen-users", label: "Usuarios", detail: "Configuración", to: "/usuarios", icon: <GroupIcon />, roles: ["admin"] },
];

const recordLabel = (record, keys, fallback) => keys.map((key) => record?.[key]).find(Boolean) || fallback;
const result = (type, row, label, detail, to, icon) => ({ id: `${type}-${row?.id ?? label}`, type, label: String(label), detail: String(detail || type), to, icon, search: normalise(`${label} ${detail || ""}`) });

export default function GlobalCommandPalette({ open: controlledOpen, onClose: controlledOnClose }) {
  const navigate = useNavigate();
  const { hasRole } = useAuth();
  const inputRef = useRef(null);
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const onClose = controlledOnClose || (() => setInternalOpen(false));
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [index, setIndex] = useState([]);
  const [favorites, setFavorites] = useState(() => readStorage(FAVORITES_KEY));
  const [recents, setRecents] = useState(() => readStorage(RECENTS_KEY));

  const screens = useMemo(() => SCREENS.filter((item) => !item.roles || hasRole(...item.roles)).map((item) => ({ ...item, type: "Pantalla", search: normalise(`${item.label} ${item.detail}`) })), [hasRole]);

  useEffect(() => {
    if (!open) return undefined;
    setQuery("");
    const focus = window.setTimeout(() => inputRef.current?.focus(), 50);
    if (index.length) return () => window.clearTimeout(focus);
    let active = true;
    setLoading(true);
    const sources = [
      listarProductosVenta().then((rows) => rows.map((row) => result("Producto", row, recordLabel(row, ["nombre", "nombre_producto"], `Producto #${row.id}`), row.codigo || row.categoria, "/ventas", <InventoryIcon />))),
      listarClientes().then((rows) => rows.map((row) => result("Cliente", row, recordLabel(row, ["nombre", "razon_social"], `Cliente #${row.id}`), row.email || row.telefono, "/ventas", <PeopleIcon />))),
      listarProveedores().then((rows) => rows.map((row) => result("Proveedor", row, recordLabel(row, ["nombre", "razon_social"], `Proveedor #${row.id}`), row.ruc || row.telefono, "/proveedores", <LocalShippingIcon />))),
      listarVentas().then((rows) => rows.map((row) => result("Venta", row, `Venta #${row.id}`, recordLabel(row, ["cliente_nombre", "cliente", "fecha"], row.estado), "/ventas", <ShoppingCartIcon />))),
      listarCompras().then((rows) => rows.map((row) => result("Compra", row, `Compra #${row.id}`, recordLabel(row, ["proveedor_nombre", "proveedor", "fecha_compra"], row.estado), "/compras", <ShoppingCartIcon />))),
      listarProducciones().then((rows) => rows.map((row) => result("Producción", row, recordLabel(row, ["receta", "nombre_producto"], `Producción #${row.id}`), row.fecha, "/producciones", <FactoryIcon />))),
      listarRecetas().then((rows) => rows.map((row) => result("Receta", row, recordLabel(row, ["nombre_producto", "nombre"], `Receta #${row.id}`), `Versión ${row.version || "—"}`, "/recetas", <MenuBookIcon />))),
      listarIngredientes().then((rows) => rows.map((row) => result("Insumo", row, recordLabel(row, ["nombre"], `Insumo #${row.id}`), row.unidad_base || row.categoria, "/ingredientes", <InventoryIcon />))),
      hasRole("admin") ? listarUsuarios().then((rows) => rows.map((row) => result("Usuario", row, recordLabel(row, ["nombre", "email"], `Usuario #${row.id}`), row.email || row.rol, "/usuarios", <GroupIcon />))) : Promise.resolve([]),
    ];
    Promise.all(sources.map((source) => source.catch(() => []))).then((groups) => { if (active) setIndex(groups.flat()); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; window.clearTimeout(focus); };
  }, [open, index.length, hasRole]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); if (controlledOpen === undefined) setInternalOpen((value) => !value); else if (open) onClose(); }
      if (event.key === "Escape" && open) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose, controlledOpen]);

  const allItems = useMemo(() => [...screens, ...index], [screens, index]);
  const favoriteItems = useMemo(() => favorites.map((id) => allItems.find((item) => item.id === id)).filter(Boolean), [favorites, allItems]);
  const recentItems = useMemo(() => recents.map((id) => allItems.find((item) => item.id === id)).filter(Boolean), [recents, allItems]);
  const results = useMemo(() => {
    const words = normalise(query).split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    return allItems.filter((item) => words.every((word) => item.search.includes(word))).sort((a, b) => {
      const aStart = a.search.startsWith(words[0]) ? 1 : 0; const bStart = b.search.startsWith(words[0]) ? 1 : 0;
      return bStart - aStart || a.label.localeCompare(b.label);
    }).slice(0, 30);
  }, [allItems, query]);
  const displayed = query.trim() ? results : [...favoriteItems, ...recentItems.filter((item) => !favorites.includes(item.id)), ...screens.filter((item) => !favorites.includes(item.id)).slice(0, 8)];

  const select = (item) => {
    const next = [item.id, ...recents.filter((id) => id !== item.id)].slice(0, 10);
    setRecents(next); localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
    navigate(item.to); onClose();
  };
  const toggleFavorite = (event, id) => {
    event.stopPropagation();
    const next = favorites.includes(id) ? favorites.filter((item) => item !== id) : [...favorites, id];
    setFavorites(next); localStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
  };
  let lastType = "";

  return <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" PaperProps={{ sx: { mt: { xs: 2, sm: 10 }, alignSelf: "flex-start", overflow: "hidden" } }}>
    <DialogContent sx={{ p: 0 }}>
      <TextField inputRef={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Busca productos, ventas, pantallas y más…" fullWidth autoComplete="off" InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon color="action" /></InputAdornment>, endAdornment: loading ? <InputAdornment position="end"><CircularProgress size={18} /></InputAdornment> : null }} sx={{ "& .MuiOutlinedInput-root": { borderRadius: 0, border: 0, minHeight: 64 }, "& fieldset": { border: 0 } }} />
      <Divider />
      <List disablePadding sx={{ maxHeight: "min(58vh, 520px)", overflowY: "auto", py: 0.75 }}>
        {!query && favoriteItems.length > 0 && <Typography variant="overline" color="text.secondary" sx={{ px: 2, pt: 0.75, display: "block" }}>Favoritos</Typography>}
        {!query && favoriteItems.length === 0 && recentItems.length > 0 && <Typography variant="overline" color="text.secondary" sx={{ px: 2, pt: 0.75, display: "block" }}>Recientes</Typography>}
        {displayed.map((item, position) => {
          const showType = Boolean(query && item.type !== lastType && (lastType = item.type));
          return <Box key={item.id}>{showType && <Typography variant="overline" color="text.secondary" sx={{ px: 2, pt: 1, display: "block" }}>{item.type}s</Typography>}<ListItemButton onClick={() => select(item)} sx={{ mx: 0.75, px: 1.25, borderRadius: 1.5 }}><ListItemIcon sx={{ minWidth: 38, color: "text.secondary" }}>{item.icon}</ListItemIcon><ListItemText primary={item.label} secondary={item.detail} primaryTypographyProps={{ fontWeight: 650, noWrap: true }} secondaryTypographyProps={{ noWrap: true }} />{!query && position < favoriteItems.length && <HistoryIcon fontSize="small" color="action" />}<Tooltip title={favorites.includes(item.id) ? "Quitar de favoritos" : "Agregar a favoritos"}><IconButton size="small" onClick={(event) => toggleFavorite(event, item.id)}>{favorites.includes(item.id) ? <StarIcon fontSize="small" color="warning" /> : <StarBorderIcon fontSize="small" />}</IconButton></Tooltip></ListItemButton></Box>;
        })}
        {query && !loading && displayed.length === 0 && <Box sx={{ py: 5, textAlign: "center" }}><Typography color="text.secondary">No encontramos resultados para “{query}”.</Typography></Box>}
        {!query && displayed.length === 0 && <Box sx={{ py: 5, textAlign: "center" }}><Typography color="text.secondary">Escribe para buscar en todo el ERP.</Typography></Box>}
      </List>
      <Divider /><Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ px: 2, py: 1, bgcolor: "action.hover" }}><Stack direction="row" spacing={0.75} alignItems="center"><Chip size="small" label="↑↓" /><Typography variant="caption" color="text.secondary">Navegar</Typography><KeyboardReturnIcon fontSize="small" color="action" /><Typography variant="caption" color="text.secondary">Abrir</Typography></Stack><Typography variant="caption" color="text.secondary">Esc para cerrar</Typography></Stack>
    </DialogContent>
  </Dialog>;
}
