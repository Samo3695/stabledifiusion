@echo off
cd /d "%~dp0"
call venv\Scripts\activate.bat
echo ============================================================
echo   Demo Backend Server (bez AI modelu)
echo ============================================================
echo.
echo Tento server generuje DEMO obrazky (farebne stvorcee)
echo Pre pouzitie skutocneho AI modelu je potrebna silnejsia GPU
echo.
echo Spustam server...
echo.
python app-demo.py
pause
