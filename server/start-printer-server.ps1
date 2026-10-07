# Startar skrivarservern dolt i bakgrunden (http://127.0.0.1:5196/). Loggar till data/printer/server.log
$root = Split-Path -Parent $PSScriptRoot
$log = Join-Path $root 'data\printer\server.log'
New-Item -ItemType Directory -Force (Split-Path $log) | Out-Null
$py = (Get-Command python.exe).Source
Start-Process -FilePath $py -ArgumentList @("`"$PSScriptRoot\printer_server.py`"") -WindowStyle Hidden `
  -RedirectStandardOutput $log -RedirectStandardError "$log.err"
