const express = require("express");
const rateLimit = require("express-rate-limit");
const { db } = require("../db");
const { verificarPassword, generarToken } = require("../auth");

const router = express.Router();

// Máximo 5 intentos de login cada 15 min por IP: mitiga fuerza bruta de contraseñas.
const limiteLogin = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Demasiados intentos de login. Espera unos minutos e intenta de nuevo." },
});

router.post("/login", limiteLogin, (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Falta email o password" });

  const usuario = db.prepare(`
    SELECT u.*, r.nombre AS rol_nombre FROM usuarios u
    JOIN roles r ON r.id = u.rol_id
    WHERE u.email = ? AND u.activo = 1
  `).get(email);

  if (!usuario || !verificarPassword(password, usuario.password_hash)) {
    return res.status(401).json({ error: "Credenciales inválidas" });
  }

  const token = generarToken(usuario);
  res.json({ token, usuario: { id: usuario.id, nombre: usuario.nombre, rol: usuario.rol_nombre } });
});

module.exports = router;
