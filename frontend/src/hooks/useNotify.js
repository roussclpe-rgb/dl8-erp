import { useSnackbar } from "notistack";
import { useCallback } from "react";

export function useNotify() {
  const { enqueueSnackbar } = useSnackbar();

  const success = useCallback((msg) => enqueueSnackbar(msg, { variant: "success" }), [enqueueSnackbar]);
  const error = useCallback((msg) => enqueueSnackbar(msg?.message || msg || "Ocurrió un error", { variant: "error" }), [enqueueSnackbar]);
  const info = useCallback((msg) => enqueueSnackbar(msg, { variant: "info" }), [enqueueSnackbar]);
  const warning = useCallback((msg) => enqueueSnackbar(msg, { variant: "warning" }), [enqueueSnackbar]);

  return { success, error, info, warning };
}
