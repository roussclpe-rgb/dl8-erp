Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd backend; npm run dev:pruebas"

Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd frontend; npm run dev"