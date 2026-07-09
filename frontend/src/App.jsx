import { Routes, Route, Navigate } from "react-router-dom";

import ProtectedRoute from "./components/ProtectedRoute";
import DashboardLayout from "./layout/DashboardLayout";

import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
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

export default function App() {
  return (
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
        <Route index element={<Dashboard />} />
        <Route path="ingredientes" element={<IngredientesPage />} />
        <Route path="proveedores" element={<ProveedoresPage />} />
        <Route path="compras" element={<ComprasPage />} />
        <Route path="ventas" element={<VentasPage />} />
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
  );
}
