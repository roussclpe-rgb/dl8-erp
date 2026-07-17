import { useEffect, useMemo, useState } from "react";
import {
  Box,
  Button,
  Checkbox,
  Chip,
  Divider,
  IconButton,
  InputAdornment,
  ListItemText,
  Menu,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TableSortLabel,
  TextField,
  Tooltip,
  Typography,
  Skeleton,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import FilterListIcon from "@mui/icons-material/FilterList";
import ViewColumnIcon from "@mui/icons-material/ViewColumn";
import FileDownloadOutlinedIcon from "@mui/icons-material/FileDownloadOutlined";
import SaveOutlinedIcon from "@mui/icons-material/SaveOutlined";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import ClearIcon from "@mui/icons-material/Clear";
import VisibilityIcon from "@mui/icons-material/VisibilityOutlined";
import RecordDrawer from "./RecordDrawer";

const STATUS_TONES = {
  activa: "success", activo: "success", vigente: "success", ok: "success", pagado: "success", completado: "success",
  pendiente: "warning", parcial: "warning", inactiva: "default", inactivo: "default", anterior: "default",
  cancelado: "error", anulada: "error", anulado: "error", vencido: "error",
};

const normalise = (value) => String(value ?? "").trim().toLowerCase();
const defaultGetRowId = (row) => row.id;

/**
 * Tabla reutilizable para el ERP. Todas las operaciones ocurren en cliente:
 * búsqueda, filtros, orden, columnas, selección y exportación no alteran APIs.
 *
 * columns: [{ field, headerName, align, sortable, minWidth, valueGetter(row), renderCell(row) }]
 * rowActions: [{ label, icon, onClick(row), disabled?(row), color? }]
 * bulkActions: [{ label, onClick(selectedRows), color? }]
 */
export default function DataTable({
  columns,
  rows,
  loading = false,
  getRowId = defaultGetRowId,
  searchable = true,
  searchPlaceholder = "Buscar…",
  defaultOrderBy = null,
  defaultOrder = "asc",
  emptyMessage = "No hay registros para mostrar.",
  toolbarExtra = null,
  onRowClick = null,
  onSelectionChange = null,
  rowActions = [],
  bulkActions = [],
  recordDrawer = true,
  drawerTitle = null,
  onDrawerEdit = null,
  drawerHistory = null,
  drawerAudit = null,
  drawerDocuments = null,
  quickFilters = null,
  tableId = null,
  dense = false,
  rowsPerPageOptions = [10, 25, 50],
}) {
  const storageKey = useMemo(() => `erp-table:${tableId || columns.map((c) => c.field).join("|")}`, [columns, tableId]);
  const [search, setSearch] = useState("");
  const [orderBy, setOrderBy] = useState(defaultOrderBy);
  const [order, setOrder] = useState(defaultOrder);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(rowsPerPageOptions[0]);
  const [selected, setSelected] = useState([]);
  const [hiddenColumns, setHiddenColumns] = useState([]);
  const [columnWidths, setColumnWidths] = useState({});
  const [filters, setFilters] = useState({});
  const [filterAnchor, setFilterAnchor] = useState(null);
  const [columnsAnchor, setColumnsAnchor] = useState(null);
  const [savedAnchor, setSavedAnchor] = useState(null);
  const [savedViews, setSavedViews] = useState([]);
  const [rowActionAnchor, setRowActionAnchor] = useState(null);
  const [activeRow, setActiveRow] = useState(null);
  const [drawerRow, setDrawerRow] = useState(null);

  const getValue = (row, col) => (col.valueGetter ? col.valueGetter(row) : row[col.field]);
  const selectableColumns = useMemo(() => columns.filter((col) => !hiddenColumns.includes(col.field)), [columns, hiddenColumns]);
  const filterableColumns = useMemo(() => {
    if (quickFilters) return columns.filter((col) => quickFilters.includes(col.field));
    return columns.filter((col) => ["estado", "tipo", "estado_pago", "incompleto"].includes(col.field));
  }, [columns, quickFilters]);
  const filterOptions = useMemo(() => filterableColumns.reduce((acc, col) => {
    const values = [...new Set(rows.map((row) => getValue(row, col)).filter((value) => value !== null && value !== undefined && value !== ""))];
    if (values.length > 0 && values.length <= 12) acc[col.field] = values;
    return acc;
  }, {}), [rows, filterableColumns]);

  useEffect(() => {
    try {
      const stored = JSON.parse(window.localStorage.getItem(`${storageKey}:views`) || "[]");
      setSavedViews(Array.isArray(stored) ? stored : []);
    } catch {
      setSavedViews([]);
    }
  }, [storageKey]);

  useEffect(() => {
    setSelected((current) => {
      const next = current.filter((id) => rows.some((row) => String(getRowId(row)) === String(id)));
      return next.length === current.length ? current : next;
    });
  }, [rows, getRowId]);

  useEffect(() => {
    if (onSelectionChange) onSelectionChange(rows.filter((row) => selected.some((id) => String(id) === String(getRowId(row)))));
  }, [selected, rows, getRowId, onSelectionChange]);

  const filtered = useMemo(() => rows.filter((row) => {
    const matchesSearch = !search.trim() || columns.some((col) => {
      const value = getValue(row, col);
      return value !== null && value !== undefined && String(value).toLowerCase().includes(search.trim().toLowerCase());
    });
    const matchesFilters = Object.entries(filters).every(([field, values]) => !values?.length || values.some((value) => String(row[field]) === String(value)));
    return matchesSearch && matchesFilters;
  }), [rows, search, columns, filters]);

  const sorted = useMemo(() => {
    if (!orderBy) return filtered;
    const col = columns.find((c) => c.field === orderBy);
    if (!col) return filtered;
    return [...filtered].sort((a, b) => {
      const va = getValue(a, col); const vb = getValue(b, col);
      if (va === vb) return 0;
      const comparison = va == null ? -1 : vb == null ? 1 : va > vb ? 1 : -1;
      return order === "asc" ? comparison : -comparison;
    });
  }, [filtered, orderBy, order, columns]);

  const paginated = useMemo(() => sorted.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage), [sorted, page, rowsPerPage]);
  const selectedRows = useMemo(() => rows.filter((row) => selected.some((id) => String(id) === String(getRowId(row)))), [rows, selected, getRowId]);
  const hasActiveFilters = Boolean(search || Object.values(filters).some((values) => values?.length));

  useEffect(() => {
    const lastPage = Math.max(0, Math.ceil(sorted.length / rowsPerPage) - 1);
    if (page > lastPage) setPage(lastPage);
  }, [sorted.length, rowsPerPage, page]);

  const toggleFilter = (field, value) => {
    setFilters((current) => {
      const currentValues = current[field] || [];
      const values = currentValues.some((item) => String(item) === String(value))
        ? currentValues.filter((item) => String(item) !== String(value))
        : [...currentValues, value];
      return { ...current, [field]: values };
    });
    setPage(0);
  };

  const resetFilters = () => { setSearch(""); setFilters({}); setPage(0); };
  const handleSort = (field) => {
    if (orderBy === field) setOrder((current) => current === "asc" ? "desc" : "asc");
    else { setOrderBy(field); setOrder("asc"); }
  };
  const toggleRow = (row) => {
    const id = getRowId(row);
    setSelected((current) => current.some((item) => String(item) === String(id)) ? current.filter((item) => String(item) !== String(id)) : [...current, id]);
  };
  const toggleAll = () => {
    const pageIds = paginated.map(getRowId);
    const allSelected = pageIds.every((id) => selected.some((item) => String(item) === String(id)));
    setSelected((current) => allSelected ? current.filter((id) => !pageIds.some((pageId) => String(pageId) === String(id))) : [...new Set([...current, ...pageIds])]);
  };
  const resizeColumn = (field, event) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = event.currentTarget.parentElement.getBoundingClientRect().width;
    const move = (moveEvent) => setColumnWidths((current) => ({ ...current, [field]: Math.max(90, startWidth + moveEvent.clientX - startX) }));
    const stop = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", stop); };
    window.addEventListener("mousemove", move); window.addEventListener("mouseup", stop);
  };
  const exportCsv = () => {
    const escape = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    const csv = [selectableColumns.map((col) => escape(col.headerName)).join(","), ...sorted.map((row) => selectableColumns.map((col) => escape(getValue(row, col))).join(","))].join("\n");
    const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = "exportacion-erp.csv"; link.click(); URL.revokeObjectURL(link.href);
  };
  const saveView = () => {
    const name = window.prompt("Nombre para este filtro");
    if (!name?.trim()) return;
    const view = { name: name.trim(), search, filters, hiddenColumns, orderBy, order };
    const next = [...savedViews.filter((item) => item.name !== view.name), view];
    setSavedViews(next); window.localStorage.setItem(`${storageKey}:views`, JSON.stringify(next));
  };
  const applyView = (view) => { setSearch(view.search || ""); setFilters(view.filters || {}); setHiddenColumns(view.hiddenColumns || []); setOrderBy(view.orderBy || null); setOrder(view.order || "asc"); setPage(0); setSavedAnchor(null); };
  const statusChip = (value) => {
    const tone = STATUS_TONES[normalise(value)] || "default";
    return <Chip size="small" label={String(value)} color={tone} variant={tone === "default" ? "outlined" : "filled"} />;
  };
  const allPageSelected = paginated.length > 0 && paginated.every((row) => selected.some((id) => String(id) === String(getRowId(row))));

  return (
    <Paper variant="outlined" sx={{ borderRadius: 3, overflow: "hidden" }}>
      <Stack direction={{ xs: "column", lg: "row" }} spacing={1.25} alignItems={{ lg: "center" }} justifyContent="space-between" sx={{ p: { xs: 1.5, sm: 2 }, borderBottom: "1px solid", borderColor: "divider" }}>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ sm: "center" }} flexWrap="wrap">
          {searchable && <TextField size="small" placeholder={searchPlaceholder} value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} sx={{ width: { xs: "100%", sm: 280 } }} InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment>, endAdornment: search ? <InputAdornment position="end"><IconButton size="small" aria-label="Limpiar búsqueda" onClick={() => setSearch("")}><ClearIcon fontSize="small" /></IconButton></InputAdornment> : null }} />}
          <Button size="small" startIcon={<FilterListIcon />} onClick={(event) => setFilterAnchor(event.currentTarget)} variant={Object.values(filters).some((values) => values?.length) ? "contained" : "outlined"}>Filtros{Object.values(filters).filter((values) => values?.length).length ? ` (${Object.values(filters).filter((values) => values?.length).length})` : ""}</Button>
          {hasActiveFilters && <Button size="small" color="inherit" onClick={resetFilters}>Limpiar</Button>}
          {toolbarExtra}
        </Stack>
        <Stack direction="row" spacing={0.25} alignItems="center" flexWrap="wrap">
          {selected.length > 0 && <Chip color="primary" label={`${selected.length} seleccionados`} onDelete={() => setSelected([])} sx={{ mr: 0.5 }} />}
          {selectedRows.length > 0 && bulkActions.map((action) => <Button key={action.label} size="small" color={action.color || "primary"} onClick={() => action.onClick(selectedRows)}>{action.label}</Button>)}
          <Tooltip title="Guardar filtros"><IconButton aria-label="Guardar filtros" size="small" onClick={saveView}><SaveOutlinedIcon fontSize="small" /></IconButton></Tooltip>
          <Tooltip title="Filtros guardados"><IconButton aria-label="Filtros guardados" size="small" onClick={(event) => setSavedAnchor(event.currentTarget)}><MoreVertIcon fontSize="small" /></IconButton></Tooltip>
          <Tooltip title="Mostrar u ocultar columnas"><IconButton aria-label="Columnas" size="small" onClick={(event) => setColumnsAnchor(event.currentTarget)}><ViewColumnIcon fontSize="small" /></IconButton></Tooltip>
          <Tooltip title="Exportar CSV"><IconButton aria-label="Exportar CSV" size="small" onClick={exportCsv}><FileDownloadOutlinedIcon fontSize="small" /></IconButton></Tooltip>
        </Stack>
      </Stack>

      <Menu anchorEl={filterAnchor} open={Boolean(filterAnchor)} onClose={() => setFilterAnchor(null)} PaperProps={{ sx: { maxHeight: 390, minWidth: 245 } }}>
        {Object.keys(filterOptions).length === 0 ? <MenuItem disabled>No hay filtros rápidos disponibles</MenuItem> : Object.entries(filterOptions).map(([field, values], groupIndex) => <Box key={field}>{groupIndex > 0 && <Divider />}<Typography variant="overline" color="text.secondary" sx={{ px: 2, pt: 1.25, display: "block" }}>{columns.find((col) => col.field === field)?.headerName}</Typography>{values.map((value) => <MenuItem key={String(value)} dense onClick={() => toggleFilter(field, value)}><Checkbox size="small" checked={(filters[field] || []).some((item) => String(item) === String(value))} /><ListItemText primary={String(value)} /></MenuItem>)}</Box>)}
      </Menu>
      <Menu anchorEl={columnsAnchor} open={Boolean(columnsAnchor)} onClose={() => setColumnsAnchor(null)} PaperProps={{ sx: { maxHeight: 390 } }}>
        {columns.map((col) => <MenuItem key={col.field} dense onClick={() => setHiddenColumns((current) => current.includes(col.field) ? current.filter((field) => field !== col.field) : [...current, col.field])}><Checkbox size="small" checked={!hiddenColumns.includes(col.field)} /><ListItemText primary={col.headerName || "Acciones"} /></MenuItem>)}
      </Menu>
      <Menu anchorEl={savedAnchor} open={Boolean(savedAnchor)} onClose={() => setSavedAnchor(null)}>
        {savedViews.length === 0 ? <MenuItem disabled>No hay filtros guardados</MenuItem> : savedViews.map((view) => <MenuItem key={view.name} onClick={() => applyView(view)}>{view.name}</MenuItem>)}
      </Menu>

      <TableContainer sx={{ maxHeight: 560, "& .MuiTableCell-root": { py: dense ? 1 : 1.35 } }}>
        <Table stickyHeader size={dense ? "small" : "medium"} sx={{ minWidth: 650 }}>
          <TableHead><TableRow>
            <TableCell padding="checkbox"><Checkbox size="small" checked={allPageSelected} indeterminate={!allPageSelected && selected.some((id) => paginated.some((row) => String(id) === String(getRowId(row))))} onChange={toggleAll} inputProps={{ "aria-label": "Seleccionar filas de esta página" }} /></TableCell>
            {selectableColumns.map((col) => <TableCell key={col.field} align={col.align || "left"} sx={{ minWidth: columnWidths[col.field] || col.minWidth || 120, width: columnWidths[col.field], position: "relative", whiteSpace: "nowrap" }}>
              {col.sortable === false ? col.headerName : <TableSortLabel active={orderBy === col.field} direction={orderBy === col.field ? order : "asc"} onClick={() => handleSort(col.field)}>{col.headerName}</TableSortLabel>}
              <Box onMouseDown={(event) => resizeColumn(col.field, event)} sx={{ position: "absolute", top: 0, right: -3, width: 7, height: "100%", cursor: "col-resize", zIndex: 2, "&:hover": { bgcolor: "primary.main", opacity: 0.65 } }} />
            </TableCell>)}
            {rowActions.length > 0 && <TableCell align="right">Más</TableCell>}
            {recordDrawer && <TableCell align="right">Detalle</TableCell>}
          </TableRow></TableHead>
          <TableBody>
            {loading ? Array.from({ length: Math.min(rowsPerPage, 6) }, (_, rowIndex) => <TableRow key={`loading-${rowIndex}`}>{Array.from({ length: selectableColumns.length + 1 + (rowActions.length ? 1 : 0) + (recordDrawer ? 1 : 0) }, (_, colIndex) => <TableCell key={colIndex}><Skeleton animation="wave" width={`${48 + ((rowIndex + colIndex) % 3) * 16}%`} /></TableCell>)}</TableRow>) : paginated.length === 0 ? <TableRow><TableCell colSpan={selectableColumns.length + 2 + (rowActions.length ? 1 : 0) + (recordDrawer ? 1 : 0)} align="center" sx={{ py: 7 }}><Typography variant="body2" color="text.secondary">{emptyMessage}</Typography></TableCell></TableRow> : paginated.map((row) => <TableRow key={getRowId(row)} hover selected={selected.some((id) => String(id) === String(getRowId(row)))} onClick={onRowClick ? () => onRowClick(row) : undefined} sx={{ cursor: onRowClick ? "pointer" : "default", transition: "background-color .14s ease", "&:last-child td": { borderBottom: 0 } }}>
              <TableCell padding="checkbox" onClick={(event) => event.stopPropagation()}><Checkbox size="small" checked={selected.some((id) => String(id) === String(getRowId(row)))} onChange={() => toggleRow(row)} inputProps={{ "aria-label": "Seleccionar registro" }} /></TableCell>
              {selectableColumns.map((col) => <TableCell key={col.field} align={col.align || "left"} sx={{ maxWidth: columnWidths[col.field], overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{col.renderCell ? col.renderCell(row) : col.field === "estado" ? statusChip(getValue(row, col)) : getValue(row, col)}</TableCell>)}
              {rowActions.length > 0 && <TableCell align="right" onClick={(event) => event.stopPropagation()}><IconButton size="small" aria-label="Más acciones" onClick={(event) => { setActiveRow(row); setRowActionAnchor(event.currentTarget); }}><MoreVertIcon fontSize="small" /></IconButton></TableCell>}
              {recordDrawer && <TableCell align="right" onClick={(event) => event.stopPropagation()}><Tooltip title="Ver detalles"><IconButton size="small" aria-label="Ver detalles" onClick={() => setDrawerRow(row)}><VisibilityIcon fontSize="small" /></IconButton></Tooltip></TableCell>}
            </TableRow>)}
          </TableBody>
        </Table>
      </TableContainer>
      <Menu anchorEl={rowActionAnchor} open={Boolean(rowActionAnchor)} onClose={() => setRowActionAnchor(null)}>{rowActions.map((action) => <MenuItem key={action.label} disabled={action.disabled?.(activeRow)} onClick={() => { action.onClick(activeRow); setRowActionAnchor(null); }}>{action.icon && <Box sx={{ display: "inline-flex", mr: 1 }}>{action.icon}</Box>}{action.label}</MenuItem>)}</Menu>
      <TablePagination component="div" count={sorted.length} page={page} onPageChange={(_, nextPage) => setPage(nextPage)} rowsPerPage={rowsPerPage} onRowsPerPageChange={(event) => { setRowsPerPage(parseInt(event.target.value, 10)); setPage(0); }} rowsPerPageOptions={rowsPerPageOptions} labelRowsPerPage="Filas por página" labelDisplayedRows={({ from, to, count }) => `${from}–${to} de ${count}`} sx={{ borderTop: "1px solid", borderColor: "divider", ".MuiTablePagination-toolbar": { minHeight: 58 } }} />
      <RecordDrawer open={Boolean(drawerRow)} onClose={() => setDrawerRow(null)} row={drawerRow} columns={columns} getValue={getValue} title={typeof drawerTitle === "function" ? drawerTitle(drawerRow) : drawerTitle} onEdit={(onDrawerEdit || onRowClick) ? (row) => { setDrawerRow(null); (onDrawerEdit || onRowClick)(row); } : null} history={drawerHistory} audit={drawerAudit} documents={drawerDocuments} />
    </Paper>
  );
}
