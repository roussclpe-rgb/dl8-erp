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

## Configuración local segura

1. Copia `.env.example` como `.env`.
2. Genera `JWT_SECRET` con `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
3. Para Vite local usa `CORS_ORIGINS=http://localhost:5173`.
4. Usa `npm run dev` para desarrollo y `npm run dev:negocio` únicamente con la configuración de producción completa.

El archivo `.env` nunca debe subirse a Git. En desarrollo, si falta el secreto, el proceso usa un secreto efímero; los tokens dejan de ser válidos al reiniciar. En producción el backend se niega a iniciar si el secreto o CORS son inseguros.

## Respaldo y restauración SQLite

El respaldo usa la API `backup()` de SQLite a través de `better-sqlite3`; incluye transacciones confirmadas aunque la base esté en modo WAL y verifica `PRAGMA integrity_check` antes y después.

```powershell
node scripts/sqlite-safety.js backup --source .\data.sqlite --directory .\backups
```

Se conservan los 14 respaldos más recientes. Para restaurar, detén primero backend y frontend:

```powershell
node scripts/sqlite-safety.js restore --backup .\backups\data-AAAA-MM-DD-HHMMSS.sqlite --target .\data.sqlite --directory .\backups
```

La restauración comprueba que los puertos 3001 y 5173 estén libres, valida el archivo elegido, crea un respaldo previo, retira WAL/SHM antiguos y verifica la base final. `ERP.ps1` ejecuta estas mismas operaciones y siempre deriva las rutas desde su propia ubicación.
