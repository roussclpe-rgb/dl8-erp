const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const VALOR_INSEGURO = "cambia-esto-en-produccion";
const JWT_SECRET_ENV = process.env.JWT_SECRET;

const esDesarrollo = process.env.NODE_ENV === "development";

if ((!JWT_SECRET_ENV || JWT_SECRET_ENV === VALOR_INSEGURO) && !esDesarrollo) {
  throw new Error(
    "JWT_SECRET no está configurado con un valor seguro. Agrega JWT_SECRET en el archivo .env."
  );
}

const JWT_SECRET = JWT_SECRET_ENV || VALOR_INSEGURO;
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
