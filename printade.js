// Fliken "Printade": allt vi printat, rangordning (prio 1-4 som hemskärmen), säljpotential, licenskoll,
// 3D-visning (självhostad three.js 0.171.0) och nedladdning till iPad. Data: /api/printade (läser
// filer-privat/data/files.json på servern), sparas via POST /api/prio. PRIVAT: bara bakom Husvakt-inloggning.
const NIVAER = [
  { v: 1, ikon: '💎', namn: 'Platina' },
  { v: 2, ikon: '🥇', namn: 'Guld' },
  { v: 3, ikon: '🥈', namn: 'Silver' },
  { v: 4, ikon: '🥉', namn: 'Brons' },
];
const ETSY = { ej: 'Ej listad', ide: 'Idé', listad: 'Listad' };
const SALJ_FARG = { gron: 'ok', gul: 'mid', rod: 'bad' };
const SALJ_IKON = { gron: '🟢', gul: '🟡', rod: '🔴' };

const sektion = document.getElementById('tab-printade');
const grid = document.getElementById('prtGrid');
const chips = document.getElementById('prtChips');
const sortSel = document.getElementById('prtSort');
const summa = document.getElementById('prtSumma');
const status = document.getElementById('prtStatus');

let OBJ = [];
let laddad = false;
const ui = { filter: 'alla', salj: false, sort: 'rang' };
try { Object.assign(ui, JSON.parse(sessionStorage.getItem('printadeUi') || '{}')); } catch { /* privat läge */ }
const sparaUi = () => { try { sessionStorage.setItem('printadeUi', JSON.stringify(ui)); } catch { /* ignoreras */ } };

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const mb = (b) => (b >= 1048576 ? `${(b / 1048576).toLocaleString('sv-SE', { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.round(b / 1024))} kB`);
const niva = (v) => NIVAER.find((n) => n.v === v);
const senast = (o) => (o.printad || []).slice().sort().pop() || '';
const ok = (url) => /^https:\/\//i.test(url || '');

function visaStatus(text, typ = 'info') {
  status.innerHTML = text ? `<div class="warn ${typ}">${text}</div>` : '';
}

async function hamta() {
  try {
    const r = await fetch('api/printade', { cache: 'no-store', credentials: 'same-origin' });
    if (r.status === 401) { visaStatus('Logga in igen för att se printade objekt. <a href="logga-in">Logga in</a>', 'bad'); return; }
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    OBJ = Array.isArray(d.objekt) ? d.objekt : [];
    laddad = true;
    visaStatus('');
    rita();
  } catch (e) {
    console.warn('printade', e);
    visaStatus(`Kunde inte hämta printade objekt (${esc(e.message)}). Fliken fungerar bara via skrivarservern (Tailscale /skrivare/), inte på GitHub Pages.`, 'bad');
  }
}

function sorterad(lista) {
  const p = (v) => (v == null ? 9 : v);
  const fav = (o) => (o.favorit == null ? 999 : o.favorit);
  const cmp = {
    rang: (a, b) => fav(a) - fav(b) || p(a.prio) - p(b.prio) || p(a.saljpotential) - p(b.saljpotential) || senast(b).localeCompare(senast(a)),
    salj: (a, b) => p(a.saljpotential) - p(b.saljpotential) || ({ gron: 0, gul: 1, rod: 2 }[a.salj.farg] - { gron: 0, gul: 1, rod: 2 }[b.salj.farg]) || p(a.prio) - p(b.prio),
    datum: (a, b) => senast(b).localeCompare(senast(a)),
  }[ui.sort] || (() => 0);
  return lista.slice().sort(cmp);
}

function filtrerad() {
  return OBJ.filter((o) => {
    if (ui.salj && o.salj.farg !== 'gron') return false;
    if (ui.filter === 'alla') return true;
    if (ui.filter === 'ingen') return o.prio == null;
    return o.prio === Number(ui.filter);
  });
}

function ritaChips() {
  const n = (f) => OBJ.filter((o) => (f === 'ingen' ? o.prio == null : o.prio === f)).length;
  const lista = [['alla', `Alla (${OBJ.length})`], ...NIVAER.map((x) => [String(x.v), `${x.ikon} ${x.v} (${n(x.v)})`]), ['ingen', `Ej satt (${n('ingen')})`]];
  chips.innerHTML = lista.map(([k, t]) => `<button type="button" data-f="${k}" aria-pressed="${ui.filter === k}">${esc(t)}</button>`).join('')
    + `<button type="button" data-salj="1" class="prt-saljchip" aria-pressed="${ui.salj}">🟢 Kan säljas (${OBJ.filter((o) => o.salj.farg === 'gron').length})</button>`;
  sortSel.value = ui.sort;
}

function ritaSumma() {
  const gron = OBJ.filter((o) => o.salj.farg === 'gron').length;
  const gul = OBJ.filter((o) => o.salj.farg === 'gul').length;
  const pot = OBJ.filter((o) => o.saljpotential === 1 || o.saljpotential === 2).length;
  const listad = OBJ.filter((o) => o.etsy === 'listad').length;
  summa.innerHTML = `<strong>${OBJ.length}</strong> printade · <strong>${gron}</strong> får säljas 🟢 · ${gul} oklara 🟡 · <strong>${pot}</strong> med säljpotential 💎/🥇 · ${listad} listade på Etsy`;
}

function valjare(o, falt, etikett) {
  const v = falt === 'prio' ? o.prio : o.saljpotential;
  const opts = [`<option value="">${falt === 'prio' ? 'Ingen prio' : 'Ej bedömd'}</option>`]
    .concat(NIVAER.map((x) => `<option value="${x.v}"${v === x.v ? ' selected' : ''}>${x.ikon} ${x.v} ${x.namn}</option>`));
  return `<label class="prt-val"><span>${etikett}</span><select data-falt="${falt}" data-id="${esc(o.id)}" aria-label="${etikett} för ${esc(o.namn)}">${opts.join('')}</select></label>`;
}

function kallaHtml(o) {
  const rader = [];
  if (ok(o.kallUrl)) {
    const t = o.kallExakt === false ? `${esc(o.kalla || 'Källa')}: sökning (exakt modellsida okänd)` : `${esc(o.kalla || 'Källa')}: modellsidan`;
    rader.push(`<a href="${esc(o.kallUrl)}" target="_blank" rel="noopener noreferrer">${t} ↗</a>`);
  } else rader.push(esc(o.kalla || 'Okänd källa'));
  if (ok(o.originalUrl)) rader.push(`<a href="${esc(o.originalUrl)}" target="_blank" rel="noopener noreferrer">Originalmodell ↗</a>`);
  const lic = ok(o.licensUrl) ? `<a href="${esc(o.licensUrl)}" target="_blank" rel="noopener noreferrer">${esc(o.licens)}</a>` : esc(o.licens || 'okänd');
  return `<dl class="prt-dl"><dt>Laddad ned från</dt><dd>${rader.join('<br>')}</dd><dt>Designer</dt><dd>${esc(o.designer || 'okänd')}</dd><dt>Licens</dt><dd>${lic}</dd></dl>`;
}

function utskriftHtml(o) {
  const datum = (o.printad || []).join(', ') || 'okänt';
  const jobb = (o.jobb || []).map((j) => `<li>${esc(new Date(j.start * 1000).toLocaleDateString('sv-SE'))}: ${esc(j.material || o.material || '')}, ${esc(j.lagerhojd || '?')} mm lager, slicer-tid ${esc(j.beraknad || '?')}</li>`).join('');
  const inst = (o.filer || []).map((f) => f.installningar).find(Boolean);
  const instTxt = inst ? `3MF-inställning: ${esc((inst.filament || []).join('/') || '?')}, ${esc(inst.lagerhojd)} mm, infill ${esc(inst.infill)}, ${esc(inst.vaggar)} väggar${inst.stod ? ', stöd' : ''}` : '';
  const matt = Array.isArray(o.matt_mm) ? `${o.matt_mm.map((x) => Math.round(x)).join(' × ')} mm` : '';
  return `<details class="prt-det"><summary>Printad ${esc(datum)}${o.antal > 1 ? ` (${o.antal} gånger)` : ''} · ${esc(o.material || '')}</summary>
    ${jobb ? `<ul class="prt-jobb">${jobb}</ul>` : '<p class="muted">Inget skrivarjobb matchat i skrivarloggen.</p>'}
    ${instTxt ? `<p class="muted">${instTxt}</p>` : ''}
    ${matt ? `<p class="muted">Mått: ${esc(matt)}</p>` : ''}
    <p class="muted">Filamentvikt: okänd (3MF-filerna är inte slicade, vikten sparas inte).</p></details>`;
}

function filerHtml(o) {
  const knappar = (o.filer || []).map((f) => {
    const typ = String(f.typ || '').split(' ')[0];
    return `<a class="btn prt-dl-btn" href="${esc(f.url)}" download="${esc(f.namn)}"><strong>${esc(typ)}</strong><span>${esc(f.typ.replace(typ, '').trim() || '')} ${mb(f.bytes)}</span></a>`;
  }).join('');
  return `<div class="prt-filer">${knappar || '<span class="muted">Inga filer</span>'}</div>
    <p class="muted prt-ipad">iPad: tryck på en fil → Ladda ned → öppna i Filer-appen → <strong>Dela → Öppna i Nomad</strong> (STL/OBJ/GLB). 3MF öppnas i slicern.</p>`;
}

function kort(o) {
  const n = niva(o.prio);
  const s = o.salj;
  const bild = o.bild ? `<img class="prt-bild" src="${esc(o.bild)}" alt="Förhandsbild av ${esc(o.namn)}" loading="lazy">` : '<div class="prt-bild prt-tom">Ingen bild</div>';
  const knapp3d = o.visa3d
    ? `<button type="button" class="btn primary prt-3d-knapp" data-3d="${esc(o.id)}">Visa i 3D <span>(${mb(o.glb.bytes)})</span></button>`
    : (o.glb ? `<span class="prt-3d-info">${(o.glb.trianglar / 1e6).toLocaleString('sv-SE', { maximumFractionDigits: 1 })} M trianglar – för tung för 3D på iPad, visar bild</span>` : '');
  return `<article class="card prt-kort${o.favorit === 1 ? ' prt-fav' : ''}" data-id="${esc(o.id)}">
    <div class="prt-media" data-media="${esc(o.id)}">${bild}${knapp3d}</div>
    <div class="body">
      <div class="prt-topp">
        ${n ? `<span class="prt-badge" title="${n.namn}">${n.ikon} ${n.v}</span>` : ''}
        ${o.favorit === 1 ? '<span class="prt-badge prt-favbadge">⭐ Favorit</span>' : ''}
        <span class="prt-kat">${esc(o.kategori || '')}</span>
      </div>
      <h3>${esc(o.namn)}</h3>
      ${o.beskrivning ? `<p class="muted">${esc(o.beskrivning)}</p>` : ''}
      <div class="prt-val-rad">${valjare(o, 'prio', 'Rangordning')}${valjare(o, 'salj', 'Säljpotential (Etsy m.m.)')}
        <label class="prt-val"><span>Etsy-status</span><select data-falt="etsy" data-id="${esc(o.id)}" aria-label="Etsy-status för ${esc(o.namn)}">${Object.entries(ETSY).map(([k, t]) => `<option value="${k}"${o.etsy === k ? ' selected' : ''}>${t}</option>`).join('')}</select></label>
      </div>
      <div class="warn ${SALJ_FARG[s.farg]} prt-salj"><strong>${SALJ_IKON[s.farg]} Får säljas? ${esc(s.kort)}</strong><br>${esc(s.forklaring)}${s.varumarke ? `<br><strong>Varumärke:</strong> ${esc(s.varumarke)} – risk för intrångsanmälan på Etsy även med licens.` : ''}</div>
      ${kallaHtml(o)}
      ${utskriftHtml(o)}
      ${filerHtml(o)}
    </div>
  </article>`;
}

function rita() {
  if (!laddad) return;
  stang3d();
  ritaChips();
  ritaSumma();
  const lista = sorterad(filtrerad());
  grid.innerHTML = lista.length ? lista.map(kort).join('') : '<p class="muted">Inga objekt matchar filtret.</p>';
}

async function spara(id, falt, varde) {
  const o = OBJ.find((x) => x.id === id);
  if (!o) return;
  const nyckel = falt === 'salj' ? 'salj' : falt;
  const body = { id, [nyckel]: falt === 'etsy' ? varde : (varde === '' ? null : Number(varde)) };
  try {
    const r = await fetch('api/prio', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
    if (falt === 'prio') o.prio = body.prio;
    else if (falt === 'salj') o.saljpotential = body.salj;
    else o.etsy = body.etsy;
    visaStatus('Sparat ✓', 'ok');
    setTimeout(() => visaStatus(''), 1500);
    rita();
  } catch (e) {
    console.warn('spara', e);
    visaStatus(`Kunde inte spara (${esc(e.message)}).`, 'bad');
  }
}

/* ---------- 3D (en visare åt gången; iPad tål få WebGL-kontexter) ---------- */
let aktiv3d = null;
function harWebGL() {
  try { const c = document.createElement('canvas'); return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl'))); } catch { return false; }
}
function stang3d() {
  if (!aktiv3d) return;
  const a = aktiv3d; aktiv3d = null;
  try { cancelAnimationFrame(a.raf); a.ro?.disconnect(); a.ctl?.dispose(); a.scene?.traverse((x) => { x.geometry?.dispose?.(); (Array.isArray(x.material) ? x.material : [x.material]).forEach((m) => m?.dispose?.()); }); a.renderer?.dispose(); a.renderer?.forceContextLoss?.(); } catch { /* städning */ }
  a.box?.remove();
  if (a.media) a.media.classList.remove('prt-3d-on');
}
async function oppna3d(id) {
  const o = OBJ.find((x) => x.id === id);
  const media = grid.querySelector(`[data-media="${CSS.escape(id)}"]`);
  if (!o || !o.glb || !media) return;
  stang3d();
  const box = document.createElement('div');
  box.className = 'prt-3d';
  box.innerHTML = '<p class="prt-3d-txt">Laddar 3D-modell …</p><button type="button" class="btn sm prt-3d-stang" aria-label="Stäng 3D">✕ Stäng 3D</button>';
  media.appendChild(box);
  media.classList.add('prt-3d-on');
  const a = { box, media };
  aktiv3d = a;
  const txt = box.querySelector('.prt-3d-txt');
  if (!harWebGL()) { txt.textContent = 'WebGL saknas i den här webbläsaren – visar förhandsbilden.'; setTimeout(() => aktiv3d === a && stang3d(), 2500); return; }
  try {
    const [THREE, { GLTFLoader }, { OrbitControls }] = await Promise.all([
      import('three'), import('./vendor/three-0.171.0/examples/jsm/loaders/GLTFLoader.js'), import('./vendor/three-0.171.0/examples/jsm/controls/OrbitControls.js')]);
    if (aktiv3d !== a) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x20242c);
    a.renderer = renderer;
    box.prepend(renderer.domElement);
    const scene = new THREE.Scene(); a.scene = scene;
    scene.add(new THREE.HemisphereLight(0xffffff, 0x444455, 1.6));
    const dl = new THREE.DirectionalLight(0xffffff, 1.8); dl.position.set(1, 2, 1.5); scene.add(dl);
    const cam = new THREE.PerspectiveCamera(40, 4 / 3, 0.1, 10000);
    const ctl = new OrbitControls(cam, renderer.domElement); a.ctl = ctl;
    ctl.enableDamping = true; ctl.enablePan = true;
    const gltf = await new Promise((res, rej) => new GLTFLoader().load(o.glb.url, res,
      (ev) => { if (ev.total) txt.textContent = `Laddar 3D-modell … ${Math.round((ev.loaded / ev.total) * 100)} %`; }, rej));
    if (aktiv3d !== a) return;
    const modell = gltf.scene;
    modell.traverse((x) => {
      if (x.isMesh) {
        if (!x.geometry.attributes.normal) x.geometry.computeVertexNormals();
        const m = x.material;
        if (m && m.color && m.color.r > 0.95 && m.color.g > 0.95 && m.color.b > 0.95 && !m.map) m.color.set(0xd9dde4);
        if (m) m.side = THREE.DoubleSide;
      }
    });
    scene.add(modell);
    const bb = new THREE.Box3().setFromObject(modell);
    const mitt = bb.getCenter(new THREE.Vector3());
    const r = bb.getSize(new THREE.Vector3()).length() / 2 || 1;
    cam.position.copy(mitt).add(new THREE.Vector3(r * 1.4, r * 1.1, r * 1.8));
    cam.near = r / 100; cam.far = r * 100; cam.updateProjectionMatrix();
    ctl.target.copy(mitt); ctl.update();
    const storlek = () => { const w = box.clientWidth || 300; const h = box.clientHeight || 225; renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); };
    storlek();
    a.ro = new ResizeObserver(storlek); a.ro.observe(box);
    txt.textContent = 'Dra för att rotera · nyp för att zooma · två fingrar för att flytta';
    txt.classList.add('prt-3d-hjalp');
    box.dataset.klar = '1';
    const loop = () => { if (aktiv3d !== a) return; ctl.update(); renderer.render(scene, cam); a.raf = requestAnimationFrame(loop); };
    loop();
  } catch (e) {
    console.warn('3D', e);
    if (aktiv3d === a) { txt.textContent = `Kunde inte visa 3D (${e.message || e}). Förhandsbilden visas.`; setTimeout(() => aktiv3d === a && stang3d(), 3000); }
  }
}

/* ---------- händelser ---------- */
chips.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.salj) ui.salj = !ui.salj; else if (b.dataset.f) ui.filter = b.dataset.f;
  sparaUi(); rita();
});
sortSel.addEventListener('change', () => { ui.sort = sortSel.value; sparaUi(); rita(); });
grid.addEventListener('change', (e) => {
  const s = e.target.closest('select[data-falt]');
  if (s) spara(s.dataset.id, s.dataset.falt, s.value);
});
grid.addEventListener('click', (e) => {
  const b3 = e.target.closest('button[data-3d]');
  if (b3) { oppna3d(b3.dataset['3d']); return; }
  if (e.target.closest('.prt-3d-stang')) stang3d();
});

// Ladda när fliken visas (app.js sköter flikbytet genom att ta bort hidden).
const nar = () => { if (!sektion.hidden && !laddad) hamta(); if (sektion.hidden) stang3d(); };
new MutationObserver(nar).observe(sektion, { attributes: true, attributeFilter: ['hidden'] });
nar();
