#!/usr/bin/env python3
"""Skrivarserver for Elegoo Centauri Carbon 2 (endast lasning, aldrig start/paus/skicka).

Lyssnar bara pa 127.0.0.1 (standardport 5196). Hamtar config fran server/.printer.json
(utanfor git). Exponerar /api/status, /api/snapshot, /api/snapshots, /api/timelapses
och serverar print-planer-sajten sa dashboarden ar same-origin (ingen CORS, ingen
inloggning: samma som Husvakten/Spelkontroll). Lyssnar bara pa loopback; utat\nnas den via tailscale serve --set-path /skrivare (tailnet, aldrig Funnel).

Anvandning:  python server/printer_server.py [--port 5196]
"""
import argparse, glob, hashlib, hmac, html, http.client, json, mimetypes, os, re, shutil, subprocess, sys
import secrets, threading, time, urllib.request
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, unquote, parse_qs, quote

import paho.mqtt.client as mqtt

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)                      # print-planer/
DATA = os.path.join(ROOT, 'data', 'printer')
SNAPS = os.path.join(DATA, 'snapshots')
TLAPSE = os.path.join(DATA, 'timelapse')
FRAMES = os.path.join(DATA, 'frames')
HISTORY = os.path.join(DATA, 'history.jsonl')
for d in (SNAPS, TLAPSE, FRAMES):
    os.makedirs(d, exist_ok=True)

SNAP_EVERY = 3600          # sek mellan timsnapshots under utskrift
FRAME_EVERY = 120          # sek mellan egna timelapse-frames under utskrift
DONE_STATES = {'', 'completed', 'complete', 'finished', 'stopped', 'stoppped', 'failed',
               'cancelled', 'canceled', 'idle', 'exception', 'ready'}
ONLINE_WITHIN = 30

cfg = json.load(open(os.path.join(HERE, '.printer.json'), encoding='utf-8-sig'))
SN = cfg['sn']
CID = 'printplaner_' + str(os.getpid())
lock = threading.Lock()
status = {}                # sammanslagen status (deep merge)
last_msg = 0.0
fw = {}
state = {'job': None, 'last_snap': 0, 'last_frame': 0, 'active': False, 'seen_states': []}
cam = {'jpg': None, 'ts': 0.0}
cam_lock = threading.Lock()


def log(*a):
    print(datetime.now().strftime('%H:%M:%S'), *a, flush=True)   # aldrig access code


def merge(dst, src):
    for k, v in src.items():
        if isinstance(v, dict) and isinstance(dst.get(k), dict):
            merge(dst[k], v)
        else:
            dst[k] = v


# ---------------- kamera ----------------
def grab_frame():
    c = http.client.HTTPConnection(cfg['ip'], cfg.get('camera_port', 8080), timeout=8)
    try:
        c.request('GET', '/')
        r = c.getresponse()
        buf = b''
        deadline = time.time() + 8
        while time.time() < deadline and len(buf) < 3_000_000:
            chunk = r.read(4096)
            if not chunk:
                break
            buf += chunk
            i = buf.find(b'\xff\xd8')
            if i >= 0:
                j = buf.find(b'\xff\xd9', i)
                if j >= 0:
                    return buf[i:j + 2]
    finally:
        c.close()
    return None


def get_snapshot(max_age=2.0):
    with cam_lock:
        if cam['jpg'] and time.time() - cam['ts'] < max_age:
            return cam['jpg']
        try:
            j = grab_frame()
        except Exception as e:
            log('kamera fel:', type(e).__name__)
            j = None
        if j:
            cam['jpg'], cam['ts'] = j, time.time()
        return cam['jpg'] if cam['jpg'] and time.time() - cam['ts'] < 60 else None


# ---------------- MQTT ----------------
try:
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION1, CID)
except Exception:
    client = mqtt.Client(CID)
client.username_pw_set(cfg['user'], cfg['password'])
history_tasks = []
req_id = [2000]


def request(method, params=None):          # endast lasmetoder anvands
    assert method in (1001, 1002, 1036, 1044), 'endast lasmetoder tillatna'
    req_id[0] += 1
    client.publish(f'elegoo/{SN}/{CID}/api_request',
                   json.dumps({'id': req_id[0], 'method': method, 'params': params or {}}))


def on_connect(c, u, f, rc, *a):
    log('MQTT connect rc', rc)
    c.subscribe(f'elegoo/{SN}/api_status')
    c.subscribe(f'elegoo/{SN}/{CID}/api_response')
    c.subscribe(f'elegoo/{SN}/{CID}_req/register_response')
    c.publish(f'elegoo/{SN}/api_register', json.dumps({'client_id': CID, 'request_id': CID + '_req'}))
    time.sleep(1)
    request(1001)
    request(1002)


def on_message(c, u, msg):
    global last_msg, history_tasks
    try:
        j = json.loads(msg.payload.decode('utf-8', 'replace'))
    except Exception:
        return
    res = j.get('result') if isinstance(j, dict) else None
    if not isinstance(res, dict):
        return
    with lock:
        last_msg = time.time()
        if msg.topic.endswith('api_status') or j.get('method') == 1002:
            merge(status, {k: v for k, v in res.items() if k != 'error_code'})
        elif j.get('method') == 1001:
            fw.update({k: v for k, v in res.items() if k != 'error_code'})
        elif j.get('method') == 1036:
            history_tasks = res.get('history_task_list') or []


client.on_connect, client.on_message = on_connect, on_message


def mqtt_loop():
    while True:
        try:
            client.connect(cfg['ip'], cfg.get('mqtt_port', 1883), 30)
            client.loop_forever(retry_first_connection=True)
        except Exception as e:
            log('MQTT fel:', type(e).__name__)
            time.sleep(10)


# ---------------- status-sammanfattning ----------------
def summary():
    with lock:
        s = json.loads(json.dumps(status))
        online = (time.time() - last_msg) < ONLINE_WITHIN
        f = dict(fw)
    ps, ms = s.get('print_status', {}), s.get('machine_status', {})
    pstate = str(ps.get('state', '')).lower()
    active = bool(ps.get('filename')) and pstate not in DONE_STATES
    total = ps.get('total_layer') or ps.get('total_layers')
    return {
        'online': online, 'ts': int(time.time()), 'model': f.get('machine_model'),
        'hostname': f.get('hostname'), 'firmware': (f.get('software_version') or {}).get('ota_version'),
        'printing': active, 'state': ps.get('state', ''), 'machine_status': ms.get('status'),
        'filename': ps.get('filename', ''), 'progress': ms.get('progress'),
        'remaining_sec': ps.get('remaining_time_sec'), 'print_sec': ps.get('print_duration'),
        'total_sec': ps.get('total_duration'),
        'layer': ps.get('current_layer'), 'total_layers': total,
        'nozzle': s.get('extruder', {}).get('temperature'), 'nozzle_target': s.get('extruder', {}).get('target'),
        'bed': s.get('heater_bed', {}).get('temperature'), 'bed_target': s.get('heater_bed', {}).get('target'),
        'chamber': s.get('ztemperature_sensor', {}).get('temperature'),
        'filament_detected': s.get('extruder', {}).get('filament_detected'),
        'fans': {k: v.get('speed') for k, v in (s.get('fans') or {}).items() if isinstance(v, dict)},
        'led': (s.get('led') or {}).get('status'), 'camera': (s.get('external_device') or {}).get('camera'),
        'exceptions': ms.get('exception_status'),
        'raw': s,
    }


# ---------------- snapshots / timelapse ----------------
def safe(n):
    return re.sub(r'[^A-Za-z0-9._-]+', '_', n or 'jobb')[:60]


def save_snapshot(tag):
    j = get_snapshot(0)
    if not j:
        return
    name = f"{datetime.now():%Y%m%d-%H%M%S}_{safe(tag)}.jpg"
    with open(os.path.join(SNAPS, name), 'wb') as f:
        f.write(j)
    log('snapshot', name)


def save_frame():
    j = get_snapshot(0)
    if j and state['job']:
        d = os.path.join(FRAMES, state['job'])
        os.makedirs(d, exist_ok=True)
        n = len(os.listdir(d))
        with open(os.path.join(d, f'f{n:06d}.jpg'), 'wb') as f:
            f.write(j)


def ffmpeg_exe():
    p = shutil.which('ffmpeg')
    if p:
        return p
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return None


def build_own_timelapse(job):
    d = os.path.join(FRAMES, job)
    frames = sorted(glob.glob(os.path.join(d, 'f*.jpg')))
    if len(frames) < 5:
        log('for fa frames for timelapse:', len(frames))
        return
    ff = ffmpeg_exe()
    if not ff:
        log('ffmpeg saknas - frames sparade i', d)
        return
    out = os.path.join(TLAPSE, job + '_egen.mp4')
    r = subprocess.run([ff, '-y', '-framerate', '24', '-i', os.path.join(d, 'f%06d.jpg'),
                        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', out],
                       capture_output=True, timeout=900)
    log('egen timelapse', 'klar' if r.returncode == 0 else 'misslyckades', out)


def fetch_printer_timelapses():
    """Kopiera timelapse som skrivaren sjalv skapat (history-metod 1036) om URL finns."""
    request(1036, {'offset': 0, 'limit': 10})
    time.sleep(3)
    got = 0
    with lock:
        tasks = list(history_tasks)
    for t in tasks:
        url = t.get('time_lapse_video_url') or t.get('timelapse_url')
        if not url:
            continue
        name = safe(str(t.get('task_id') or t.get('task_name'))) + '.mp4'
        dest = os.path.join(TLAPSE, name)
        if os.path.exists(dest):
            continue
        try:
            urllib.request.urlretrieve(url, dest + '.part')
            os.replace(dest + '.part', dest)
            got += 1
            log('timelapse fran skrivaren kopierad', name)
        except Exception as e:
            log('timelapse-nedladdning misslyckades:', type(e).__name__)
    return got


def job_finished(job):
    save_snapshot('slut')
    got = 0
    for _ in range(4):                       # skrivaren renderar timelapse efter slut
        time.sleep(60)
        try:
            got = fetch_printer_timelapses()
        except Exception as e:
            log('historik fel:', type(e).__name__)
        if got:
            break
    if not got:
        build_own_timelapse(job)


def watcher():
    last_hist = 0
    last_poll = 0
    while True:
        time.sleep(5)
        try:
            if time.time() - last_poll > 10:        # status halls farsk
                request(1002)
                if not fw:
                    request(1001)
                last_poll = time.time()
            s = summary()
            if s['online'] and s['state'] not in state['seen_states']:
                state['seen_states'].append(s['state'])
                log('sett state:', repr(s['state']), 'machine_status', s['machine_status'])
            now = time.time()
            if s['printing'] and not state['active']:
                state.update(active=True, job=f"{datetime.now():%Y%m%d-%H%M%S}_{safe(s['filename'])}",
                             last_snap=now, last_frame=now)
                log('utskrift startad', s['filename'])
                save_snapshot('start')
                save_frame()
            elif s['printing']:
                if now - state['last_snap'] >= SNAP_EVERY:
                    state['last_snap'] = now
                    save_snapshot('timme')
                if now - state['last_frame'] >= FRAME_EVERY:
                    state['last_frame'] = now
                    save_frame()
            elif state['active'] and s['online']:
                job = state['job']
                state.update(active=False)
                log('utskrift klar/stoppad', s['state'])
                threading.Thread(target=job_finished, args=(job,), daemon=True).start()
            # status-historik: var 30:e s vid utskrift, var 5:e min annars
            if now - last_hist >= (30 if s['printing'] else 300):
                last_hist = now
                row = {k: s[k] for k in ('ts', 'online', 'printing', 'state', 'filename', 'progress',
                                         'layer', 'total_layers', 'nozzle', 'bed', 'remaining_sec')}
                with open(HISTORY, 'a', encoding='utf-8') as f:
                    f.write(json.dumps(row) + '\n')
        except Exception as e:
            log('watcher fel:', type(e).__name__, e)


# ---------------- inloggning (kopia av spelkontroll/server.py - samma hashfil som Husvakten) ----------------
PREFIX = '/skrivare'                               # sokvagen utat bakom tailscale serve
INLOGG = os.path.join(os.path.dirname(ROOT), 'manadsavrakning', 'data', 'inloggning.json')
SESSIONER = os.path.join(DATA, 'sessioner.json')
COOKIE = 'skrivare_session'
SESSION_SEK = 30 * 24 * 3600
SPARR_FONSTER, SPARR_MAX = 15 * 60, 5
PROXYHUVUDEN = ('X-Forwarded-For', 'X-Forwarded-Host', 'X-Forwarded-Proto', 'X-Real-IP',
                'Forwarded', 'Tailscale-User-Login')
TS_HOST = '.tailf9ee87.ts.net'
AUTH_LOCK = threading.Lock()
_fel = {}


def las_inlogg():
    try:
        with open(INLOGG, encoding='utf-8') as fh:
            d = json.load(fh)
        return d if d.get('losen_hash') and d.get('epost_hash') else None
    except (OSError, ValueError, AttributeError):
        return None


def _pbkdf2(varde, salt_hex, it):
    return hashlib.pbkdf2_hmac('sha256', varde.encode('utf-8'), bytes.fromhex(salt_hex), it)


def kontrollera(epost, losen):
    d = las_inlogg()
    if not d:
        return False                                # ingen inloggningsfil = ingen kommer in utifran
    it = int(d.get('iterationer') or 310_000)
    ok_e = hmac.compare_digest(_pbkdf2(epost.strip().lower(), d['epost_salt'], it), bytes.fromhex(d['epost_hash']))
    ok_l = hmac.compare_digest(_pbkdf2(losen, d['losen_salt'], it), bytes.fromhex(d['losen_hash']))
    return ok_e and ok_l


def _th(token):
    return hashlib.sha256(token.encode('utf-8')).hexdigest()


def _las_sessioner():
    try:
        with open(SESSIONER, encoding='utf-8') as fh:
            d = json.load(fh)
        return d if isinstance(d, dict) else {}
    except (OSError, ValueError):
        return {}


def _skriv_sessioner(d):
    nu = time.time()
    d = {k: v for k, v in d.items() if isinstance(v, (int, float)) and v > nu}
    tmp = SESSIONER + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as fh:
        json.dump(d, fh)
    os.replace(tmp, SESSIONER)


def ny_session():
    token = secrets.token_urlsafe(32)
    with AUTH_LOCK:
        d = _las_sessioner()
        d[_th(token)] = time.time() + SESSION_SEK
        _skriv_sessioner(d)
    return token


def giltig_session(token):
    if not token or len(token) > 200:
        return False
    with AUTH_LOCK:
        utgar = _las_sessioner().get(_th(token))
    return isinstance(utgar, (int, float)) and utgar > time.time()


def ta_bort_session(token):
    if not token:
        return
    with AUTH_LOCK:
        d = _las_sessioner()
        if d.pop(_th(token), None) is not None:
            _skriv_sessioner(d)


def sparrad(ip):
    nu = time.time()
    with AUTH_LOCK:
        lista = [t for t in _fel.get(ip, []) if nu - t < SPARR_FONSTER]
        _fel[ip] = lista
        return len(lista) >= SPARR_MAX


def notera_fel(ip):
    with AUTH_LOCK:
        _fel.setdefault(ip, []).append(time.time())


INLOGG_SIDA = """<!DOCTYPE html>
<html lang="sv"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Logga in - Skrivaren</title>
<style nonce="{NONCE}">
:root{--bg:#0b0f17;--panel:#121826;--line:#2a3550;--text:#e6edf7;--muted:#8b9ab5;--acc:#4fd1ff;--red:#ff6b6b}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:16px;background:var(--bg);color:var(--text);font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.kort{width:100%;max-width:380px;background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:28px 24px}
h1{font-size:20px;margin:0 0 4px}p{color:var(--muted);margin:0 0 18px;font-size:14px}
label{display:block;font-size:13px;color:var(--muted);margin:12px 0 6px}
input{width:100%;padding:12px 14px;border-radius:12px;border:1px solid var(--line);background:#0c1220;color:var(--text);font-size:16px}
input:focus{outline:none;border-color:var(--acc)}
button{margin-top:20px;width:100%;padding:12px;border:0;border-radius:12px;font-size:16px;font-weight:700;cursor:pointer;background:var(--acc);color:#03121a}
.fel{background:rgba(255,107,107,.12);border:1px solid rgba(255,107,107,.4);color:var(--red);padding:10px 12px;border-radius:10px;font-size:14px;margin-bottom:6px}
</style></head><body>
<form class="kort" method="post" action="{PREFIX}/logga-in">
<h1>Skrivaren</h1>
<p>Logga in med samma uppgifter som Husvakten.</p>
{FEL}
<label for="e">E-post</label>
<input id="e" name="epost" type="email" autocomplete="username" required autofocus>
<label for="l">Losenord</label>
<input id="l" name="losen" type="password" autocomplete="current-password" required>
<button type="submit">Logga in</button>
</form></body></html>"""

# ---------------- Modellering live (endast lasning under print-planer/modeller/) ----------------
MODELLER = os.path.realpath(os.path.join(ROOT, 'modeller'))
MODELL_EXT = {'.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
              '.stl': 'model/stl', '.3mf': 'model/3mf'}


def _las_text(path, max_bytes=20000):
    """Sista max_bytes av en textfil (tom strang vid fel)."""
    try:
        sz = os.path.getsize(path)
        with open(path, 'rb') as fh:
            if sz > max_bytes:
                fh.seek(sz - max_bytes)
            return fh.read().decode('utf-8', 'replace')
    except OSError:
        return ''


def modeller_sokvag(rel):
    """Returnerar sakrad filsokvag under MODELLER (mapp/fil, tillatna filtyper) eller None."""
    parts = rel.split('/')
    if len(parts) != 2 or not all(parts) or any(p in ('.', '..') or '\\' in p or ':' in p or '\x00' in p for p in parts):
        return None
    if os.path.splitext(parts[1])[1].lower() not in MODELL_EXT:
        return None
    fp = os.path.realpath(os.path.join(MODELLER, parts[0], parts[1]))
    try:
        if os.path.commonpath([fp, MODELLER]) != MODELLER or os.path.dirname(os.path.dirname(fp)) != MODELLER:
            return None
    except ValueError:
        return None
    return fp if os.path.isfile(fp) else None


def live_status():
    """Status for modeller/live/live.png (skrivs av annan process; vi ror den aldrig)."""
    fp = modeller_sokvag('live/live.png')
    if not fp:
        return {'finns': False, 'mtime': None, 'alder': None, 'aktiv': False}
    try:
        mt = os.path.getmtime(fp)
    except OSError:
        return {'finns': False, 'mtime': None, 'alder': None, 'aktiv': False}
    age = time.time() - mt
    return {'finns': True, 'mtime': mt, 'alder': age, 'aktiv': age <= 60}


def modeller_oversikt():
    out = []
    try:
        names = os.listdir(MODELLER)
    except OSError:
        return {'ts': time.time(), 'mappar': [], 'live': live_status()}
    for n in names:
        d = os.path.join(MODELLER, n)
        if not os.path.isdir(d) or os.path.islink(d) or n == 'live':
            continue
        files, newest, logs = [], 0.0, []
        try:
            entries = list(os.scandir(d))
        except OSError:
            continue
        for e in entries:
            if not e.is_file():
                continue
            try:
                st = e.stat()
            except OSError:
                continue
            newest = max(newest, st.st_mtime)
            ext = os.path.splitext(e.name)[1].lower()
            if ext in MODELL_EXT:
                files.append({'namn': e.name, 'typ': ext[1:], 'storlek': st.st_size, 'mtime': st.st_mtime})
            elif ext == '.log':
                logs.append((st.st_mtime, e.path, e.name))
        files.sort(key=lambda f: f['mtime'], reverse=True)
        logs.sort(reverse=True)
        out.append({
            'mapp': n, 'mtime': newest, 'filer': files,
            'rapport': _las_text(os.path.join(d, 'rapport.txt')),
            'status': _las_text(os.path.join(d, 'status.txt')),
            'logg': _las_text(logs[0][1], 4000) if logs else '',
            'loggnamn': logs[0][2] if logs else '',
        })
    out.sort(key=lambda m: m['mtime'], reverse=True)
    return {'ts': time.time(), 'mappar': out, 'live': live_status()}


# ---------------- Printade (las filer-privat, egen prio/saljdata i data/printer/) ----------------
# Objekten och filerna ags av filer-privat (byggs av E:\CHAT-RTX\filer-bygge\scripts\build2.py).
# Vi laser files.json och serverar bara filer som star i den (ingen kopia). PRIVAT: bakom inloggning.
FILER_DATA = os.path.realpath(os.path.join(os.path.dirname(ROOT), 'filer-privat', 'data'))
FILER_JSON = os.path.join(FILER_DATA, 'files.json')
PRINTADE_META = os.path.join(DATA, 'printade.json')
PRINTADE_LOCK = threading.Lock()
ETSY_STATUS = ('ej', 'ide', 'listad')
TRI_GRANS = 1_500_000      # over detta: bara forhandsbild (iPad orkar inte)
NED_TYPER = {'.stl': 'model/stl', '.3mf': 'model/3mf', '.obj': 'model/obj', '.glb': 'model/gltf-binary',
             '.zip': 'application/zip', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp'}
# Objekt-id -> delstrang i gcode-filnamn + varumarkesvarningar: privat fil (data/printer/, gitignored),
# eftersom objektnamnen ar personliga och repot ar publikt.
KOPPLING = os.path.join(DATA, 'printade-koppling.json')


def koppling():
    return _cachad('koppling', KOPPLING, lambda: json.load(open(KOPPLING, encoding='utf-8'))) or {}


_cache = {}


def _cachad(nyckel, fil, fn):
    try:
        st = os.stat(fil)
        sig = (st.st_mtime, st.st_size)
    except OSError:
        return None
    hit = _cache.get(nyckel)
    if hit and hit[0] == sig:
        return hit[1]
    try:
        v = fn()
    except Exception as e:                      # trasig fil far inte stoppa sidan
        log('printade:', nyckel, type(e).__name__)
        v = None
    _cache[nyckel] = (sig, v)
    return v


def las_filer_json():
    return _cachad('files.json', FILER_JSON, lambda: json.load(open(FILER_JSON, encoding='utf-8')))


def filer_sokvag(rel):
    """Sakrad sokvag under filer-privat/data, bara om rel star i files.json (bild eller fil)."""
    d = las_filer_json() or {}
    tillatna = set()
    for o in d.get('objects', []):
        if o.get('image'):
            tillatna.add(o['image'])
        for f in o.get('files', []):
            tillatna.add(f.get('path'))
    if rel not in tillatna or '..' in rel or '\\' in rel or ':' in rel:
        return None
    fp = os.path.realpath(os.path.join(FILER_DATA, rel))
    try:
        if os.path.commonpath([fp, FILER_DATA]) != FILER_DATA:
            return None
    except ValueError:
        return None
    return fp if os.path.isfile(fp) and os.path.splitext(fp)[1].lower() in NED_TYPER else None


def glb_trianglar(fp):
    def rakna():
        import struct
        with open(fp, 'rb') as fh:
            head = fh.read(20)
            n = struct.unpack('<I', head[12:16])[0]
            j = json.loads(fh.read(n))
        t = 0
        for m in j.get('meshes', []):
            for p in m.get('primitives', []):
                a = p.get('indices')
                acc = j['accessors'][a if a is not None else p['attributes']['POSITION']]
                t += acc['count'] // 3
        return t
    return _cachad('tri:' + fp, fp, rakna)


def tremf_installningar(fp):
    """Filament/lager/infill ur 3MF:ens projektinstallningar (ingen vikt/tid finns i osliceade filer)."""
    def las():
        import zipfile
        with zipfile.ZipFile(fp) as z:
            if 'Metadata/project_settings.config' not in z.namelist():
                return None
            j = json.loads(z.read('Metadata/project_settings.config'))
        ft = j.get('filament_type') or []
        return {'filament': sorted(set(x for x in ft if isinstance(x, str)))[:4],
                'lagerhojd': j.get('layer_height'), 'infill': j.get('sparse_infill_density'),
                'vaggar': j.get('wall_loops'), 'stod': j.get('enable_support') in ('1', 1, True)}
    return _cachad('3mf:' + fp, fp, las)


def skrivar_historik():
    """{gcode-filnamn: {'forst': ts, 'sist': ts, 'rader': n}} ur history.jsonl (bara rader med utskrift)."""
    def las():
        ut = {}
        with open(HISTORY, encoding='utf-8') as fh:
            for rad in fh:
                try:
                    r = json.loads(rad)
                except ValueError:
                    continue
                f = r.get('filename')
                if not f or not r.get('printing'):
                    continue
                e = ut.setdefault(f, {'forst': r['ts'], 'sist': r['ts'], 'rader': 0})
                e['sist'] = r['ts']
                e['rader'] += 1
        return ut
    return _cachad('historik', HISTORY, las) or {}


GCODE_RE = re.compile(r'^ECC2_[\d.]+_(.+)_(Elegoo [^_]+?) ?_([\d.]+)_([\dhdms]+)\.gcode$')


def skrivarjobb(oid):
    nycklar = (koppling().get('gcode') or {}).get(oid) or []
    ut = []
    for namn, e in skrivar_historik().items():
        if not any(k in namn for k in nycklar):
            continue
        m = GCODE_RE.match(namn)
        ut.append({'fil': namn[:160], 'material': m.group(2) if m else None,
                   'lagerhojd': m.group(3) if m else None, 'beraknad': m.group(4) if m else None,
                   'start': e['forst'], 'slut': e['sist'], 'faktisk_sek': int(e['sist'] - e['forst'])})
    ut.sort(key=lambda j: j['start'])
    return ut


def licensbedomning(o):
    """(farg, kort, forklaring) - grön/gul/röd. Försiktigt: osäkert = gult, inte grönt."""
    lic = (o.get('license') or '').lower()
    egen = (o.get('origin') or '').lower().startswith('egen')
    if egen:
        return 'gron', 'Ja – egen design', 'Du äger designen och får sälja prints fritt.'
    if 'nc' in lic.replace('-', ' ').split() or 'by-nc' in lic or 'noncommercial' in lic:
        return 'rod', 'Nej – NC-licens', 'Icke-kommersiell licens: prints får inte säljas utan designerns tillstånd.'
    if 'standard digital file' in lic:
        return 'rod', 'Nej – MakerWorld Standard', 'Standard Digital File License tillåter inte försäljning av prints. Fråga designern om kommersiell licens.'
    if 'exclusive' in lic:
        return 'rod', 'Nej – MakerWorld Exclusive', 'Exklusiv MakerWorld-licens: ingen försäljning av prints utan designerns tillstånd.'
    if 'cc0' in lic or 'public domain' in lic:
        return 'gron', 'Ja – CC0', 'Fri att sälja. Snyggt att ändå nämna designern.'
    if 'cc by-sa' in lic or 'cc-by-sa' in lic:
        return 'gron', 'Ja – samma licens', 'CC BY-SA: får säljas med attribution, och ändrade filer måste delas under samma licens.'
    if re.search(r'cc[ -]by\b', lic) and 'nd' not in lic.split():
        return 'gron', 'Ja – med attribution', 'CC BY: får säljas om designern nämns (namn + länk) i annonsen.'
    return 'gul', 'Oklart – kolla licensen', 'Licensen är okänd eller saknas i filen. Kolla källan innan något säljs.'


def las_meta():
    try:
        with open(PRINTADE_META, encoding='utf-8') as fh:
            d = json.load(fh)
        return d if isinstance(d, dict) and isinstance(d.get('objekt'), dict) else {'objekt': {}}
    except (OSError, ValueError):
        return {'objekt': {}}


def skriv_meta(d):
    if os.path.exists(PRINTADE_META):
        shutil.copyfile(PRINTADE_META, PRINTADE_META + '.bak')
    tmp = PRINTADE_META + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as fh:
        json.dump(d, fh, ensure_ascii=False, indent=1)
    os.replace(tmp, PRINTADE_META)


def printade_lista():
    d = las_filer_json()
    if not d:
        return None
    meta = las_meta()['objekt']
    ut = []
    for o in d.get('objects', []):
        oid = o.get('id')
        if not isinstance(oid, str):
            continue
        filer = []
        glb = None
        for f in o.get('files', []):
            fp = filer_sokvag(f.get('path') or '')
            if not fp:
                continue
            ext = os.path.splitext(fp)[1].lower()
            post = {'typ': f.get('type'), 'url': 'printade-fil/' + f['path'], 'namn': os.path.basename(fp),
                    'bytes': os.path.getsize(fp), 'nomad': bool(f.get('nomad'))}
            if ext == '.glb':
                glb = post
                post['trianglar'] = glb_trianglar(fp)
            if ext == '.3mf':
                inst = tremf_installningar(fp)
                if inst:
                    post['installningar'] = inst
            filer.append(post)
        farg, kort, forkl = licensbedomning(o)
        m = meta.get(oid) or {}
        ut.append({
            'id': oid, 'namn': o.get('name'), 'printad': o.get('printed') or [], 'antal': o.get('prints'),
            'material': o.get('material'), 'kategori': o.get('category'), 'kalla': o.get('origin'),
            'designer': o.get('designer'), 'licens': o.get('license'), 'licensUrl': o.get('licenseUrl'),
            'kallUrl': o.get('sourceUrl'), 'kallExakt': o.get('sourceExact'), 'originalUrl': o.get('originalUrl'),
            'favorit': o.get('favorit_rank'), 'beskrivning': o.get('description') or '', 'matt_mm': o.get('dims_mm'),
            'bild': ('printade-fil/' + o['image']) if o.get('image') and filer_sokvag(o['image']) else None,
            'filer': filer, 'glb': glb, 'visa3d': bool(glb and (glb.get('trianglar') or 0) <= TRI_GRANS),
            'salj': {'farg': farg, 'kort': kort, 'forklaring': forkl, 'varumarke': (koppling().get('varumarke') or {}).get(oid)},
            'jobb': skrivarjobb(oid),
            'prio': m.get('prio'), 'saljpotential': m.get('salj'), 'etsy': m.get('etsy') or 'ej',
        })
    return {'uppdaterad': d.get('updated'), 'skrivare': d.get('printer'), 'objekt': ut}


def spara_prio(body):
    """Validerar {id, prio?, salj?, etsy?} och sparar atomiskt. Returnerar (kod, svar)."""
    if not isinstance(body, dict):
        return 400, {'error': 'ogiltig data'}
    oid = body.get('id')
    d = las_filer_json() or {}
    if not isinstance(oid, str) or oid not in {o.get('id') for o in d.get('objects', [])}:
        return 400, {'error': 'okant objekt'}
    andr = {}
    for k in ('prio', 'salj'):
        if k in body:
            v = body[k]
            if v is not None and (not isinstance(v, int) or isinstance(v, bool) or not 1 <= v <= 4):
                return 400, {'error': f'{k} maste vara 1-4 eller null'}
            andr[k] = v
    if 'etsy' in body:
        if body['etsy'] not in ETSY_STATUS:
            return 400, {'error': 'etsy maste vara ej/ide/listad'}
        andr['etsy'] = body['etsy']
    if not andr:
        return 400, {'error': 'inget att spara'}
    with PRINTADE_LOCK:
        meta = las_meta()
        post = dict(meta['objekt'].get(oid) or {})
        post.update(andr)
        post['andrad'] = datetime.now().isoformat(timespec='seconds')
        meta['objekt'][oid] = post
        meta['uppdaterad'] = post['andrad']
        try:
            skriv_meta(meta)
        except OSError as e:
            log('printade spara fel:', type(e).__name__)
            return 500, {'error': 'kunde inte spara'}
    return 200, {'ok': True, 'id': oid, 'post': post}


# ---------------- HTTP ----------------
PUBLIC_FILES = re.compile(r'^/(index\.html|[a-z0-9_-]+\.(?:js|css|svg)|data/[A-Za-z0-9_.-]+\.json|images/.+|vendor/[A-Za-z0-9_./-]+\.js)?$')
STATISKA_TYPER = {'.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
                  '.html': 'text/html; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml'}


class H(BaseHTTPRequestHandler):
    server_version = 'PrinterDash'

    def log_message(self, *a):
        pass

    def send(self, code, body, ctype='application/json', extra=None):
        if isinstance(body, (dict, list)):
            body = json.dumps(body).encode()
        elif isinstance(body, str):
            body = body.encode()
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def stream_fil(self, fp, ctype, nedladdning):
        """Strommar fil med Range/ETag/HEAD (stora STL/GLB till iPad). nedladdning=True -> attachment."""
        try:
            st = os.stat(fp)
        except OSError:
            return self.send(404, {'error': 'saknas'})
        etag = f'"{st.st_size:x}-{int(st.st_mtime * 1000):x}"'
        bas = {'Content-Type': ctype, 'ETag': etag, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, no-cache',
               'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex'}
        if nedladdning:
            namn = os.path.basename(fp)
            ascii_namn = re.sub(r'[^A-Za-z0-9._-]', '_', namn)
            bas['Content-Disposition'] = (f'attachment; filename="{ascii_namn}"; '
                                          f"filename*=UTF-8''{quote(namn)}")
        if self.headers.get('If-None-Match') == etag:
            self.send_response(304)
            for k, v in bas.items():
                self.send_header(k, v)
            self.end_headers()
            return
        start, slut, kod = 0, st.st_size - 1, 200
        m = re.match(r'^bytes=(\d*)-(\d*)$', self.headers.get('Range') or '')
        if m and (m.group(1) or m.group(2)):
            if m.group(1):
                start = int(m.group(1))
                slut = min(int(m.group(2)), st.st_size - 1) if m.group(2) else st.st_size - 1
            else:
                start = max(0, st.st_size - int(m.group(2)))
            if start >= st.st_size or slut < start:
                self.send_response(416)
                self.send_header('Content-Range', f'bytes */{st.st_size}')
                self.send_header('Content-Length', '0')
                self.end_headers()
                return
            kod = 206
            bas['Content-Range'] = f'bytes {start}-{slut}/{st.st_size}'
        self.send_response(kod)
        for k, v in bas.items():
            self.send_header(k, v)
        self.send_header('Content-Length', str(slut - start + 1))
        self.end_headers()
        if self.command == 'HEAD':
            return
        try:
            with open(fp, 'rb') as fh:
                fh.seek(start)
                kvar = slut - start + 1
                while kvar > 0:
                    bit = fh.read(min(256 * 1024, kvar))
                    if not bit:
                        break
                    self.wfile.write(bit)
                    kvar -= len(bit)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass                                # klienten avbrot (vanligt vid Range pa iPad)

    def file(self, path, ctype=None):
        if not os.path.isfile(path):
            return self.send(404, {'error': 'saknas'})
        ctype = ctype or STATISKA_TYPER.get(os.path.splitext(path)[1].lower()) or mimetypes.guess_type(path)[0] or 'application/octet-stream'
        with open(path, 'rb') as f:
            self.send(200, f.read(), ctype)

    # ---- inloggning/vakt (samma monster som spelkontroll) ----
    def _proxad(self):
        return any(self.headers.get(h) for h in PROXYHUVUDEN)

    def _ar_lokal(self):
        return self.client_address[0] in ('127.0.0.1', '::1') and not self._proxad()

    def _klient_ip(self):
        xff = (self.headers.get('X-Forwarded-For') or '').split(',')[0].strip()
        return xff[:64] or self.client_address[0]

    def _https(self):
        if (self.headers.get('X-Forwarded-Proto') or '').lower() == 'https':
            return True
        return (self.headers.get('Host') or '').split(':')[0].lower().endswith('.ts.net')

    def _cookie(self):
        for bit in (self.headers.get('Cookie') or '').split(';'):
            k, _, v = bit.strip().partition('=')
            if k == COOKIE:
                return v
        return None

    def _cookie_rad(self, varde, max_age, prefix):
        sek = '; Secure' if self._https() else ''
        return f"{COOKIE}={varde}; Path={prefix or '/'}; Max-Age={max_age}; HttpOnly; SameSite=Strict{sek}"

    def _vag(self):
        """(intern vag utan /skrivare, prefix utat). tailscale serve skalar av prefixet, men var tolerant."""
        p = unquote(urlparse(self.path).path) or '/'
        if p == PREFIX or p.startswith(PREFIX + '/'):
            return (p[len(PREFIX):] or '/'), PREFIX
        return p, (PREFIX if self._proxad() else '')

    def _host_ok(self):
        host = (self.headers.get('Host') or '').split(':')[0].lower()
        return host in ('127.0.0.1', 'localhost') or host.endswith(TS_HOST)   # skydd mot DNS-rebinding

    def _sec(self):
        return {'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer'}

    def _redirect(self, dit, extra=None):
        self.send(303, b'', 'text/plain', dict(self._sec(), Location=dit, **(extra or {})))

    def _visa_inlogg(self, prefix, fel='', kod=200):
        nonce = secrets.token_urlsafe(16)
        felhtml = f'<div class="fel">{html.escape(fel)}</div>' if fel else ''
        sida = INLOGG_SIDA.replace('{FEL}', felhtml).replace('{PREFIX}', prefix).replace('{NONCE}', nonce)
        self.send(kod, sida, 'text/html; charset=utf-8', dict(self._sec(), **{
            'Content-Security-Policy': f"default-src 'none'; style-src 'nonce-{nonce}'; form-action 'self'; base-uri 'none'"}))

    def _post_inlogg(self, prefix):
        ip = self._klient_ip()
        try:
            n = min(int(self.headers.get('Content-Length') or 0), 10_000)
            f = parse_qs(self.rfile.read(n).decode('utf-8', 'replace'))
        except (ValueError, OSError):
            f = {}
        if sparrad(ip):
            log('inloggning SPARRAD', ip)
            return self._visa_inlogg(prefix, 'For manga felaktiga forsok. Vanta 15 minuter.', 429)
        epost = (f.get('epost') or [''])[0][:200]
        losen = (f.get('losen') or [''])[0][:500]
        if not kontrollera(epost, losen):
            notera_fel(ip)
            log('inloggning NEKAD', ip)
            return self._visa_inlogg(prefix, 'Fel e-post eller losenord.', 401)
        with AUTH_LOCK:
            _fel.pop(ip, None)
        token = ny_session()
        log('inloggning OK', ip)
        self._redirect(prefix + '/', {'Set-Cookie': self._cookie_rad(token, SESSION_SEK, prefix)})

    def _vakt(self, vag, prefix):
        """True = forfragan far fortsatta. Annars ar svaret redan skickat."""
        if not self._host_ok():
            self.send(403, {'error': 'host'})
            return False
        if vag == '/api/halsa':
            self.send(200, {'ok': True})
            return False
        if vag == '/logga-in':
            if self.command == 'POST':
                self._post_inlogg(prefix)
            else:
                self._visa_inlogg(prefix)
            return False
        if vag == '/logga-ut':
            ta_bort_session(self._cookie())
            self._redirect(prefix + '/logga-in', {'Set-Cookie': self._cookie_rad('', 0, prefix)})
            return False
        if self._ar_lokal() or giltig_session(self._cookie()):
            return True
        if self.command == 'POST' or vag.startswith('/api/') or vag.startswith(('/snap/', '/timelapse/', '/modeller-fil/', '/printade-fil/')):
            self.send(401, {'error': 'inloggning kravs'})
        else:
            self._redirect(prefix + '/logga-in')
        return False

    def _samma_ursprung(self):
        """CSRF-skydd utover SameSite=Strict: Origin (om den finns) maste vara var egen host."""
        org = self.headers.get('Origin')
        if not org:
            return True
        try:
            return urlparse(org).netloc.split(':')[0].lower() == (self.headers.get('Host') or '').split(':')[0].lower()
        except ValueError:
            return False

    def do_POST(self):
        vag, prefix = self._vag()
        if not self._vakt(vag, prefix):
            return
        if vag == '/api/prio':
            if not self._samma_ursprung():
                return self.send(403, {'error': 'fel ursprung'})
            if 'application/json' not in (self.headers.get('Content-Type') or ''):
                return self.send(415, {'error': 'skicka JSON'})
            try:
                n = int(self.headers.get('Content-Length') or 0)
                if not 0 < n <= 2000:
                    return self.send(413 if n > 2000 else 400, {'error': 'fel storlek'})
                body = json.loads(self.rfile.read(n).decode('utf-8'))
            except (ValueError, OSError):
                return self.send(400, {'error': 'ogiltig JSON'})
            kod, svar = spara_prio(body)
            return self.send(kod, svar)
        self.send(404, {'error': 'saknas'})

    def do_HEAD(self):
        vag, prefix = self._vag()
        if not self._vakt(vag, prefix):
            return
        if vag.startswith('/printade-fil/'):
            return self._printade_fil(vag)
        self.send(405, {'error': 'metod'})

    def _printade_fil(self, vag):
        rel = vag[len('/printade-fil/'):]
        fp = filer_sokvag(rel)
        if not fp:
            return self.send(404, {'error': 'saknas'})
        ext = os.path.splitext(fp)[1].lower()
        ned = ext in ('.stl', '.3mf', '.obj', '.glb', '.zip')
        return self.stream_fil(fp, NED_TYPER[ext], ned)

    def do_GET(self):
        vag, prefix = self._vag()
        if not self._vakt(vag, prefix):
            return
        if unquote(urlparse(self.path).path) == PREFIX:      # relativa lankar kraver avslutande /
            return self._redirect(PREFIX + '/')
        p = vag
        if p == '/api/status':
            return self.send(200, summary())
        if p == '/api/snapshot':
            j = get_snapshot()
            return self.send(200, j, 'image/jpeg') if j else self.send(503, {'error': 'ingen kamerabild'})
        if p == '/api/snapshots':
            fs = sorted(os.listdir(SNAPS), reverse=True)[:48]
            return self.send(200, fs)
        if p == '/api/timelapses':
            return self.send(200, sorted(os.listdir(TLAPSE), reverse=True))
        if p == '/api/history':
            try:
                rows = open(HISTORY, encoding='utf-8').read().splitlines()[-500:]
            except OSError:
                rows = []
            return self.send(200, [json.loads(r) for r in rows if r])
        if p == '/api/modeller':
            return self.send(200, modeller_oversikt())
        if p == '/api/printade':
            lista = printade_lista()
            return self.send(200, lista) if lista else self.send(503, {'error': 'filer-privat/data/files.json saknas'})
        if p == '/api/prio':
            return self.send(200, las_meta())
        if p.startswith('/printade-fil/'):
            return self._printade_fil(p)
        if p.startswith('/modeller-fil/'):
            fp = modeller_sokvag(p[len('/modeller-fil/'):])
            if not fp:
                return self.send(404, {'error': 'saknas'})
            try:
                mt = os.path.getmtime(fp)
                with open(fp, 'rb') as fh:
                    data = fh.read()
            except OSError:
                return self.send(503, {'error': 'filen skrivs just nu'})
            return self.send(200, data, MODELL_EXT[os.path.splitext(fp)[1].lower()],
                             {'X-Mtime': f'{mt:.3f}', 'Access-Control-Expose-Headers': 'X-Mtime'})
        m = re.match(r'^/(snap|timelapse)/([A-Za-z0-9._-]+)$', p)
        if m:
            return self.file(os.path.join(SNAPS if m.group(1) == 'snap' else TLAPSE, m.group(2)))
        if PUBLIC_FILES.match(p) and '..' not in p:
            return self.file(os.path.join(ROOT, p.lstrip('/') or 'index.html'))
        self.send(404, {'error': 'saknas'})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--port', type=int, default=5196)
    a = ap.parse_args()
    threading.Thread(target=mqtt_loop, daemon=True).start()
    threading.Thread(target=watcher, daemon=True).start()
    srv = ThreadingHTTPServer(('127.0.0.1', a.port), H)
    log(f'Skrivardashboard pa http://127.0.0.1:{a.port}/ (endast loopback)')
    srv.serve_forever()


if __name__ == '__main__':
    main()
