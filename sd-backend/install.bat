@echo off
echo ============================================================
echo   Stable Diffusion Backend - Instalacia
echo ============================================================
echo.

echo Kontrolujem Python...
python --version >nul 2>&1
if errorlevel 1 (
    echo [X] Python nie je nainstalovany!
    echo     Stiahnite Python 3.10+ z https://www.python.org/
    pause
    exit /b 1
)
echo [OK] Python najdeny

echo.
echo Vytvorenie virtualneho prostredia...
if exist venv (
    echo [OK] Virtualne prostredie uz existuje
) else (
    python -m venv venv
    echo [OK] Virtualne prostredie vytvorene
)

echo.
echo Aktivacia virtualneho prostredia...
call venv\Scripts\activate.bat

echo.
echo Instalacia zavislosti...
echo Toto moze trvat 5-10 minut...
python -m pip install --upgrade pip
pip install -r requirements.txt

echo.
echo ============================================================
echo   [OK] Instalacia dokoncena!
echo ============================================================
echo.
echo Dalsie kroky:
echo 1. Spustite server: start.bat
echo 2. Otvorte Vue aplikaciu: http://localhost:5173
echo.
echo Pri prvom spusteni sa stiahne ~4GB model!
echo.
pause
