/* Print-planeraren – statisk, ingen byggkedja. Allt tillstånd i localStorage + export/import. */
(() => {
  'use strict';

  const STORE_KEY = 'print-planer:v1';
  const CATS = {
    avp: 'Alien vs Predator',
    re: 'Resident Evil',
    fold7: 'Samsung Galaxy Z Fold 7',
    applefold: 'Apple vikbar iPhone',
    sneakers: 'Sneakers & skor',
  };
  const TM_CATS = { avp: 'Disney/20th Century Studios', re: 'Capcom' };
  const SNEAKER_BRANDS = /\b(nike|jordan|adidas|yeezy|air\s?max|converse|vans|new\s?balance|puma|off-?white)\b/i;
  const COLS = [
    ['idea', 'Idéer'], ['prio', 'Prioriterad'], ['queue', 'Ska printas'],
    ['printing', 'Printas nu'], ['done', 'Klar'], ['etsy', 'Säljs på Etsy'],
  ];
  const MAX_COLORS = 4;
  const DEFAULT_FILAMENTS = [
    { brand: 'Elegoo', mat: 'PLA', name: 'Basic Black (refill)', hex: '#1a1a1a', qty: 1, note: 'Refill' },
    { brand: 'Elegoo', mat: 'PLA', name: 'RFID White', hex: '#f4f4f0', qty: 1, note: 'RFID' },
    { brand: 'Elegoo', mat: 'PLA', name: 'RFID Black', hex: '#111111', qty: 1, note: 'RFID' },
    { brand: '', mat: 'TPU', name: '95A Black', hex: '#202020', qty: 1, note: 'Extern spole/bypass' },
    { brand: '', mat: 'PLA Silk', name: 'Silver Grey', hex: '#a9adb3', qty: 1, note: '' },
  ];

  const $ = (s, r = document) => r.querySelector(s);
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
  const fmt = (n) => (n >= 10000 ? (n / 1000).toFixed(n >= 100000 ? 0 : 1) + 'k' : String(n ?? 0));
  const safeUrl = (u) => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : ''; } catch { return ''; } };
  const mwUrl = (m) => `https://makerworld.com/en/models/${encodeURIComponent(m.id)}-${encodeURIComponent(m.s || '')}`;

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2200);
  }

  /* ---------- Tillstånd ---------- */
  function freshState() {
    return {
      v: 1,
      board: [],
      inbox: [],
      filaments: DEFAULT_FILAMENTS.map((f) => ({ id: uid(), ...f })),
      ui: { tab: 'browse', cat: 'avp', sort: 'd', q: '', exact: true, etsySafe: false, hideNsfw: true },
    };
  }
  function normalize(s) {
    const base = freshState();
    if (!s || typeof s !== 'object') return base;
    return {
      v: 1,
      board: Array.isArray(s.board) ? s.board.filter((c) => c && c.id && c.title) : [],
      inbox: Array.isArray(s.inbox) ? s.inbox.filter((i) => i && i.id) : [],
      filaments: Array.isArray(s.filaments) ? s.filaments.filter((f) => f && f.id) : base.filaments,
      ui: { ...base.ui, ...(s.ui && typeof s.ui === 'object' ? s.ui : {}) },
    };
  }
  let state;
  try { state = normalize(JSON.parse(localStorage.getItem(STORE_KEY))); } catch { state = freshState(); }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
    catch (e) { console.warn('Kunde inte spara i localStorage', e); toast('Kunde inte spara lokalt – exportera JSON som backup'); }
  }

  /* ---------- Licens & varumärke ---------- */
  function licInfo(lic) {
    const l = String(lic || '').trim();
    const u = l.toUpperCase();
    if (u === 'CC0') return { level: 'ok', commercial: true, text: 'CC0 – kommersiell försäljning av prints tillåten.' };
    if (/NC/.test(u)) return { level: 'bad', commercial: false, text: `${l} – ej kommersiellt. Får inte säljas på Etsy.` };
    if (u === 'BY' || u === 'BY-SA') return { level: 'ok', commercial: true, text: `CC ${l} – försäljning tillåten med attribution (ange skaparen i annonsen)${u === 'BY-SA' ? ', samma licens på ändringar' : ''}.` };
    if (u === 'BY-ND') return { level: 'mid', commercial: true, text: 'CC BY-ND – kommersiellt med attribution, men inga ändringar av modellen. Kontrollera modellsidan.' };
    if (/STANDARD DIGITAL FILE|EXCLUSIVE/.test(u)) return { level: 'bad', commercial: false, text: `${l} – personligt bruk, sälj inte prints. Kan kräva kommersiell licens via MakerWorlds program – kontrollera modellsidan.` };
    return { level: 'mid', commercial: false, text: `Okänd licens (${l || 'saknas'}) – kontrollera modellsidan.` };
  }
  function tmInfo(cat, m) {
    if (TM_CATS[cat]) return `Upphovsrätt/varumärke (${TM_CATS[cat]}): fan-art-försäljning kan leda till Etsy-borttagning.`;
    if (cat === 'sneakers' && SNEAKER_BRANDS.test(`${m.t} ${(m.tags || []).join(' ')}`)) return 'Varumärke: skomärke i titel/taggar – försäljning kan leda till Etsy-borttagning.';
    return '';
  }
  function isExact(cat, m) {
    const hay = `${m.t || ''} ${(m.tags || []).join(' ')}`;
    if (cat === 'fold7') return /fold\s?7|z\s?fold/i.test(hay);
    if (cat === 'applefold') return /iphone|apple/i.test(hay) && /fold/i.test(hay);
    return true;
  }
  const hasExactFilter = (cat) => cat === 'fold7' || cat === 'applefold';

  /* ---------- Data ---------- */
  let DATA = null;
  async function loadData() {
    try {
      const r = await fetch('data/makerworld.json', { cache: 'no-cache' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      DATA = {};
      for (const k of Object.keys(CATS)) DATA[k] = Array.isArray(j[k]) ? j[k] : [];
    } catch (e) {
      console.warn('Kunde inte läsa makerworld.json', e);
      DATA = null;
      $('#grid').innerHTML = `<div class="warn bad">Kunde inte läsa <code>data/makerworld.json</code> (${esc(e.message)}). Öppna sidan via en lokal webbserver, inte som file://.</div>`;
    }
  }

  /* ---------- Flikar ---------- */
  function setTab(tab) {
    state.ui.tab = tab; save();
    document.querySelectorAll('#tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    document.querySelectorAll('.tab').forEach((s) => { s.hidden = s.id !== `tab-${tab}`; });
    ({ browse: renderBrowse, board: renderBoard, inbox: renderInbox, filament: renderFilaments, printer: () => {} })[tab]?.();
  }

  /* ---------- Bläddra ---------- */
  function renderCatbar() {
    $('#catbar').innerHTML = Object.entries(CATS).map(([k, n]) =>
      `<button type="button" data-cat="${k}" aria-pressed="${state.ui.cat === k}">${esc(n)} <span class="muted">${DATA ? DATA[k].length : ''}</span></button>`).join('');
  }
  function renderBrowse() {
    const ui = state.ui;
    renderCatbar();
    $('#q').value = ui.q; $('#sort').value = ui.sort;
    $('#exact').checked = ui.exact; $('#etsySafe').checked = ui.etsySafe; $('#hideNsfw').checked = ui.hideNsfw;
    $('#exactWrap').hidden = !hasExactFilter(ui.cat);
    if (!DATA) return;
    const q = ui.q.trim().toLowerCase();
    const onBoard = new Set(state.board.filter((c) => c.mwId).map((c) => String(c.mwId)));
    let list = DATA[ui.cat].filter((m) => {
      if (ui.hideNsfw && m.nsfw) return false;
      if (hasExactFilter(ui.cat) && ui.exact && !isExact(ui.cat, m)) return false;
      if (ui.etsySafe && (!licInfo(m.lic).commercial || tmInfo(ui.cat, m))) return false;
      if (q && !`${m.t} ${m.by} ${(m.tags || []).join(' ')} ${m.lic}`.toLowerCase().includes(q)) return false;
      return true;
    });
    const k = ui.sort;
    list.sort((a, b) => (k === 'dt' ? String(b.dt).localeCompare(String(a.dt)) : (b[k] || 0) - (a[k] || 0)));
    $('#count').textContent = `${list.length} av ${DATA[ui.cat].length} modeller i ${CATS[ui.cat]}`;
    if (!list.length) { $('#grid').innerHTML = '<p class="empty">Inga träffar med nuvarande filter.</p>'; return; }
    $('#grid').innerHTML = list.map((m) => {
      const li = licInfo(m.lic); const tm = tmInfo(ui.cat, m); const cover = safeUrl(m.c);
      const exact = hasExactFilter(ui.cat) && isExact(ui.cat, m);
      const added = onBoard.has(String(m.id));
      return `<article class="card">
        ${cover ? `<img class="cover" loading="lazy" referrerpolicy="no-referrer" src="${esc(cover)}" alt="">` : '<div class="cover"></div>'}
        <div class="body">
          <h3>${esc(m.t)}</h3>
          <div class="muted">av ${esc(m.by)} · ${esc(m.dt)} ${exact ? '<span class="pill exact">exakt träff</span>' : ''} ${m.nsfw ? '<span class="pill">NSFW</span>' : ''}</div>
          <div class="stats"><span>⬇ ${fmt(m.d)}</span><span>♥ ${fmt(m.l)}</span><span>🖨 ${fmt(m.p)}</span><span>★ ${fmt(m.col)}</span></div>
          <div class="warn ${li.level}">${esc(li.text)}</div>
          ${tm ? `<div class="warn tm">${esc(tm)}</div>` : ''}
          <div class="actions">
            <a class="btn sm" href="${esc(mwUrl(m))}" target="_blank" rel="noopener noreferrer">MakerWorld ↗</a>
            <button type="button" class="btn sm ${added ? '' : 'primary'}" data-add="${esc(m.id)}" ${added ? 'disabled' : ''}>${added ? 'På tavlan' : '+ Till tavlan'}</button>
          </div>
        </div></article>`;
    }).join('');
    $('#grid').querySelectorAll('img.cover').forEach((img) => img.addEventListener('error', () => { img.style.visibility = 'hidden'; }, { once: true }));
  }
  function addModelToBoard(id) {
    if (!DATA) return;
    const m = DATA[state.ui.cat].find((x) => String(x.id) === String(id));
    if (!m) return;
    state.board.push({
      id: uid(), mwId: m.id, cat: state.ui.cat, title: m.t.trim(), cover: safeUrl(m.c), url: mwUrl(m), lic: m.lic, by: m.by,
      col: 'idea', prio: 3, notes: '', fils: [], colors: null, hours: null, grams: null, price: null, cost: null, created: new Date().toISOString(),
    });
    save(); renderBrowse(); toast('Lagd på tavlan under Idéer');
  }

  /* ---------- Tavla ---------- */
  function cardWarnings(c) {
    const out = [];
    const li = c.lic ? licInfo(c.lic) : null;
    if (li && !li.commercial) out.push(['bad', 'Licens: ' + li.text]);
    else if (li && li.level === 'mid') out.push(['mid', 'Licens: ' + li.text]);
    if (c.cat && TM_CATS[c.cat]) out.push(['tm', tmInfo(c.cat, { t: c.title })]);
    else if (c.cat === 'sneakers') { const t = tmInfo('sneakers', { t: c.title }); if (t) out.push(['tm', t]); }
    const nFil = (c.fils || []).length;
    const nCol = Math.max(num(c.colors) || 0, nFil);
    if (nCol > MAX_COLORS) out.push(['bad', `${nCol} färger – skrivarens CANVAS-system klarar ${MAX_COLORS}. Kräver manuella byten eller omdesign.`]);
    const fils = (c.fils || []).map((id) => state.filaments.find((f) => f.id === id)).filter(Boolean);
    if (fils.some((f) => /tpu/i.test(f.mat))) out.push(['tm', 'TPU: mata normalt via extern spole/bypass, inte flerfärgssystemet – kontrollera i Elegoos manual.']);
    if (c.col === 'etsy' && li && !li.commercial) out.push(['bad', 'Kortet ligger i "Säljs på Etsy" men licensen tillåter inte försäljning!']);
    return out;
  }
  function renderBoard() {
    const colIdx = Object.fromEntries(COLS.map(([k], i) => [k, i]));
    $('#board').innerHTML = COLS.map(([k, name]) => {
      const cards = state.board.filter((c) => c.col === k).sort((a, b) => (a.prio || 3) - (b.prio || 3));
      return `<section class="col" data-col="${k}"><h2><span>${esc(name)}</span><span class="muted">${cards.length}</span></h2>
        ${cards.map((c) => {
          const fils = (c.fils || []).map((id) => state.filaments.find((f) => f.id === id)).filter(Boolean);
          const w = cardWarnings(c);
          const i = colIdx[c.col];
          return `<div class="kc" draggable="true" data-id="${esc(c.id)}">
            <div class="row">${c.cover ? `<img src="${esc(c.cover)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}
              <div><div class="t">${esc(c.title)}</div>
              <div class="muted"><span class="prio p${esc(c.prio)}">P${esc(c.prio)}</span> ${c.cat ? esc(CATS[c.cat] || '') : 'Eget koncept'}</div></div></div>
            ${fils.length ? `<div class="dots">${fils.map((f) => `<span class="dot" title="${esc(`${f.mat} ${f.name}`)}" style="background:${esc(f.hex)}"></span>`).join('')}</div>` : ''}
            ${w.length ? `<div class="warn ${w.some((x) => x[0] === 'bad') ? 'bad' : 'mid'}">${w.length} varning${w.length > 1 ? 'ar' : ''} – öppna kortet</div>` : ''}
            <div class="mv">
              <button type="button" class="btn sm" data-mv="-1" ${i === 0 ? 'disabled' : ''} aria-label="Flytta vänster">◀</button>
              <button type="button" class="btn sm" data-edit aria-label="Redigera">Redigera</button>
              <button type="button" class="btn sm" data-mv="1" ${i === COLS.length - 1 ? 'disabled' : ''} aria-label="Flytta höger">▶</button>
            </div></div>`;
        }).join('') || '<p class="empty">Tomt</p>'}
      </section>`;
    }).join('');
  }
  function moveCard(id, col) {
    const c = state.board.find((x) => x.id === id);
    if (!c || !COLS.some(([k]) => k === col) || c.col === col) return;
    c.col = col; save(); renderBoard();
    if (col === 'etsy' && c.lic && !licInfo(c.lic).commercial) toast('Varning: licensen tillåter inte försäljning');
  }

  /* ---------- Kortdialog ---------- */
  let editingId = null;
  function openCard(id) {
    const c = state.board.find((x) => x.id === id);
    if (!c) return;
    editingId = id;
    $('#dTitle').value = c.title;
    $('#dCol').innerHTML = COLS.map(([k, n]) => `<option value="${k}" ${c.col === k ? 'selected' : ''}>${esc(n)}</option>`).join('');
    $('#dPrio').value = String(c.prio || 3);
    const links = [];
    if (c.url) links.push(`<a href="${esc(safeUrl(c.url))}" target="_blank" rel="noopener noreferrer">Öppna länk ↗</a>`);
    if (c.by) links.push(`Skapare: ${esc(c.by)}`);
    if (c.source) links.push(`Källa: ${esc(c.source)}`);
    $('#dLinks').innerHTML = links.join(' · ');
    $('#dFils').innerHTML = state.filaments.length ? state.filaments.map((f) =>
      `<label><input type="checkbox" value="${esc(f.id)}" ${(c.fils || []).includes(f.id) ? 'checked' : ''}><span class="dot" style="background:${esc(f.hex)}"></span>${esc(`${f.mat} ${f.name}`)}</label>`).join('')
      : '<span class="empty">Lagret är tomt – lägg till under Filament.</span>';
    $('#dColors').value = c.colors ?? ''; $('#dHours').value = c.hours ?? ''; $('#dGrams').value = c.grams ?? '';
    $('#dPrice').value = c.price ?? ''; $('#dCost').value = c.cost ?? ''; $('#dNotes').value = c.notes || '';
    refreshDlg();
    $('#cardDlg').showModal();
  }
  function readDlg(c) {
    c.title = $('#dTitle').value.trim() || c.title;
    c.col = $('#dCol').value; c.prio = Math.min(5, Math.max(1, parseInt($('#dPrio').value, 10) || 3));
    c.fils = [...$('#dFils').querySelectorAll('input:checked')].map((i) => i.value);
    c.colors = num($('#dColors').value); c.hours = num($('#dHours').value); c.grams = num($('#dGrams').value);
    c.price = num($('#dPrice').value); c.cost = num($('#dCost').value); c.notes = $('#dNotes').value;
  }
  function refreshDlg() {
    const c = state.board.find((x) => x.id === editingId);
    if (!c) return;
    const tmp = { ...c }; readDlg(tmp);
    $('#dLic').innerHTML = c.lic ? `<div class="warn ${licInfo(c.lic).level}">${esc(licInfo(c.lic).text)}</div>` : '<div class="warn info">Eget koncept – kontrollera rättigheter om det bygger på någon annans design eller varumärke.</div>';
    $('#dWarn').innerHTML = cardWarnings(tmp).filter(([, t]) => !t.startsWith('Licens:')).map(([l, t]) => `<div class="warn ${l}">${esc(t)}</div>`).join('');
    const parts = [];
    if (tmp.price != null && tmp.cost != null) parts.push(`Marginal: ${Math.round(tmp.price - tmp.cost)} kr${tmp.price > 0 ? ` (${Math.round((1 - tmp.cost / tmp.price) * 100)} %)` : ''}`);
    if (tmp.price != null && tmp.hours) parts.push(`${Math.round((tmp.price - (tmp.cost || 0)) / tmp.hours)} kr per skrivartimme`);
    $('#dCalc').textContent = parts.join(' · ') + (parts.length ? ' – exkl. Etsy-avgifter och frakt.' : '');
  }

  /* ---------- Inkorg ---------- */
  function renderInbox() {
    const el = $('#inboxList');
    if (!state.inbox.length) { el.innerHTML = '<p class="empty">Inkorgen är tom.</p>'; return; }
    el.innerHTML = [...state.inbox].reverse().map((i) => {
      const u = safeUrl(i.link);
      return `<div class="item" data-id="${esc(i.id)}"><div class="grow">
        <span class="pill">${esc(i.source)}</span> <span class="muted">${esc((i.created || '').slice(0, 10))}</span>
        <div>${esc(i.note)}</div>${u ? `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(u)}</a>` : ''}</div>
        <div class="actions"><button type="button" class="btn sm primary" data-promote>Gör till kort</button>
        <button type="button" class="btn sm danger" data-del>Ta bort</button></div></div>`;
    }).join('');
  }

  /* ---------- Filament ---------- */
  function renderFilaments() {
    const el = $('#filList');
    el.innerHTML = state.filaments.length ? state.filaments.map((f) => `<div class="item" data-id="${esc(f.id)}">
      <div class="grow"><span class="dot" style="background:${esc(f.hex)}"></span> <strong>${esc([f.brand, f.mat, f.name].filter(Boolean).join(' '))}</strong>
      <span class="muted">${f.qty != null && f.qty !== '' ? `· ${esc(f.qty)} rulle/ar` : ''} ${f.note ? '· ' + esc(f.note) : ''}</span>
      ${/tpu/i.test(f.mat) ? '<div class="muted">TPU – extern spole/bypass, kontrollera i Elegoos manual.</div>' : ''}</div>
      <div class="actions"><button type="button" class="btn sm" data-fedit>Redigera</button><button type="button" class="btn sm danger" data-fdel>Ta bort</button></div></div>`).join('')
      : '<p class="empty">Inget filament i lagret.</p>';
  }

  /* ---------- Export / import ---------- */
  function exportJson() {
    try {
      const blob = new Blob([JSON.stringify({ ...state, exported: new Date().toISOString() }, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `print-planer-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } catch (e) { console.error(e); toast('Exporten misslyckades'); }
  }
  async function importJson(file) {
    try {
      const j = JSON.parse(await file.text());
      if (!j || typeof j !== 'object' || (!Array.isArray(j.board) && !Array.isArray(j.filaments))) throw new Error('Filen ser inte ut som en Print-planeraren-export');
      if (!confirm('Ersätta nuvarande tavla, inkorg och lager med filens innehåll?')) return;
      state = normalize(j); save(); setTab(state.ui.tab); toast('Importerat');
    } catch (e) { console.error(e); toast('Import misslyckades: ' + e.message); }
  }

  /* ---------- Händelser ---------- */
  function bind() {
    $('#tabs').addEventListener('click', (e) => { const b = e.target.closest('button[data-tab]'); if (b) setTab(b.dataset.tab); });
    $('#catbar').addEventListener('click', (e) => { const b = e.target.closest('button[data-cat]'); if (b) { state.ui.cat = b.dataset.cat; save(); renderBrowse(); } });
    let qt;
    $('#q').addEventListener('input', (e) => { clearTimeout(qt); qt = setTimeout(() => { state.ui.q = e.target.value; save(); renderBrowse(); }, 150); });
    $('#sort').addEventListener('change', (e) => { state.ui.sort = e.target.value; save(); renderBrowse(); });
    for (const k of ['exact', 'etsySafe', 'hideNsfw']) $('#' + k).addEventListener('change', (e) => { state.ui[k] = e.target.checked; save(); renderBrowse(); });
    $('#grid').addEventListener('click', (e) => { const b = e.target.closest('button[data-add]'); if (b) addModelToBoard(b.dataset.add); });

    const board = $('#board');
    board.addEventListener('click', (e) => {
      const kc = e.target.closest('.kc'); if (!kc) return;
      const mv = e.target.closest('button[data-mv]');
      if (mv) {
        const c = state.board.find((x) => x.id === kc.dataset.id);
        const i = COLS.findIndex(([k]) => k === c.col) + parseInt(mv.dataset.mv, 10);
        if (COLS[i]) moveCard(c.id, COLS[i][0]);
        return;
      }
      openCard(kc.dataset.id);
    });
    board.addEventListener('dragstart', (e) => { const kc = e.target.closest('.kc'); if (!kc) return; kc.classList.add('dragging'); e.dataTransfer.setData('text/plain', kc.dataset.id); e.dataTransfer.effectAllowed = 'move'; });
    board.addEventListener('dragend', (e) => { e.target.closest?.('.kc')?.classList.remove('dragging'); });
    board.addEventListener('dragover', (e) => { const col = e.target.closest('.col'); if (!col) return; e.preventDefault(); board.querySelectorAll('.col.over').forEach((c) => c !== col && c.classList.remove('over')); col.classList.add('over'); });
    board.addEventListener('dragleave', (e) => { const col = e.target.closest('.col'); if (col && !col.contains(e.relatedTarget)) col.classList.remove('over'); });
    board.addEventListener('drop', (e) => { const col = e.target.closest('.col'); if (!col) return; e.preventDefault(); col.classList.remove('over'); moveCard(e.dataTransfer.getData('text/plain'), col.dataset.col); });

    const form = $('#cardForm');
    form.addEventListener('input', refreshDlg);
    form.addEventListener('change', refreshDlg);
    $('#cardDlg').addEventListener('close', () => {
      const rv = $('#cardDlg').returnValue; const idx = state.board.findIndex((x) => x.id === editingId);
      if (idx < 0) return;
      if (rv === 'save') { readDlg(state.board[idx]); save(); toast('Sparat'); }
      else if (rv === 'delete') {
        if (confirm('Ta bort kortet från tavlan?')) { state.board.splice(idx, 1); save(); toast('Kort borttaget'); }
      }
      editingId = null; renderBoard();
    });
    $('#dSave').addEventListener('click', (e) => { if (!$('#dTitle').value.trim()) { e.preventDefault(); $('#dTitle').reportValidity(); } });

    $('#inboxForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const note = $('#inNote').value.trim(); const link = $('#inLink').value.trim();
      if (!note) return;
      if (link && !safeUrl(link)) { toast('Länken måste börja med http(s)://'); return; }
      state.inbox.push({ id: uid(), source: $('#inSource').value, link, note, created: new Date().toISOString() });
      save(); e.target.reset(); renderInbox(); toast('Lagt i inkorgen');
    });
    $('#inboxList').addEventListener('click', (e) => {
      const it = e.target.closest('.item'); if (!it) return;
      const idx = state.inbox.findIndex((x) => x.id === it.dataset.id); if (idx < 0) return;
      const i = state.inbox[idx];
      if (e.target.closest('[data-promote]')) {
        state.board.push({ id: uid(), cat: null, title: i.note.split('\n')[0].slice(0, 80), cover: '', url: safeUrl(i.link), source: i.source, lic: null,
          col: 'idea', prio: 3, notes: i.note, fils: [], colors: null, hours: null, grams: null, price: null, cost: null, created: new Date().toISOString() });
        state.inbox.splice(idx, 1); save(); renderInbox(); toast('Kort skapat under Idéer');
      } else if (e.target.closest('[data-del]') && confirm('Ta bort posten?')) { state.inbox.splice(idx, 1); save(); renderInbox(); }
    });

    $('#filForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const f = { brand: $('#fBrand').value.trim(), mat: $('#fMat').value, name: $('#fName').value.trim(), hex: $('#fHex').value, qty: num($('#fQty').value), note: $('#fNote').value.trim() };
      if (!f.name) return;
      if (!/^#[0-9a-f]{6}$/i.test(f.hex)) f.hex = '#888888';
      const id = $('#fId').value;
      const ex = id && state.filaments.find((x) => x.id === id);
      if (ex) Object.assign(ex, f); else state.filaments.push({ id: uid(), ...f });
      save(); e.target.reset(); $('#fId').value = ''; renderFilaments(); toast('Filament sparat');
    });
    $('#fReset').addEventListener('click', () => { $('#fId').value = ''; });
    $('#filList').addEventListener('click', (e) => {
      const it = e.target.closest('.item'); if (!it) return;
      const f = state.filaments.find((x) => x.id === it.dataset.id); if (!f) return;
      if (e.target.closest('[data-fedit]')) {
        $('#fId').value = f.id; $('#fBrand').value = f.brand || ''; $('#fMat').value = f.mat; $('#fName').value = f.name;
        $('#fHex').value = f.hex || '#888888'; $('#fQty').value = f.qty ?? ''; $('#fNote').value = f.note || ''; $('#fName').focus();
      } else if (e.target.closest('[data-fdel]') && confirm(`Ta bort ${f.mat} ${f.name}?`)) {
        state.filaments = state.filaments.filter((x) => x.id !== f.id);
        state.board.forEach((c) => { c.fils = (c.fils || []).filter((x) => x !== f.id); });
        save(); renderFilaments();
      }
    });

    $('#btnExport').addEventListener('click', exportJson);
    $('#fileImport').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) importJson(f); e.target.value = ''; });
  }

  async function init() {
    bind();
    await loadData();
    setTab(state.ui.tab);
  }
  init().catch((e) => { console.error('Init misslyckades', e); toast('Något gick fel vid start'); });
})();
