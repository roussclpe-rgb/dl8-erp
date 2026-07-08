require("dotenv").config();
const express = require("express");
const cors = require("cors");

const app = express();

// CORS_ORIGINS vacío = abierto (cómodo en desarrollo local).
// En producción, define CORS_ORIGINS en .env con dominios separados por coma.
const origenes = (process.env.CORS_ORIGINS || "").split(",").map((o) => o.trim()).filter(Boolean);
app.use(cors(origenes.length ? { origin: origenes } : {}));

app.use(express.json());

app.use("/api/auth", require("./routes/auth"));
app.use("/api/usuarios", require("./routes/usuarios"));
app.use("/api/proveedores", require("./routes/proveedores"));
app.use("/api/ingredientes", require("./routes/ingredientes"));
app.use("/api/compras", require("./routes/compras"));
app.use("/api/ajustes", require("./routes/ajustes"));
app.use("/api/recetas", require("./routes/recetas"));
app.use("/api/producciones", require("./routes/producciones"));
app.use("/api/mermas", require("./routes/mermas"));
app.use("/api/periodos", require("./routes/periodos"));
app.use("/api/config-costos", require("./routes/configCostos"));
app.use("/api/reportes", require("./routes/reportes"));

app.get("/api/salud", (req, res) => res.json({ ok: true }));

// 404 explícito para rutas no definidas
app.use((req, res) => res.status(404).json({ error: "Ruta no encontrada" }));

// Manejador de errores centralizado: cualquier throw no atrapado en una ruta
// cae aquí en vez de tumbar el servidor o devolver un HTML de error crudo.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || "Error interno" });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`API corriendo en http://localhost:${PORT}`));
