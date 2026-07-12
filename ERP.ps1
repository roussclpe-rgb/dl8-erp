$ErrorActionPreference = "Stop"
$RUTA = [System.IO.Path]::GetFullPath($PSScriptRoot)
$BACKEND = Join-Path $RUTA "backend"
$FRONTEND = Join-Path $RUTA "frontend"
$ENV_FILE = Join-Path $BACKEND ".env"
$BACKUPS = Join-Path $BACKEND "backups"

function Leer-Env {
    param([string]$Ruta)
    $valores = @{}
    foreach ($linea in Get-Content -LiteralPath $Ruta) {
        $texto = $linea.Trim()
        if (!$texto -or $texto.StartsWith("#") -or !$texto.Contains("=")) { continue }
        $partes = $texto.Split("=", 2)
        $valores[$partes[0].Trim()] = $partes[1].Trim().Trim('"').Trim("'")
    }
    return $valores
}

function Resolver-RutaBD {
    param([hashtable]$Env)
    $configurada = if ($Env.ContainsKey("DB_PATH") -and $Env.DB_PATH) { $Env.DB_PATH } else { "data.sqlite" }
    if ([System.IO.Path]::IsPathRooted($configurada)) { return [System.IO.Path]::GetFullPath($configurada) }
    return [System.IO.Path]::GetFullPath((Join-Path $BACKEND $configurada))
}

function Puerto-Ocupado {
    param([int]$Puerto)
    return $null -ne (Get-NetTCPConnection -State Listen -LocalPort $Puerto -ErrorAction SilentlyContinue | Select-Object -First 1)
}

function Validar-Repositorio {
    if (!(Test-Path -LiteralPath $BACKEND -PathType Container)) { throw "No existe la carpeta backend en $RUTA" }
    if (!(Test-Path -LiteralPath $FRONTEND -PathType Container)) { throw "No existe la carpeta frontend en $RUTA" }
    if (!(Test-Path -LiteralPath $ENV_FILE -PathType Leaf)) {
        throw "Falta backend/.env. Copia backend/.env.example, configura JWT_SECRET, CORS_ORIGINS y DB_PATH, y vuelve a ejecutar."
    }
    $envLocal = Leer-Env $ENV_FILE
    $jwt = if ($envLocal.ContainsKey("JWT_SECRET")) { $envLocal.JWT_SECRET } else { "" }
    if ($jwt.Length -lt 32 -or $jwt -match "cambia|reemplaza|ejemplo|secret") {
        throw "JWT_SECRET debe tener al menos 32 caracteres aleatorios y no puede ser un valor de ejemplo."
    }
    if (!$envLocal.ContainsKey("CORS_ORIGINS") -or [string]::IsNullOrWhiteSpace($envLocal.CORS_ORIGINS)) {
        throw "CORS_ORIGINS debe indicar al menos un origen permitido, por ejemplo http://localhost:5173."
    }
    $base = Resolver-RutaBD $envLocal
    if (!(Test-Path -LiteralPath $base -PathType Leaf)) { throw "No existe la base configurada en DB_PATH: $base" }
    return @{ Env = $envLocal; Base = $base }
}

function Puertos-Disponibles {
    $ocupados = @(3001, 5173 | Where-Object { Puerto-Ocupado $_ })
    if ($ocupados.Count) {
        Write-Host "No se puede continuar. Puertos ocupados: $($ocupados -join ', ')." -ForegroundColor Red
        Write-Host "Cierra el backend/frontend que ya estén ejecutándose o usa esa instancia existente."
        return $false
    }
    return $true
}

function Backup-Negocio {
    param([string]$Base)
    New-Item -ItemType Directory -Path $BACKUPS -Force | Out-Null
    & node (Join-Path $BACKEND "scripts\sqlite-safety.js") backup --source $Base --directory $BACKUPS
    if ($LASTEXITCODE -ne 0) { throw "El respaldo SQLite falló; no se iniciará el modo negocio." }
}

function Abrir-ERP {
    param([ValidateSet("pruebas", "negocio")][string]$Modo, [string]$Base)
    if (!(Puertos-Disponibles)) { return }
    if ($Modo -eq "negocio") { Backup-Negocio $Base }
    $comandoBackend = if ($Modo -eq "pruebas") { "npm run dev:pruebas" } else { "npm run dev:negocio" }
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location -LiteralPath '$BACKEND'; $comandoBackend"
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location -LiteralPath '$FRONTEND'; npm run dev"
    Write-Host "ERP $Modo iniciado desde $RUTA"
    Write-Host "Frontend: http://localhost:5173"
    Write-Host "Backend:  http://localhost:3001"
}

function Restaurar-Backup {
    param([string]$Base)
    if (!(Puertos-Disponibles)) { Write-Host "La restauración exige backend y frontend detenidos." -ForegroundColor Red; return }
    $archivos = @(Get-ChildItem -LiteralPath $BACKUPS -File -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -match '^data-\d{4}-\d{2}-\d{2}-\d{6}\.sqlite$' } |
        Sort-Object LastWriteTime -Descending)
    if (!$archivos.Count) { Write-Host "No existen respaldos disponibles en $BACKUPS"; return }
    for ($i = 0; $i -lt $archivos.Count; $i++) { Write-Host "$($i + 1) - $($archivos[$i].Name)" }
    $seleccion = 0
    if (![int]::TryParse((Read-Host "Selecciona el respaldo"), [ref]$seleccion) -or $seleccion -lt 1 -or $seleccion -gt $archivos.Count) { Write-Host "Selección inválida"; return }
    if ((Read-Host "Escribe RESTAURAR para reemplazar la base configurada") -cne "RESTAURAR") { Write-Host "Restauración cancelada"; return }
    & node (Join-Path $BACKEND "scripts\sqlite-safety.js") restore --backup $archivos[$seleccion - 1].FullName --target $Base --directory $BACKUPS
    if ($LASTEXITCODE -ne 0) { throw "La restauración no se completó." }
}

function Actualizar-ERP {
    Set-Location -LiteralPath $RUTA
    if (git status --porcelain) { Write-Host "Hay cambios locales. Confírmalos o guárdalos antes de actualizar." -ForegroundColor Red; return }
    if ((Read-Host "Escribe ACTUALIZAR para ejecutar git pull --ff-only e instalar dependencias") -cne "ACTUALIZAR") { Write-Host "Actualización cancelada"; return }
    git pull --ff-only
    if ($LASTEXITCODE -ne 0) { throw "git pull --ff-only falló." }
    npm --prefix $BACKEND install
    if ($LASTEXITCODE -ne 0) { throw "npm install del backend falló." }
    npm --prefix $FRONTEND install
    if ($LASTEXITCODE -ne 0) { throw "npm install del frontend falló." }
}

function Mostrar-Menu {
    Clear-Host
    Write-Host "================================="
    Write-Host "          ERP PANADERÍA"
    Write-Host "================================="
    Write-Host "Repositorio: $RUTA"
    Write-Host "1 - Abrir modo PRUEBAS"
    Write-Host "2 - Abrir modo NEGOCIO"
    Write-Host "3 - Abrir proyecto en VS Code"
    Write-Host "4 - Hacer respaldo del negocio"
    Write-Host "5 - Ver estado de la base configurada"
    Write-Host "6 - Restaurar un respaldo"
    Write-Host "7 - Actualizar código"
    Write-Host "8 - Salir"
}

try { $configuracion = Validar-Repositorio }
catch { Write-Host "No se puede iniciar ERP.ps1: $($_.Exception.Message)" -ForegroundColor Red; exit 1 }

$salir = $false
while (!$salir) {
    Mostrar-Menu
    switch (Read-Host "Selecciona una opción") {
        "1" { Abrir-ERP "pruebas" $configuracion.Base; Pause }
        "2" {
            if ((Read-Host "Escribe NEGOCIO para usar la base real") -ceq "NEGOCIO") { Abrir-ERP "negocio" $configuracion.Base }
            else { Write-Host "Inicio cancelado" }
            Pause
        }
        "3" { code $RUTA }
        "4" { Backup-Negocio $configuracion.Base; Pause }
        "5" { Get-Item -LiteralPath $configuracion.Base | Select-Object FullName, Length, LastWriteTime; Pause }
        "6" { Restaurar-Backup $configuracion.Base; Pause }
        "7" { Actualizar-ERP; Pause }
        "8" { $salir = $true }
        default { Write-Host "Opción incorrecta"; Pause }
    }
}
