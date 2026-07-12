const DB = require("better-sqlite3");
const db = new DB("data.sqlite", { readonly: true });

const tablas = db.prepare(`
  SELECT name
  FROM sqlite_master
  WHERE type = 'table'
    AND name NOT LIKE 'sqlite_%'
  ORDER BY name
`).all();

for (const { name } of tablas) {
  try {
    const total = db.prepare(`SELECT COUNT(*) AS total FROM "${name}"`).get().total;
    console.log(name.padEnd(45), total);
  } catch (e) {
    console.log(name, "ERROR", e.message);
  }
}

db.close();
