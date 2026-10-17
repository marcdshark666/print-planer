# Printplaneraren

Privat sida bakom Husvakt-login: https://desktop-r13nmtb.tailf9ee87.ts.net/skrivare/ (server `server/printer_server.py`, port 5196, start med `server/start-printer-server.ps1`).

## Fliken iPad-filer (#ipad-filer)

Marc laddar upp STL/3MF/OBJ/STEP/G-code/ZIP/PNG/JPG/PDF från iPaden (max 500 MB per fil) via knappen "Välj filer / Ladda upp".

- Filerna ligger på datorn i `print-planer/data/printer/ipad-filer/` (gitignorerad via `data/printer/`, aldrig publik).
- Förteckning (namn, ursprungligt namn, storlek, sha256, tid, typ): `data/printer/ipad-filer/index.json`. Claude/Codex hämtar filerna därifrån.
- Raderade filer flyttas till `data/printer/ipad-filer/.papperskorg/` (aldrig permanent radering).
- API: `POST /api/ipad-filer` (rå ström, filnamn i headern `X-Filnamn` URL-kodat, kräver Content-Length), `GET /api/ipad-filer`, `GET /ipad-filer-fil/<namn>`, `DELETE /api/ipad-filer/<namn>`. Samma sessionskontroll som övriga /api (localhost utan login ok).
