import { lazy, Suspense } from "react";
import { Routes, Route, Navigate } from "react-router-dom";

import ProtectedRoute from "./components/ProtectedRoute";
import DashboardLayout from "./layout/DashboardLayout";
import PageState from "./components/PageState";
import GlobalCommandPalette from "./components/GlobalCommandPalette";

import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import CentroActividadesPage from "./pages/CentroActividadesPage";
import IngredientesPage from "./pages/IngredientesPage";
import ProveedoresPage from "./pages/ProveedoresPage";
import ComprasPage from "./pages/ComprasPage";
import AjustesPage from "./pages/AjustesPage";
import RecetasPage from "./pages/RecetasPage";
import ProduccionesPage from "./pages/ProduccionesPage";
import MermasPage from "./pages/MermasPage";
import ReportesPage from "./pages/ReportesPage";
import PeriodosPage from "./pages/PeriodosPage";
import ConfigCostosPage from "./pages/ConfigCostosPage";
import UsuariosPage from "./pages/UsuariosPage";
import VentasPage from "./pages/VentasPage";
import CajaPage from "./pages/CajaPage";
const FinanzasPage = lazy(() => import("./pages/FinanzasPage"));
const PoliticasFinancierasPage = lazy(() => import("./pages/PoliticasFinancierasPage"));
const MovimientosEspecialesPage = lazy(() => import("./pages/MovimientosEspecialesPage"));
const DondeEstaMiDineroPage = lazy(() => import("./pages/DondeEstaMiDineroPage"));
const FlujoDineroPage = lazy(() => import("./pages/FlujoDineroPage"));
const AuditoriaFinancieraPage = lazy(() => import("./pages/AuditoriaFinancieraPage"));
const MetasFinancierasPage = lazy(() => import("./pages/MetasFinancierasPage"));
const AlertasFinancierasPage = lazy(() => import("./pages/AlertasFinancierasPage"));
const EscenariosFinancierosPage = lazy(() => import("./pages/EscenariosFinancierosPage"));
const PrediccionesFinancierasPage = lazy(() => import("./pages/PrediccionesFinancierasPage"));
const ObjetivosNegocioPage = lazy(() => import("./pages/ObjetivosNegocioPage"));
const diferida = (Pagina) => <Suspense fallback={<PageState type="loading" title="Cargando módulo" description="Estamos preparando esta sección." />}><Pagina /></Suspense>;

export default function App() {
  return (
    <>
    <Routes>
      <Route path="/login" element={<Login />} />

      <Route
        path="/"
        element={
          <ProtectedRoute>
            <DashboardLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<CentroActividadesPage />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="centro-actividades" element={<CentroActividadesPage />} />
        <Route path="ingredientes" element={<IngredientesPage />} />
        <Route path="proveedores" element={<ProveedoresPage />} />
        <Route path="compras" element={<ComprasPage />} />
        <Route path="ventas" element={<VentasPage />} />
        <Route path="caja" element={<CajaPage />} />
        <Route path="finanzas" element={diferida(FinanzasPage)} />
        <Route path="politicas-financieras" element={diferida(PoliticasFinancierasPage)} />
        <Route path="movimientos-especiales" element={diferida(MovimientosEspecialesPage)} />
        <Route path="donde-esta-mi-dinero" element={diferida(DondeEstaMiDineroPage)} />
        <Route path="flujo-dinero" element={diferida(FlujoDineroPage)} />
        <Route path="auditoria-financiera" element={diferida(AuditoriaFinancieraPage)} />
        <Route path="metas-financieras" element={diferida(MetasFinancierasPage)} />
        <Route path="alertas-financieras" element={diferida(AlertasFinancierasPage)} />
        <Route path="escenarios-financieros" element={diferida(EscenariosFinancierosPage)} />
        <Route path="predicciones-financieras" element={diferida(PrediccionesFinancierasPage)} />
        <Route path="objetivos-negocio" element={diferida(ObjetivosNegocioPage)} />
        <Route path="ajustes" element={<AjustesPage />} />
        <Route path="recetas" element={<RecetasPage />} />
        <Route path="producciones" element={<ProduccionesPage />} />
        <Route path="mermas" element={<MermasPage />} />
        <Route path="reportes" element={<ReportesPage />} />
        <Route path="periodos" element={<PeriodosPage />} />
        <Route path="config-costos" element={<ConfigCostosPage />} />
        <Route
          path="usuarios"
          element={
            <ProtectedRoute roles={["admin"]}>
              <UsuariosPage />
            </ProtectedRoute>
          }
        />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    <GlobalCommandPalette />
    </>
  );
}
