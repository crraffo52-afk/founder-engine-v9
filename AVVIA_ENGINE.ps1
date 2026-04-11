# THE FOUNDER ENGINE V9.0 - SCRIPT DI AVVIO AUTOMATICO

Write-Host "--- AVVIO DI THE FOUNDER ENGINE V9.0 ---" -ForegroundColor Cyan

# 1. Avvio del server Mock AI in background
Write-Host "Sto avviando il motore AI (Porta 3001)..." -ForegroundColor Yellow
Start-Process -FilePath "node" -ArgumentList "server.js" -WindowStyle Hidden

# 2. Avvio del Frontend Vite in background con accessibilità esterna
Write-Host "Sto avviando l'interfaccia grafica (Porta 3000)..." -ForegroundColor Yellow
Start-Process -FilePath "cmd.exe" -ArgumentList "/c npm run dev -- --host" -WindowStyle Hidden

# 3. Attesa per la stabilizzazione dei server
Write-Host "In attesa di stabilizzazione (5 secondi)..."
Start-Sleep -Seconds 5

# 4. Avvio del Tunnel Cloudflare e cattura dell'URL pubblico
Write-Host "Sto creando il tunnel pubblico per l'accesso remoto..." -ForegroundColor Green
Write-Host "--- URL PUBBLICO DI OGGI ---" -ForegroundColor Cyan
./cloudflared.exe tunnel --url http://127.0.0.1:3000 2>&1 | Tee-Object -FilePath "ultimo_tunnel.log" | Select-String "trycloudflare.com"

Write-Host "`nIl tunnel e' attivo! Non chiudere questa finestra finche' vuoi che il link sia raggiungibile." -ForegroundColor Cyan
Read-Host "Premi INVIO per terminare tutto e chiudere"

# Cleanup alla chiusura
Get-Process -Name "node" -ErrorAction SilentlyContinue | Stop-Process -Force
Get-Process -Name "cloudflared" -ErrorAction SilentlyContinue | Stop-Process -Force
