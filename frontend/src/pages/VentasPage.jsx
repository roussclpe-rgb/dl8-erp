import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Box, Tabs, Tab } from "@mui/material";

import PageHeader from "../components/PageHeader";
import VenderTab from "../components/ventas/VenderTab";
import PorCobrarTab from "../components/ventas/PorCobrarTab";
import ClientesTab from "../components/ventas/ClientesTab";
import CatalogoVentaTab from "../components/ventas/CatalogoVentaTab";

export default function VentasPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState(0);

  useEffect(() => {
    if (searchParams.get("tab") === "por-cobrar") setTab(1);
  }, [searchParams]);

  const cambiarTab = (_, value) => {
    setTab(value);
    if (searchParams.has("tab")) setSearchParams({}, { replace: true });
  };

  return (
    <Box>
      <PageHeader
        title="Ventas"
        subtitle="Registra ventas, cobra saldos pendientes y administra tu catalogo de precios."
      />

      <Tabs value={tab} onChange={cambiarTab} sx={{ mb: 3 }}>
        <Tab label="Vender" />
        <Tab label="Por cobrar" />
        <Tab label="Clientes" />
        <Tab label="Catalogo de precios" />
      </Tabs>

      {tab === 0 && <VenderTab />}
      {tab === 1 && <PorCobrarTab />}
      {tab === 2 && <ClientesTab />}
      {tab === 3 && <CatalogoVentaTab />}
    </Box>
  );
}
