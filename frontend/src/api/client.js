import axios from "axios";

const client = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "/api",
});

client.interceptors.request.use((config) => {
  const token = localStorage.getItem("erp_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

client.interceptors.response.use(
  (res) => res,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem("erp_token");
      localStorage.removeItem("erp_usuario");
      if (!window.location.pathname.startsWith("/login")) {
        window.location.href = "/login";
      }
    }
    const mensaje = error.response?.data?.error || error.message || "Error de red";
    const errorNormalizado = new Error(mensaje);
    errorNormalizado.status = error.response?.status;
    return Promise.reject(errorNormalizado);
  }
);

export default client;
