$raiz = [System.IO.Path]::GetFullPath($PSScriptRoot)
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location -LiteralPath '$raiz\backend'; npm run dev:pruebas"

Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location -LiteralPath '$raiz\frontend'; npm run dev"
