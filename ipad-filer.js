// Fliken "iPad-filer": ladda upp filer från iPaden till datorn. API: api/ipad-filer (POST rå ström, GET lista, DELETE).
const MAX = 500 * 1024 * 1024;
const OK_EXT = ['stl', '3mf', 'obj', 'step', 'stp', 'gcode', 'bgcode', 'nom', 'blend', 'fbx', 'glb', 'gltf', 'ply', 'amf', 'scad', 'f3d', 'dxf', 'svg', 'zip', 'rar', '7z', 'png', 'jpg', 'jpeg', 'heic', 'webp', 'pdf', 'json', 'txt'];
const $ = (id) => document.getElementById(id);
const drop = $('ipdDrop'), input = $('ipdInput'), input2 = $('ipdInput2'), upp = $('ipdUpp'), summa = $('ipdSumma'), lista = $('ipdLista');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const storlek = (b) => (b >= 1048576 ? `${(b / 1048576).toLocaleString('sv-SE', { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.round(b / 1024))} kB`);
const tid = (t) => { try { return new Date(t).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' }); } catch { return t || ''; } };
const ext = (n) => (String(n).split('.').pop() || '').toLowerCase();

function ikon(f) {
  const e = ext(f.namn);
  if (['png', 'jpg', 'jpeg', 'webp'].includes(e)) return `<img loading="lazy" alt="" src="ipad-filer-fil/${encodeURIComponent(f.namn)}?visa=1">`;
  return esc(e.toUpperCase());
}

async function ladda() {
  try {
    const r = await fetch('api/ipad-filer', { cache: 'no-store', credentials: 'same-origin' });
    if (!r.ok) throw new Error(r.status === 401 ? 'logga in igen' : `serverfel ${r.status}`);
    const d = await r.json();
    const l = d.files || [];
    summa.textContent = `${l.length} ${l.length === 1 ? 'fil' : 'filer'} på datorn`;
    lista.innerHTML = l.length ? l.map((f) => `<div class="it"><div class="ipdIkon">${ikon(f)}</div>
<div><div class="nm">${esc(f.namn)}</div><div class="count">${esc(storlek(f.storlek))} · ${esc(tid(f.tid))}</div></div>
<div class="ipdAkt"><a class="dl" href="ipad-filer-fil/${encodeURIComponent(f.namn)}" download="${esc(f.namn)}">Ladda ned</a><button type="button" data-del="${esc(f.namn)}">Radera</button></div></div>`).join('')
      : '<p class="count">Inga filer ännu.</p>';
  } catch (e) {
    summa.textContent = `Kunde inte hämta filer (${e.message})`;
  }
}

function skickaEn(fil, rad) {
  return new Promise((klar) => {
    const bar = rad.querySelector('.ipdBar i'), st = rad.querySelector('.st');
    const fel = (m) => { st.textContent = ''; rad.insertAdjacentHTML('beforeend', `<div class="ipdFel">${esc(m)}</div>`); klar(false); };
    const e = ext(fil.name);
    if (!OK_EXT.includes(e)) return fel(`Fel filtyp (.${e}). Tillåtet: ${OK_EXT.join(', ')}.`);
    if (fil.size > MAX) return fel(`Filen är för stor (${storlek(fil.size)}, max ${storlek(MAX)}).`);
    if (!fil.size) return fel('Filen är tom.');
    const x = new XMLHttpRequest();
    x.open('POST', 'api/ipad-filer');
    x.setRequestHeader('X-Filnamn', encodeURIComponent(fil.name));
    x.setRequestHeader('Content-Type', 'application/octet-stream');
    x.upload.onprogress = (ev) => { if (ev.lengthComputable) { const p = Math.round(ev.loaded / ev.total * 100); bar.style.width = `${p}%`; st.textContent = `${p} %`; } };
    x.onerror = () => fel('Nätverksfel – uppladdningen avbröts. Försök igen.');
    x.onload = () => {
      let d = {}; try { d = JSON.parse(x.responseText); } catch { /* ej JSON */ }
      if (x.status === 201) { bar.style.width = '100%'; st.innerHTML = '<span class="ipdOk">Klar ✓</span>'; return klar(true); }
      if (x.status === 401) return fel('Du är utloggad. Logga in igen och försök på nytt.');
      if (x.status >= 500) return fel(d.error || `Serverfel (${x.status}).`);
      fel(d.error || `Fel (${x.status}).`);
    };
    x.send(fil);
  });
}

let pagar = false;
async function skicka(filer) {
  const lst = Array.from(filer || []);
  if (!lst.length || pagar) return;
  pagar = true;
  upp.innerHTML = '';
  for (const f of lst) {
    const rad = document.createElement('div');
    rad.className = 'ipdRad';
    rad.innerHTML = `<div class="nm">${esc(f.name)} <span class="count">${esc(storlek(f.size))}</span></div><div class="st count">väntar …</div><div class="ipdBar"><i></i></div>`;
    upp.appendChild(rad);
    await skickaEn(f, rad);
  }
  pagar = false;
  input.value = ''; input2.value = '';
  ladda();
}

input.addEventListener('change', () => skicka(input.files));
input2.addEventListener('change', () => skicka(input2.files));
['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', (e) => skicka(e.dataTransfer?.files));
lista.addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-del]');
  if (!b) return;
  const n = b.dataset.del;
  if (!confirm(`Radera ${n}? Filen flyttas till papperskorgen på datorn.`)) return;
  try {
    const r = await fetch(`api/ipad-filer/${encodeURIComponent(n)}`, { method: 'DELETE', credentials: 'same-origin' });
    if (!r.ok) throw new Error(r.status);
  } catch (err) { alert(`Kunde inte radera (${err.message}).`); }
  ladda();
});
document.querySelector('button[data-tab="ipad-filer"]')?.addEventListener('click', ladda);
if ((location.hash || '') === '#ipad-filer') ladda();
