Write-Host "===================================================" -ForegroundColor Cyan
Write-Host "Iniciando el servidor de Bar Wall Street..." -ForegroundColor Green
Write-Host "===================================================" -ForegroundColor Cyan

Set-Location .\backend

Write-Host "Levantando el backend en segundo plano..." -ForegroundColor Yellow
Start-Sleep -Seconds 2

Write-Host "Abriendo interfaces en el navegador (POS y Wall Street)..." -ForegroundColor Yellow
Start-Process "chrome.exe" "http://localhost:8000/pos"
Start-Process "chrome.exe" "http://localhost:8000/wallstreet"

.\venv\Scripts\python.exe main.py
