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
from urllib.parse import urlparse, unquote, parse_qs

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

# ---------------- HTTP ----------------
PUBLIC_FILES = re.compile(r'^/(index\.html|app\.js|style\.css|data/[A-Za-z0-9_.-]+\.json|images/.+)?$')


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

    def file(self, path, ctype=None):
        if not os.path.isfile(path):
            return self.send(404, {'error': 'saknas'})
        ctype = ctype or mimetypes.guess_type(path)[0] or 'application/octet-stream'
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
        if vag.startswith('/api/') or vag.startswith(('/snap/', '/timelapse/')):
            self.send(401, {'error': 'inloggning kravs'})
        else:
            self._redirect(prefix + '/logga-in')
        return False

    def do_POST(self):
        vag, prefix = self._vag()
        if not self._vakt(vag, prefix):
            return
        self.send(404, {'error': 'saknas'})

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
