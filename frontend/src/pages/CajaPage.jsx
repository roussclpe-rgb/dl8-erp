import { useState } from "react";
import { Box, Tabs, Tab } from "@mui/material";

import PageHeader from "../components/PageHeader";
import CajaActualTab from "../components/caja/CajaActualTab";
import HistorialTurnosTab from "../components/caja/HistorialTurnosTab";
import CajasAdminTab from "../components/caja/CajasAdminTab";
import { useAuth } from "../context/AuthContext";

export default function CajaPage() {
  const { hasRole } = useAuth();
  const [tab, setTab] = useState(0);
  const esAdmin = hasRole("admin");

  return (
    <Box>
      <PageHeader title="Caja" subtitle="Apertura, cierre, arqueo y movimientos de las cajas del negocio." />

      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 3 }}>
        <Tab label="Caja actual" />
        <Tab label="Historial de turnos" />
        {esAdmin && <Tab label="Cajas" />}
      </Tabs>

      {tab === 0 && <CajaActualTab />}
      {tab === 1 && <HistorialTurnosTab />}
      {tab === 2 && esAdmin && <CajasAdminTab />}
    </Box>
  );
}
