@echo off
cd /d "%~dp0"
call venv\Scripts\activate.bat
echo ============================================================
echo   Stable Diffusion Backend (LITE)  
echo ============================================================
echo.
echo Spustam server...
echo Pri prvom spusteni sa stiahne model (~2GB)
echo.
python app-lite.py
pause
