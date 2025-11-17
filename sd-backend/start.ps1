# Spúšťací skript pre Stable Diffusion Backend
Write-Host "=" -NoNewline -ForegroundColor Cyan
Write-Host ("=" * 59) -ForegroundColor Cyan
Write-Host "  Stable Diffusion Backend Server" -ForegroundColor Yellow
Write-Host "=" -NoNewline -ForegroundColor Cyan
Write-Host ("=" * 59) -ForegroundColor Cyan
Write-Host ""

# Kontrola virtuálneho prostredia
if (-not (Test-Path "venv")) {
    Write-Host "✗ Virtuálne prostredie neexistuje!" -ForegroundColor Red
    Write-Host "  Spustite najprv: " -NoNewline
    Write-Host ".\install.ps1" -ForegroundColor Cyan
    exit 1
}

# Aktivácia a spustenie
Write-Host "Aktivujem virtuálne prostredie..." -ForegroundColor Cyan
& ".\venv\Scripts\Activate.ps1"

Write-Host "Spúšťam server..." -ForegroundColor Cyan
Write-Host ""
python app.py
