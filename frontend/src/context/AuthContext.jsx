import { createContext, useContext, useState, useCallback, useMemo } from "react";
import { login as apiLogin } from "../api/endpoints";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [usuario, setUsuario] = useState(() => {
    const raw = localStorage.getItem("erp_usuario");
    return raw ? JSON.parse(raw) : null;
  });

  const login = useCallback(async (email, password) => {
    const { token, usuario: u } = await apiLogin(email, password);
    localStorage.setItem("erp_token", token);
    localStorage.setItem("erp_usuario", JSON.stringify(u));
    setUsuario(u);
    return u;
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem("erp_token");
    localStorage.removeItem("erp_usuario");
    setUsuario(null);
  }, []);

  const hasRole = useCallback((...roles) => !!usuario && roles.includes(usuario.rol), [usuario]);

  const value = useMemo(
    () => ({ usuario, login, logout, hasRole, isAuthenticated: !!usuario }),
    [usuario, login, logout, hasRole]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth debe usarse dentro de AuthProvider");
  return ctx;
}
