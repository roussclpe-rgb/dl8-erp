const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");

const esDesarrollo = process.env.NODE_ENV === "development";
const JWT_SECRET_ENV = process.env.JWT_SECRET?.trim();
const pareceInseguro = !JWT_SECRET_ENV || JWT_SECRET_ENV.length < 32 || /cambia|reemplaza|ejemplo|secret/i.test(JWT_SECRET_ENV);

if (pareceInseguro && !esDesarrollo) {
  throw new Error(
    "JWT_SECRET debe estar configurado con al menos 32 caracteres aleatorios. Revisa backend/.env."
  );
}

// Desarrollo sin .env usa un secreto efímero distinto en cada proceso, nunca uno público conocido.
const JWT_SECRET = pareceInseguro ? crypto.randomBytes(32).toString("hex") : JWT_SECRET_ENV;
const JWT_EXPIRES = "12h";

function hashPassword(password) {
  return bcrypt.hashSync(password, 10);
}
function verificarPassword(password, hash) {
  return bcrypt.compareSync(password, hash);
}
function generarToken(usuario) {
  return jwt.sign(
    { id: usuario.id, nombre: usuario.nombre, rol: usuario.rol_nombre },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES }
  );
}
function verificarToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

module.exports = { hashPassword, verificarPassword, generarToken, verificarToken };
