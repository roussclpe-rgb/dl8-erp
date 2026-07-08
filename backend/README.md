# ERP Panadería — Backend

API con inventario, compras, recetas, producción, costeo completo (materia prima
FIFO/vencimiento + mano de obra + indirectos), roles de usuario, control de
vencimientos y cierre de periodos contables. SQLite por defecto (un archivo,
cero configuración); ver `schema.sql` para las notas `-- PG:` de migración a
PostgreSQL.

## Instalación

```bash
npm install
cp .env.example .env        # y edita JWT_SECRET por algo tuyo
npm run crear-admin -- "Tu Nombre" tu@email.com tuPasswordSeguro
npm start                   # o: npm run dev (reinicia solo al guardar)
```

La API queda en `http://localhost:3001/api`. `data.sqlite` se crea solo la
primera vez que arrancas (con todas las tablas, roles e índices ya listos).

## Flujo típico

1. `POST /api/auth/login` con `{ email, password }` → `token`. Todas las demás
   rutas requieren `Authorization: Bearer <token>`.
2. `POST /api/usuarios` (solo admin) para dar de alta empleados, con
   `rol` = `admin` | `operador` | `lectura`.
3. Da de alta ingredientes, proveedores y recetas; registra compras,
   producción y ajustes. Cada acción queda auditada (quién, cuándo, por qué)
   y el historial nunca se reescribe: editar genera una reversión + un
   movimiento nuevo.

Ver `/api/salud` para comprobar que el servidor está corriendo.
