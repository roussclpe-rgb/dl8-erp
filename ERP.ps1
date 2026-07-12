Clear-Host

$RUTA = "C:\Users\ASUS\Downloads\dl8-erp-completo\dl8-erp"

function MostrarMenu {

    Clear-Host

    Write-Host "================================="
    Write-Host "        ERP PANADERIA"
    Write-Host "================================="
    Write-Host ""

    Write-Host "1 - Abrir modo PRUEBAS"
    Write-Host "2 - Abrir modo NEGOCIO"
    Write-Host "3 - Abrir proyecto en VS Code"
    Write-Host "4 - Hacer backup del negocio"
    Write-Host "5 - Ver estado de bases de datos"
    Write-Host "6 - Salir"
    Write-Host ""

}


function AbrirERP($modo) {

    Write-Host ""
    Write-Host "Iniciando ERP $modo..."
    Write-Host ""

    if ($modo -eq "pruebas") {

        $comandoBackend = "npm run dev:pruebas"

    }
    else {

        # Backup automático antes de abrir negocio
        BackupNegocio

        $comandoBackend = "npm run dev:negocio"

    }


    Start-Process powershell `
        -ArgumentList "-NoExit", "-Command", "cd '$RUTA\backend'; $comandoBackend"


    Start-Process powershell `
        -ArgumentList "-NoExit", "-Command", "cd '$RUTA\frontend'; npm run dev"


    Start-Sleep -Seconds 3


    Write-Host ""
    Write-Host "================================="
    Write-Host "ERP iniciado correctamente"
    Write-Host "================================="
    Write-Host ""
    Write-Host "Frontend:"
    Write-Host "http://localhost:5173"
    Write-Host ""
    Write-Host "Backend:"
    Write-Host "http://localhost:3001"

}

function BackupNegocio {

    $fecha = Get-Date -Format "yyyy-MM-dd_HH-mm"

    $origen = "$RUTA\backend\data.sqlite"

    if (Test-Path $origen) {

        Copy-Item `
        $origen `
        "$RUTA\backend\backup_data_$fecha.sqlite"

        Write-Host ""
        Write-Host " Backup creado:"
        Write-Host "backup_data_$fecha.sqlite"
        Write-Host ""

    }
    else {

        Write-Host ""
        Write-Host " No existe data.sqlite todavía"
        Write-Host ""

    }

}

function RestaurarBackup {

    Clear-Host

    Write-Host "================================="
    Write-Host "   RESTAURAR BACKUP NEGOCIO"
    Write-Host "================================="
    Write-Host ""

    $backups = Get-ChildItem "$RUTA\backend" -Filter "backup_data_*.sqlite" |
    Sort-Object LastWriteTime -Descending


    if ($backups.Count -eq 0) {

        Write-Host "No existen backups disponibles."
        Pause
        return

    }


    Write-Host "Backups disponibles:"
    Write-Host ""


    for ($i = 0; $i -lt $backups.Count; $i++) {

        Write-Host "$($i+1) - $($backups[$i].Name)"

    }


    Write-Host ""

    $seleccion = Read-Host "Seleccione backup a restaurar"


    if ($seleccion -lt 1 -or $seleccion -gt $backups.Count) {

        Write-Host "Seleccion invalida"
        Pause
        return

    }


    $backupElegido = $backups[$seleccion-1]


    Write-Host ""
    Write-Host "⚠️ ATENCION"
    Write-Host "Se reemplazará la base actual del negocio:"
    Write-Host "data.sqlite"
    Write-Host ""
    Write-Host "Por:"
    Write-Host $backupElegido.Name
    Write-Host ""


    $confirmar = Read-Host "¿Continuar? (S/N)"


    if ($confirmar -eq "S" -or $confirmar -eq "s") {


        # Backup antes de restaurar
        $fecha = Get-Date -Format "yyyy-MM-dd_HH-mm"

        Copy-Item `
        "$RUTA\backend\data.sqlite" `
        "$RUTA\backend\backup_antes_restaurar_$fecha.sqlite"


        Copy-Item `
        $backupElegido.FullName `
        "$RUTA\backend\data.sqlite" `
        -Force


        Write-Host ""
        Write-Host "✅ Restauracion completada"
        Write-Host ""

    }
    else {

        Write-Host ""
        Write-Host "Cancelado"

    }


    Pause

}

function ActualizarERP {

    Clear-Host

    Write-Host "================================="
    Write-Host "     ACTUALIZAR ERP DESDE GITHUB"
    Write-Host "================================="
    Write-Host ""

    Set-Location $RUTA


    Write-Host "Verificando cambios locales..."
    git status


    Write-Host ""
    $confirmar = Read-Host "¿Continuar con la actualización? (S/N)"


    if ($confirmar -ne "S" -and $confirmar -ne "s") {

        Write-Host "Cancelado"
        Pause
        return

    }


    Write-Host ""
    Write-Host "Guardando cambios locales temporales..."

    git stash


    Write-Host ""
    Write-Host "Descargando cambios desde GitHub..."

    git pull


    Write-Host ""
    Write-Host "Actualizando backend..."

    Set-Location "$RUTA\backend"

    npm install


    Write-Host ""
    Write-Host "Actualizando frontend..."

    Set-Location "$RUTA\frontend"

    npm install


    Set-Location $RUTA


    Write-Host ""
    Write-Host "================================="
    Write-Host "✅ ERP actualizado correctamente"
    Write-Host "================================="
    Write-Host ""

    Pause

}

function EstadoBD {

    Write-Host ""
    Write-Host "Bases de datos encontradas:"
    Write-Host ""

    Get-ChildItem "$RUTA\backend" -Filter "*.sqlite" |
    Select-Object Name, Length, LastWriteTime

    Pause
}



while ($true) {

    MostrarMenu

    $opcion = Read-Host "Seleccione una opcion"


    switch ($opcion) {

        "1" {
            AbrirERP "pruebas"
            Pause
        }


        "2" {

    Clear-Host

    Write-Host "================================="
    Write-Host "       ⚠️ MODO NEGOCIO"
    Write-Host "================================="
    Write-Host ""
    Write-Host "Estas entrando a la base REAL del negocio."
    Write-Host ""
    Write-Host "Aqui las ventas, clientes, caja e inventario"
    Write-Host "seran datos reales."
    Write-Host ""

    $confirmar = Read-Host "¿Deseas continuar? (S/N)"

    if ($confirmar -eq "S" -or $confirmar -eq "s") {

        AbrirERP "negocio"
        Pause

    }
    else {

        Write-Host ""
        Write-Host "Cancelado. Regresando al menu..."
        Start-Sleep -Seconds 2

    }
}


        "3" {
            code $RUTA
        }


        "4" {
            BackupNegocio
            Pause
        }


        "5" {
            EstadoBD
        }


        "6" {
            Write-Host "Cerrando ERP..."
            break
        }

        "7" {
            RestaurarBackup
        }

        "8" {
            ActualizarERP
        }

        default {
            Write-Host "Opcion incorrecta"
            Pause
        }

    }

}