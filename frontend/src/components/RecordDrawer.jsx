import { useEffect, useMemo, useState } from "react";
import {
  Box,
  Button,
  CircularProgress,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Stack,
  Tab,
  Tabs,
  Typography,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import EditIcon from "@mui/icons-material/EditOutlined";
import HistoryIcon from "@mui/icons-material/HistoryOutlined";
import FactCheckIcon from "@mui/icons-material/FactCheckOutlined";
import DescriptionIcon from "@mui/icons-material/DescriptionOutlined";

const LABELS = { id: "ID", creado_en: "Creado", actualizado_en: "Actualizado", estado: "Estado", fecha: "Fecha", usuario: "Usuario" };
const friendlyLabel = (field) => LABELS[field] || field.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const displayValue = (value) => {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Sí" : "No";
  if (Array.isArray(value)) return value.map(displayValue).join(", ");
  if (typeof value === "object") return Object.entries(value).map(([key, item]) => `${friendlyLabel(key)}: ${displayValue(item)}`).join(" · ");
  return String(value);
};

function SectionList({ items, emptyText }) {
  if (!items?.length) return <Typography variant="body2" color="text.secondary" sx={{ py: 3 }}>{emptyText}</Typography>;
  return <List disablePadding>{items.map((item, index) => <ListItem key={item.id || index} disableGutters divider alignItems="flex-start"><ListItemText primary={item.titulo || item.nombre || item.descripcion || item.evento || `Registro ${index + 1}`} secondary={displayValue(item.detalle || item.mensaje || item)} primaryTypographyProps={{ fontWeight: 650 }} secondaryTypographyProps={{ sx: { mt: 0.4, whiteSpace: "normal" } }} /></ListItem>)}</List>;
}

/** Panel lateral reutilizable para consultar una fila sin navegar. Las fuentes
 * history/audit/documents pueden ser arrays o funciones asíncronas por registro. */
export default function RecordDrawer({ open, onClose, row: inputRow, columns = [], getValue, title, onEdit, history, audit, documents }) {
  const row = inputRow || {};
  const [tab, setTab] = useState(0);
  const [sectionData, setSectionData] = useState({ history: null, audit: null, documents: null });
  const [sectionLoading, setSectionLoading] = useState(false);
  const automaticHistory = useMemo(() => [
    row?.creado_en && { id: "created", titulo: "Registro creado", detalle: row.creado_en },
    row?.actualizado_en && { id: "updated", titulo: "Última actualización", detalle: row.actualizado_en },
  ].filter(Boolean), [row]);
  const automaticAudit = useMemo(() => Object.entries(row || {}).filter(([key]) => ["creado_en", "actualizado_en", "usuario", "usuario_nombre", "estado", "version"].includes(key)).map(([key, value]) => ({ id: key, titulo: friendlyLabel(key), detalle: value })), [row]);
  const automaticDocuments = useMemo(() => Object.entries(row || {}).filter(([key, value]) => value && /(documento|factura|comprobante|archivo|url)/i.test(key)).map(([key, value]) => ({ id: key, titulo: friendlyLabel(key), detalle: value })), [row]);
  const sections = useMemo(() => [
    { key: "history", label: "Historial", icon: <HistoryIcon fontSize="small" />, source: history ?? row?.historial ?? row?.history ?? automaticHistory },
    { key: "audit", label: "Auditoría", icon: <FactCheckIcon fontSize="small" />, source: audit ?? row?.auditoria ?? row?.audit ?? automaticAudit },
    { key: "documents", label: "Documentos", icon: <DescriptionIcon fontSize="small" />, source: documents ?? row?.documentos ?? row?.documents ?? automaticDocuments },
  ], [history, audit, documents, row, automaticHistory, automaticAudit, automaticDocuments]);

  useEffect(() => { if (open) { setTab(0); setSectionData({ history: null, audit: null, documents: null }); } }, [open, row]);
  useEffect(() => {
    if (!open || tab === 0) return undefined;
    const section = sections[tab - 1];
    if (!section || typeof section.source !== "function") return undefined;
    let active = true;
    setSectionLoading(true);
    Promise.resolve(section.source(row)).then((data) => { if (active) setSectionData((current) => ({ ...current, [section.key]: Array.isArray(data) ? data : data?.items || [] })); }).catch(() => { if (active) setSectionData((current) => ({ ...current, [section.key]: [] })); }).finally(() => { if (active) setSectionLoading(false); });
    return () => { active = false; };
  }, [open, tab, row, sections]);

  const detailColumns = columns.filter((column) => !["accion", "acciones", "action", "actions"].includes(column.field));
  const actionColumns = columns.filter((column) => ["accion", "acciones", "action", "actions"].includes(column.field) && column.renderCell);
  const activeSection = tab > 0 ? sections[tab - 1] : null;
  const activeItems = activeSection ? (typeof activeSection.source === "function" ? sectionData[activeSection.key] : activeSection.source) : null;
  const drawerTitle = title || row?.nombre || row?.nombre_producto || row?.codigo || `Detalle #${row?.id || ""}`;

  return <Drawer anchor="right" open={open} onClose={onClose} PaperProps={{ sx: { width: { xs: "100%", sm: 520, md: 600 }, maxWidth: "100%" } }}>
    <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ px: 2.5, py: 1.75 }}>
      <Box><Typography variant="overline" color="text.secondary">Detalle del registro</Typography><Typography variant="h6" noWrap>{drawerTitle}</Typography></Box>
      <Stack direction="row" spacing={0.5}>{onEdit && <Button size="small" startIcon={<EditIcon />} onClick={() => onEdit(row)}>Editar</Button>}<IconButton aria-label="Cerrar detalle" onClick={onClose}><CloseIcon /></IconButton></Stack>
    </Stack>
    <Divider />
    <Tabs value={tab} onChange={(_, value) => setTab(value)} variant="scrollable" scrollButtons="auto" sx={{ px: 1.25 }}><Tab label="Detalles" /><Tab icon={sections[0].icon} iconPosition="start" label="Historial" /><Tab icon={sections[1].icon} iconPosition="start" label="Auditoría" /><Tab icon={sections[2].icon} iconPosition="start" label="Documentos" /></Tabs>
    <Divider />
    <Box sx={{ p: 2.5, overflowY: "auto", flex: 1 }}>
      {tab === 0 && <Stack spacing={0}>{detailColumns.map((column) => <Stack key={column.field} direction="row" justifyContent="space-between" spacing={2} sx={{ py: 1.25, borderBottom: "1px solid", borderColor: "divider" }}><Typography variant="body2" color="text.secondary">{column.headerName || friendlyLabel(column.field)}</Typography><Box sx={{ textAlign: "right", maxWidth: "62%", wordBreak: "break-word" }}><Typography variant="body2" fontWeight={600}>{displayValue(getValue(row, column))}</Typography></Box></Stack>)}{actionColumns.length > 0 && <Box sx={{ pt: 2.5 }}><Typography variant="subtitle2" sx={{ mb: 1 }}>Acciones del registro</Typography><Stack direction="row" spacing={0.75} flexWrap="wrap">{actionColumns.map((column) => <Box key={column.field}>{column.renderCell(row)}</Box>)}</Stack></Box>}</Stack>}
      {tab > 0 && (sectionLoading ? <Box sx={{ display: "grid", placeItems: "center", py: 6 }}><CircularProgress size={26} /></Box> : <SectionList items={activeItems} emptyText={`No hay ${activeSection.label.toLowerCase()} disponibles para este registro.`} />)}
    </Box>
  </Drawer>;
}
