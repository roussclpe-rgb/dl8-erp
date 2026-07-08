import { useMemo, useState } from "react";
import {
  Box,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TableSortLabel,
  TextField,
  InputAdornment,
  CircularProgress,
  Typography,
  Stack,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";

/**
 * Tabla genérica reutilizable para cualquier módulo futuro.
 *
 * columns: [{ field, headerName, align, sortable, minWidth, valueGetter(row), renderCell(row) }]
 * rows: array de objetos
 * getRowId: (row) => string|number
 */
export default function DataTable({
  columns,
  rows,
  loading = false,
  getRowId = (r) => r.id,
  searchable = true,
  searchPlaceholder = "Buscar…",
  defaultOrderBy = null,
  defaultOrder = "asc",
  emptyMessage = "No hay registros para mostrar.",
  toolbarExtra = null,
  onRowClick = null,
  dense = false,
  rowsPerPageOptions = [10, 25, 50],
}) {
  const [search, setSearch] = useState("");
  const [orderBy, setOrderBy] = useState(defaultOrderBy);
  const [order, setOrder] = useState(defaultOrder);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(rowsPerPageOptions[0]);

  const getValue = (row, col) => (col.valueGetter ? col.valueGetter(row) : row[col.field]);

  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.trim().toLowerCase();
    return rows.filter((row) =>
      columns.some((col) => {
        const val = getValue(row, col);
        return val !== null && val !== undefined && String(val).toLowerCase().includes(q);
      })
    );
  }, [rows, search, columns]);

  const sorted = useMemo(() => {
    if (!orderBy) return filtered;
    const col = columns.find((c) => c.field === orderBy);
    if (!col) return filtered;
    const copy = [...filtered];
    copy.sort((a, b) => {
      const va = getValue(a, col);
      const vb = getValue(b, col);
      if (va === vb) return 0;
      const cmp = va === null || va === undefined ? -1 : vb === null || vb === undefined ? 1 : va > vb ? 1 : -1;
      return order === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [filtered, orderBy, order, columns]);

  const paginated = useMemo(
    () => sorted.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage),
    [sorted, page, rowsPerPage]
  );

  const handleSort = (field) => {
    if (orderBy === field) {
      setOrder(order === "asc" ? "desc" : "asc");
    } else {
      setOrderBy(field);
      setOrder("asc");
    }
  };

  return (
    <Paper variant="outlined" sx={{ borderRadius: 3, overflow: "hidden" }}>
      {(searchable || toolbarExtra) && (
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={2}
          alignItems={{ sm: "center" }}
          justifyContent="space-between"
          sx={{ p: 2, borderBottom: "1px solid", borderColor: "divider" }}
        >
          {searchable ? (
            <TextField
              size="small"
              placeholder={searchPlaceholder}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
              sx={{ maxWidth: 320, width: "100%" }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" />
                  </InputAdornment>
                ),
              }}
            />
          ) : (
            <Box />
          )}
          {toolbarExtra}
        </Stack>
      )}

      <TableContainer sx={{ maxHeight: 560 }}>
        <Table stickyHeader size={dense ? "small" : "medium"}>
          <TableHead>
            <TableRow>
              {columns.map((col) => (
                <TableCell key={col.field} align={col.align || "left"} sx={{ minWidth: col.minWidth }}>
                  {col.sortable === false ? (
                    col.headerName
                  ) : (
                    <TableSortLabel
                      active={orderBy === col.field}
                      direction={orderBy === col.field ? order : "asc"}
                      onClick={() => handleSort(col.field)}
                    >
                      {col.headerName}
                    </TableSortLabel>
                  )}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={columns.length} align="center" sx={{ py: 6 }}>
                  <CircularProgress size={28} />
                </TableCell>
              </TableRow>
            ) : paginated.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} align="center" sx={{ py: 6 }}>
                  <Typography variant="body2" color="text.secondary">
                    {emptyMessage}
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              paginated.map((row) => (
                <TableRow
                  key={getRowId(row)}
                  hover
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  sx={{ cursor: onRowClick ? "pointer" : "default" }}
                >
                  {columns.map((col) => (
                    <TableCell key={col.field} align={col.align || "left"}>
                      {col.renderCell ? col.renderCell(row) : getValue(row, col)}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <TablePagination
        component="div"
        count={sorted.length}
        page={page}
        onPageChange={(_, p) => setPage(p)}
        rowsPerPage={rowsPerPage}
        onRowsPerPageChange={(e) => {
          setRowsPerPage(parseInt(e.target.value, 10));
          setPage(0);
        }}
        rowsPerPageOptions={rowsPerPageOptions}
        labelRowsPerPage="Filas por página"
        labelDisplayedRows={({ from, to, count }) => `${from}–${to} de ${count}`}
      />
    </Paper>
  );
}
