const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const VALOR_INSEGURO = "cambia-esto-en-produccion";
const JWT_SECRET_ENV = process.env.JWT_SECRET;

// En producción, negarse a arrancar si JWT_SECRET no está configurado o
// sigue siendo el valor de ejemplo: firmar tokens con un secreto conocido
// públicamente equivale a no tener autenticación.
if ((!JWT_SECRET_ENV || JWT_SECRET_ENV === VALOR_INSEGURO) && process.env.NODE_ENV === "production") {
  throw new Error(
    "JWT_SECRET no está configurado con un valor seguro. Defínelo en .env (por ejemplo con `openssl rand -hex 32`) antes de arrancar en producción."
  );
}

const JWT_SECRET = JWT_SECRET_ENV || VALOR_INSEGURO; // el valor inseguro solo se usa en desarrollo local
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
