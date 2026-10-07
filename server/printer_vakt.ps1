# Vakt: startar skrivarservern om port 5196 inte lyssnar (körs vid inloggning + var 10:e minut)
$busy = Get-NetTCPConnection -LocalPort 5196 -State Listen -ErrorAction SilentlyContinue
if (-not $busy) { & "$PSScriptRoot\start-printer-server.ps1" }
