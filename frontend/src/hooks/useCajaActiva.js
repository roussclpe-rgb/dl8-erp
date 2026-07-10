import { useState, useCallback, useEffect } from "react";
import { turnoActualCaja } from "../api/endpoints";

const STORAGE_KEY = "erp_caja_id";

// Caja "activa" para el usuario en este navegador: qué caja física está
// operando y, si tiene un turno abierto, su resumen (para poder enlazar
// pagos de ventas al turno sin que cada pantalla tenga que resolverlo).
// La selección persiste en localStorage igual que erp_theme_mode, para que
// un cajero no tenga que re-seleccionar su caja en cada recarga.
export function useCajaActiva() {
  const [cajaId, setCajaIdState] = useState(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? Number(raw) : null;
  });
  const [turno, setTurno] = useState(null);
  const [loading, setLoading] = useState(false);

  const setCajaId = useCallback((id) => {
    if (id) localStorage.setItem(STORAGE_KEY, String(id));
    else localStorage.removeItem(STORAGE_KEY);
    setCajaIdState(id || null);
  }, []);

  const refrescar = useCallback(async () => {
    if (!cajaId) {
      setTurno(null);
      return;
    }
    setLoading(true);
    try {
      setTurno(await turnoActualCaja(cajaId));
    } catch {
      setTurno(null);
    } finally {
      setLoading(false);
    }
  }, [cajaId]);

  useEffect(() => {
    refrescar();
  }, [refrescar]);

  return { cajaId, setCajaId, turno, turnoAbierto: !!turno, loading, refrescar };
}
