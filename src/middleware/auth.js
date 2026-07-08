const { verificarToken } = require("../auth");

function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Falta el token de autenticación" });
  }
  try {
    const payload = verificarToken(header.slice(7));
    req.usuario = payload; // { id, nombre, rol }
    next();
  } catch (e) {
    return res.status(401).json({ error: "Token inválido o expirado" });
  }
}

// Uso: requireRole('admin') o requireRole('admin', 'operador')
function requireRole(...rolesPermitidos) {
  return (req, res, next) => {
    if (!req.usuario) return res.status(401).json({ error: "No autenticado" });
    if (!rolesPermitidos.includes(req.usuario.rol)) {
      return res.status(403).json({ error: `Esta acción requiere rol: ${rolesPermitidos.join(" o ")}` });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole };
