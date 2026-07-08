// Uso: npm run crear-admin -- "Tu Nombre" tu@email.com tuPassword123
require("dotenv").config();
const { db } = require("./db");
const { hashPassword } = require("./auth");

const [, , nombre, email, password] = process.argv;
if (!nombre || !email || !password) {
  console.log('Uso: npm run crear-admin -- "Tu Nombre" tu@email.com tuPassword123');
  process.exit(1);
}
if (password.length < 8) {
  console.error("La contraseña debe tener al menos 8 caracteres.");
  process.exit(1);
}

const rolAdmin = db.prepare("SELECT id FROM roles WHERE nombre = 'admin'").get();
if (!rolAdmin) {
  // No debería pasar nunca: db.js siembra los roles al cargar schema.sql,
  // y ese require ya se ejecutó arriba. Se deja como defensa adicional.
  console.error("No existe el rol 'admin' en la base de datos. Revisa schema.sql.");
  process.exit(1);
}

try {
  const info = db.prepare("INSERT INTO usuarios (nombre, email, password_hash, rol_id) VALUES (?, ?, ?, ?)")
    .run(nombre, email, hashPassword(password), rolAdmin.id);
  console.log(`Usuario admin creado con id ${info.lastInsertRowid}. Ya puedes hacer login con ${email}.`);
} catch (e) {
  console.error("Error: ¿ya existe ese email?", e.message);
}
