#!/usr/bin/env python3
"""Skrivarserver for Elegoo Centauri Carbon 2 (endast lasning, aldrig start/paus/skicka).

Lyssnar bara pa 127.0.0.1 (standardport 5196). Hamtar config fran server/.printer.json
(utanfor git). Exponerar /api/status, /api/snapshot, /api/snapshots, /api/timelapses
och serverar print-planer-sajten sa dashboarden ar same-origin (ingen CORS, ingen
auth-losning - bara loopback).

Anvandning:  python server/printer_server.py [--port 5196]
"""
import argparse, glob, http.client, json, mimetypes, os, re, shutil, subprocess, sys
import threading, time, urllib.request
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, unquote

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

    def do_GET(self):
        host = (self.headers.get('Host') or '').split(':')[0]
        if host not in ('127.0.0.1', 'localhost'):          # skydd mot DNS-rebinding
            return self.send(403, {'error': 'host'})
        p = unquote(urlparse(self.path).path)
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
