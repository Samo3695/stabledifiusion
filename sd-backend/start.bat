@echo off
echo ============================================================
echo   Stable Diffusion Backend Server
echo ============================================================
echo.

if not exist venv (
    echo [X] Virtualne prostredie neexistuje!
    echo     Spustite najprv: install.bat
    pause
    exit /b 1
)

echo Aktivacia virtualneho prostredia...
call venv\Scripts\activate.bat

echo Spustam server...
echo.
python app.py

pause
