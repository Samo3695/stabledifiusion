# Inštalačný skript pre Stable Diffusion Backend
Write-Host "=" -NoNewline -ForegroundColor Cyan
Write-Host ("=" * 59) -ForegroundColor Cyan
Write-Host "  Stable Diffusion Backend - Inštalácia" -ForegroundColor Yellow
Write-Host "=" -NoNewline -ForegroundColor Cyan
Write-Host ("=" * 59) -ForegroundColor Cyan
Write-Host ""

# Kontrola Python
Write-Host "Kontrolujem Python..." -ForegroundColor Cyan
try {
    $pythonVersion = python --version 2>&1
    Write-Host "✓ $pythonVersion" -ForegroundColor Green
} catch {
    Write-Host "✗ Python nie je nainštalovaný!" -ForegroundColor Red
    Write-Host "  Stiahnite Python 3.10+ z https://www.python.org/" -ForegroundColor Yellow
    exit 1
}

# Vytvorenie virtuálneho prostredia
Write-Host ""
Write-Host "Vytváram virtuálne prostredie..." -ForegroundColor Cyan
if (Test-Path "venv") {
    Write-Host "✓ Virtuálne prostredie už existuje" -ForegroundColor Green
} else {
    python -m venv venv
    Write-Host "✓ Virtuálne prostredie vytvorené" -ForegroundColor Green
}

# Aktivácia virtuálneho prostredia
Write-Host ""
Write-Host "Aktivujem virtuálne prostredie..." -ForegroundColor Cyan
& ".\venv\Scripts\Activate.ps1"

# Inštalácia závislostí
Write-Host ""
Write-Host "Inštalujem závislosti..." -ForegroundColor Cyan
Write-Host "⏳ Toto môže trvať 5-10 minút..." -ForegroundColor Yellow
python -m pip install --upgrade pip
pip install -r requirements.txt

Write-Host ""
Write-Host "=" -NoNewline -ForegroundColor Green
Write-Host ("=" * 59) -ForegroundColor Green
Write-Host "  ✓ Inštalácia dokončená!" -ForegroundColor Green
Write-Host "=" -NoNewline -ForegroundColor Green
Write-Host ("=" * 59) -ForegroundColor Green
Write-Host ""
Write-Host "Ďalšie kroky:" -ForegroundColor Yellow
Write-Host "1. Spustite server: " -NoNewline
Write-Host "python app.py" -ForegroundColor Cyan
Write-Host "2. Otvorte Vue aplikáciu: " -NoNewline
Write-Host "http://localhost:5173" -ForegroundColor Cyan
Write-Host ""
Write-Host "⚠️  Pri prvom spustení sa stiahne ~4GB model!" -ForegroundColor Yellow
