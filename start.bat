@echo off
echo ===================================================
echo Iniciando el servidor de Bar Wall Street...
echo ===================================================

cd backend

echo Abriendo interfaces en el navegador (POS y Wall Street)...
timeout /t 2 /nobreak > NUL
start chrome "http://localhost:8000/pos"
start chrome "http://localhost:8000/wallstreet"

echo Levantando el backend...
venv\Scripts\python.exe main.py

pause
