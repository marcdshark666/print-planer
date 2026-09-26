/* Print-planeraren – statisk, ingen byggkedja. Allt tillstånd i localStorage + export/import. */
(() => {
  'use strict';

  const STORE_KEY = 'print-planer:v1';
  const CATS = {
    fav: 'Mina favoriter',
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
  const TAG_LEVEL = { teknik: 'info', 'affär': 'ok', koncept: 'exact', sneakers: 'mid', verktyg: 'tm' };
  const TIPS = [
    { k: 'dry', t: 'Torka filamentet', d: 'Stringing/trådar = fuktigt filament. Förvara och printa ur torkbox.', url: 'https://www.instagram.com/reel/DcwpenkxBej/' },
    { k: 'cut', t: 'Dela upp stora modeller', d: 'Större än 256 mm (byggvolymen)? Använd Cut i slicern och limma/plugga ihop delarna.', url: 'https://www.instagram.com/reel/DdkE7QKvcjJ/' },
    { k: 'supports', t: 'Placera supports medvetet', d: 'Orientera modellen så stöden hamnar där efterarbetet syns minst.', url: 'https://www.instagram.com/reel/DctXk9XACqu/' },
    { k: 'snap', t: 'Snäppfästen', d: 'Klick-fäste mellan modell och bas ger kvalitetskänsla och enklare frakt.', url: 'https://www.instagram.com/reel/DbybKTpMKnd/' },
    { k: 'variants', t: 'Färgvarianter som säljstrategi', d: 'Samma modell i flera färgställningar = fler annonser utan ny design.', url: 'https://www.instagram.com/reel/DcRsFM5Bc1b/' },
    { k: 'gradient', t: 'Gradient-/silk-filament som säljpunkt', d: 'Färgskiftande filament gör en enkel modell säljbar – lyft det i bilder och titel.', url: 'https://www.instagram.com/reel/Db_EJylx1XQ/' },
    { k: 'mold', t: 'Print som master för silikongjutning', d: 'Printa, efterbehandla ytan och gjut silikonform för serier i andra material.', url: 'https://www.instagram.com/reel/DdOIdH7Tiox/' },
  ];
  const STATUS = [['new', 'Ny'], ['todo', 'Ska göras'], ['done', 'Gjort'], ['skip', 'Skippa']];
  const STATUS_ORDER = { todo: 0, new: 1, done: 2, skip: 3 };
  const PSECS = [
    ['sensor', 'Sensorhållare', 'Dexcom G7 först, sedan övriga Dexcom/CGM. Libre-, Medtronic- och pumpbrus är bortfiltrerat.'],
    ['infusion', 'Infusionsset & pump', 'Tandem (t:slim X2 / Mobi) först, sedan övriga hållare, fodral och organizers för pump, infusionsset och pennor.'],
    ['dextro', 'Dextro & glukos', 'Tabletthållare, fodral och dispensrar först, sedan kit och organizers.'],
    ['skafferi', 'Skafferiet – prydligt', 'Staplingsbara lådor och hyllor, plus dextro-dispensrar som passar i skafferiet.'],
    ['hands', 'Handskulptur – Marc & Ada', 'Skulptur av Marcs och Adas händer som håller varandra. Modellerna nedan är inspiration.'],
    ['uppfinn', 'Mina diabetesuppfinningar', 'Marcs egna idéer – brainstorm, inte färdiga modeller. MakerWorld-exemplen under varje idé är inspiration att remixa eller skala.'],
  ];
  // Sektioner som fanns innan seedningen blev per sektion – befintliga användare har redan fått dem.
  const PSECS_V1 = ['sensor', 'infusion', 'dextro', 'skafferi', 'hands'];
  const IDEAS = [
    { k: 'automat', t: 'Bordsautomat för lösa Dextro-tabletter',
      d: 'En liten godisautomat på bordet för överblivna lösa Dextro Energy-tabletter. Vrid eller tryck – en tablett i taget matas ut i en skål.',
      mått: 'Tabletterna är platta rektangulära rutor, ca 3 × 2 cm (mät tjockleken på dina). Magasinet ca 32 × 22 mm invändigt så de staplas plant; utmatningsfack för exakt en tablett.',
      fil: 'Stomme i PLA svart eller vit (Elegoo RFID), front/detaljer i PLA Silk silvergrå, TPU 95A svart till gummifötter och grepp på vredet.' },
    { k: 'ficka', t: 'Fickdispenser à la PEZ för lösa Dextro-bitar',
      d: 'Som en gammal PEZ-dispenser: ett huvud/ansikte på toppen som man trycker upp med tummen så en Dextro-bit sticker ut. Smal nog för fickan.',
      mått: 'Invändig kanal ca 31 × 21 mm för 3 × 2 cm-rutor (lite spel), rymmer 4–6 tabletter. Ytterbredd runt 25 mm och längd ca 90–110 mm.',
      fil: 'Kropp i PLA Basic svart, huvudet i PLA Silk silvergrå eller vit RFID, fjäder/matarbricka och gångjärn i TPU 95A svart.' },
  ];
  const PSEED = {
    sensor: 'Skyddskåpa för Dexcom G7 – testa passform',
    infusion: 'Organizer för infusionsset och reservoarer',
    dextro: 'Dextro-fodral för fickan/väskan',
    uppfinn: ['Idé: bordsautomat för lösa Dextro-tabletter', 'Idé: PEZ-fickdispenser för Dextro-bitar'],
    skafferi: 'Dextro-dispenser och staplingsbara lådor i skafferiet',
    hands: 'Handskulptur Marc & Ada – skanna händerna',
  };
  const HAND_STEPS = [
    ['scan', 'Skanna händerna ihop med en mobilapp för fotogrammetri (t.ex. gratisläge i Polycam, KIRI Engine eller Scaniverse – kontrollera villkor/pris). Alternativ: gjut i alginat/gips och skanna avgjutningen.'],
    ['blender', 'Rensa och stäng meshen i Blender (installerat) – ta bort brus, fyll hål, gör den vattentät.'],
    ['base', 'Lägg till en sockel med gravyr (namn/datum).'],
    ['cut', 'Dela upp i ElegooSlicer om modellen är större än 256 mm (Cut med pluggar).'],
    ['print', 'Printa i PLA Silk silvergrå – provprinta i liten skala först.'],
    ['post', 'Efterbehandla: ta bort stöd, slipa, ev. spackel/lack.'],
  ];
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
      seeded: [],
      tips: {},
      videos: {},
      customVideos: [],
      personal: { rows: [], seeded: false, seededSecs: [], steps: {}, notes: '' },
      ui: { tab: 'videos', vSort: 'prio', vFilter: 'all', cat: 'avp', favCol: 'Default Collection', sort: 'd', q: '', exact: true, etsySafe: false, hideNsfw: true },
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
      seeded: Array.isArray(s.seeded) ? s.seeded.filter((u) => typeof u === 'string') : [],
      tips: s.tips && typeof s.tips === 'object' ? s.tips : {},
      videos: s.videos && typeof s.videos === 'object' ? s.videos : {},
      customVideos: Array.isArray(s.customVideos) ? s.customVideos.filter((v) => v && v.id && safeUrl(v.url)) : [],
      personal: normPersonal(s.personal),
      ui: { ...base.ui, ...(s.ui && typeof s.ui === 'object' ? s.ui : {}) },
    };
  }
  function normPersonal(p) {
    const o = p && typeof p === 'object' ? p : {};
    return {
      rows: Array.isArray(o.rows) ? o.rows.filter((r) => r && r.id && r.title && PSECS.some(([k]) => k === r.sec)) : [],
      seeded: !!o.seeded,
      seededSecs: Array.isArray(o.seededSecs) ? o.seededSecs.filter((k) => typeof k === 'string') : [],
      steps: o.steps && typeof o.steps === 'object' ? o.steps : {},
      notes: typeof o.notes === 'string' ? o.notes : '',
    };
  }
  let state;
  try { state = normalize(JSON.parse(localStorage.getItem(STORE_KEY))); } catch { state = freshState(); }
  // v3: Videotips blir huvudvyn – byt flik en gång för befintliga användare.
  if (!state.ui.v3) { state.ui.v3 = true; state.ui.tab = 'videos'; }
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
  // Favoriter saknar franchise-kategori – härled den från titeln så varumärkesvarningen följer med.
  function tmCat(cat, m) {
    if (cat !== 'fav') return cat;
    const t = `${m.t || ''} ${(m.tags || []).join(' ')}`;
    if (/predator|alien|xenomorph|zenomorph/i.test(t)) return 'avp';
    if (/resident\s?evil|umbrella corp/i.test(t)) return 're';
    if (/shoe|sneaker|slipper/i.test(t)) return 'sneakers';
    return cat;
  }
  function tmInfo(cat, m) {
    cat = tmCat(cat, m);
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
  let FAV = null;
  async function getJson(path) {
    const r = await fetch(path, { cache: 'no-cache' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }
  async function loadFavorites() {
    try {
      const j = await getJson('data/favorites.json');
      const models = Array.isArray(j.models) ? j.models.filter((m) => m && m.id && m.t) : [];
      const cols = j.collections && typeof j.collections === 'object' ? j.collections : {};
      FAV = { user: String(j.user || ''), fetched: String(j.fetched || ''), models, cols: Object.fromEntries(Object.entries(cols).map(([k, v]) => [k, Array.isArray(v) ? v : []])) };
    } catch (e) {
      console.warn('Kunde inte läsa favorites.json', e);
      FAV = { user: '', fetched: '', models: [], cols: {}, error: e.message };
    }
  }
  // Seeda Messenger-tipsen en gång per url – borttagna/befordrade tips kommer inte tillbaka (state.seeded).
  async function seedInbox() {
    try {
      const tips = await getJson('data/messenger-tips.json');
      if (!Array.isArray(tips)) return;
      const known = new Set([...state.seeded, ...state.inbox.map((i) => i.link), ...state.board.map((c) => c.url)].filter(Boolean));
      let added = 0;
      for (const t of tips) {
        const url = safeUrl(t && t.url);
        if (!url || known.has(url) || known.has(t.url)) continue;
        state.inbox.push({ id: uid(), source: String(t.source || 'Messenger'), link: url, note: String(t.note || ''), by: String(t.by || ''), tag: String(t.tag || ''), created: new Date().toISOString() });
        state.seeded.push(url); known.add(url); added++;
      }
      if (added) save();
    } catch (e) { console.warn('Kunde inte läsa messenger-tips.json', e); }
  }
  async function loadData() {
    try {
      const j = await getJson('data/makerworld.json');
      DATA = {};
      for (const k of Object.keys(CATS)) DATA[k] = Array.isArray(j[k]) ? j[k] : [];
      DATA.fav = FAV ? FAV.models : [];
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
    ({ videos: renderVideos, personal: renderPersonal, favs: renderFavs, browse: renderBrowse, board: renderBoard, inbox: renderInbox, filament: renderFilaments, printer: renderTips })[tab]?.();
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
    const onBoard = boardIds();
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
    fillGrid($('#grid'), list, ui.cat, onBoard);
  }
  const boardIds = () => new Set(state.board.filter((c) => c.mwId).map((c) => String(c.mwId)));
  function modelCard(m, cat, onBoard) {
    const li = licInfo(m.lic); const tm = tmInfo(cat, m); const cover = safeUrl(m.c);
    const exact = hasExactFilter(cat) && isExact(cat, m);
    const added = onBoard.has(String(m.id));
    const stats = [['⬇', m.d], ['♥', m.l], ['🖨', m.p], ['★', m.col]].filter(([, v]) => v != null).map(([i, v]) => `<span>${i} ${fmt(v)}</span>`).join('');
    return `<article class="card">
        ${cover ? `<img class="cover" loading="lazy" referrerpolicy="no-referrer" src="${esc(cover)}" alt="">` : '<div class="cover"></div>'}
        <div class="body">
          <h3>${esc(m.t)}</h3>
          <div class="muted">av ${esc(m.by)}${m.dt ? ` · ${esc(m.dt)}` : ''} ${exact ? '<span class="pill exact">exakt träff</span>' : ''} ${m.nsfw ? '<span class="pill">NSFW</span>' : ''}</div>
          <div class="stats">${stats}</div>
          <div class="warn ${li.level}">${esc(li.text)}</div>
          ${tm ? `<div class="warn tm">${esc(tm)}</div>` : ''}
          <div class="actions">
            <a class="btn sm" href="${esc(mwUrl(m))}" target="_blank" rel="noopener noreferrer">MakerWorld ↗</a>
            <button type="button" class="btn sm ${added ? '' : 'primary'}" data-add="${esc(m.id)}" data-src="${esc(cat)}" ${added ? 'disabled' : ''}>${added ? 'På tavlan' : '+ Lägg på tavlan'}</button>
          </div>
        </div></article>`;
  }
  function fillGrid(el, list, cat, onBoard) {
    el.innerHTML = list.map((m) => modelCard(m, cat, onBoard)).join('');
    el.querySelectorAll('img.cover').forEach((img) => img.addEventListener('error', () => { img.style.visibility = 'hidden'; }, { once: true }));
  }

  /* ---------- Mina favoriter ---------- */
  function renderFavs() {
    const el = $('#favGrid');
    if (!FAV || FAV.error) { el.innerHTML = `<div class="warn bad">Kunde inte läsa <code>data/favorites.json</code>${FAV ? ` (${esc(FAV.error)})` : ''}.</div>`; $('#favbar').innerHTML = ''; return; }
    const names = Object.keys(FAV.cols);
    if (!names.includes(state.ui.favCol)) state.ui.favCol = names[0] || '';
    $('#favMeta').textContent = `MakerWorld-mappar för ${FAV.user}${FAV.fetched ? ` · hämtade ${FAV.fetched}` : ''}`;
    $('#favbar').innerHTML = names.map((n) => {
      const c = FAV.cols[n].length;
      return `<button type="button" data-fav="${esc(n)}" aria-pressed="${state.ui.favCol === n}">${esc(n)} <span class="muted">${c || 'tom – lägg till på MakerWorld'}</span></button>`;
    }).join('');
    const byId = new Map(FAV.models.map((m) => [String(m.id), m]));
    const list = (FAV.cols[state.ui.favCol] || []).map((id) => byId.get(String(id))).filter(Boolean);
    if (!list.length) {
      el.innerHTML = `<p class="empty">Mappen "${esc(state.ui.favCol)}" är tom – lägg till modeller i mappen på <a href="https://makerworld.com/" target="_blank" rel="noopener noreferrer">MakerWorld ↗</a> så dyker de upp här vid nästa hämtning.</p>`;
      return;
    }
    fillGrid(el, list, 'fav', boardIds());
  }

  function addModelToBoard(id, src) {
    const cat = src || state.ui.cat;
    const pool = cat === 'fav' ? (FAV ? FAV.models : []) : (DATA ? DATA[cat] || [] : []);
    const m = pool.find((x) => String(x.id) === String(id));
    if (!m) return;
    if (boardIds().has(String(m.id))) { toast('Redan på tavlan'); return; }
    state.board.push({
      id: uid(), mwId: m.id, cat: tmCat(cat, m), title: m.t.trim(), cover: safeUrl(m.c), url: mwUrl(m), lic: m.lic, by: m.by,
      col: 'idea', prio: 3, notes: '', fils: [], colors: null, hours: null, grams: null, price: null, cost: null, created: new Date().toISOString(),
    });
    save(); if (state.ui.tab === 'favs') renderFavs(); else renderBrowse(); toast('Lagd på tavlan under Idéer');
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
        <span class="pill">${esc(i.source)}</span>${i.tag ? ` <span class="pill tag ${esc(TAG_LEVEL[i.tag] || '')}">${esc(i.tag)}</span>` : ''}${i.by ? ` <span class="muted">${esc(i.by)}</span>` : ''} <span class="muted">${esc((i.created || '').slice(0, 10))}</span>
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

  /* ---------- Tips att tillämpa ---------- */
  function renderTips() {
    const done = TIPS.filter((t) => state.tips[t.k]).length;
    $('#tipsCount').textContent = `${done} av ${TIPS.length} tillämpade.`;
    $('#tipsList').innerHTML = TIPS.map((t) => `<li><label><input type="checkbox" data-tip="${esc(t.k)}" ${state.tips[t.k] ? 'checked' : ''}>
      <span><strong>${esc(t.t)}</strong> – ${esc(t.d)} <a href="${esc(t.url)}" target="_blank" rel="noopener noreferrer">Reel ↗</a></span></label></li>`).join('');
  }

  /* ---------- Videotips ---------- */
  let VIDEOS = null;
  async function loadVideos() {
    try {
      const j = await getJson('data/videos.json');
      VIDEOS = Array.isArray(j) ? j.filter((v) => v && v.id && safeUrl(v.url)) : [];
    } catch (e) { console.warn('Kunde inte läsa videos.json', e); VIDEOS = []; VIDEOS.error = e.message; }
  }
  const vState = (id) => (state.videos[id] ||= { impl: false, prio: 3, status: 'new' });
  function allVideos() {
    const base = (VIDEOS || []).map((v, i) => ({ ...v, order: i, custom: false }));
    const own = state.customVideos.map((v, i) => ({
      id: v.id, url: v.url, creator: v.creator || 'Eget klipp', thumb: '', titel_sv: (v.note || v.url).split('\n')[0].slice(0, 90),
      handlar_om: v.note || '', forslag: '', tag: '', reklam: false, anteckning: '', order: 1000 + i, custom: true,
    }));
    return [...base, ...own].map((v) => ({ ...v, st: vState(v.id) }));
  }
  const statusName = (k) => (STATUS.find(([s]) => s === k) || [, ''])[1];
  const statusSel = (cur, attr) => `<select ${attr} aria-label="Status">${STATUS.map(([k, n]) => `<option value="${k}" ${cur === k ? 'selected' : ''}>${n}</option>`).join('')}</select>`;
  const prioSel = (cur, attr) => `<select ${attr} aria-label="Prioritet">${[1, 2, 3, 4, 5].map((n) => `<option value="${n}" ${Number(cur) === n ? 'selected' : ''}>P${n}</option>`).join('')}</select>`;
  const byPrio = (a, b) => (a.prio || 3) - (b.prio || 3) || (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9);

  function renderVideos() {
    const grid = $('#videoGrid');
    $('#vSort').value = state.ui.vSort; $('#vFilter').value = state.ui.vFilter;
    const all = allVideos();
    // Checklista: allt markerat Implementera, sorterat på prioritet (1 = högst).
    const impl = all.filter((v) => v.st.impl).sort((a, b) => byPrio(a.st, b.st) || a.order - b.order);
    const doneN = impl.filter((v) => v.st.status === 'done').length;
    $('#vCheckMeta').textContent = impl.length ? `${doneN} av ${impl.length} klara.` : '';
    $('#vChecklist').innerHTML = impl.length ? impl.map((v) => `<li class="${v.st.status === 'done' ? 'is-done' : ''}${v.st.status === 'skip' ? ' is-skip' : ''}">
        <label><input type="checkbox" data-vdone="${esc(v.id)}" ${v.st.status === 'done' ? 'checked' : ''}>
        <span><span class="prio p${esc(v.st.prio)}">P${esc(v.st.prio)}</span> <strong>${esc(v.titel_sv)}</strong>${v.forslag ? ` – ${esc(v.forslag)}` : ''}
        <a href="${esc(safeUrl(v.url))}" target="_blank" rel="noopener noreferrer">Klipp ↗</a> <span class="muted">(${esc(statusName(v.st.status))})</span></span></label></li>`).join('')
      : '<li class="empty">Inget markerat ännu – kryssa i "Implementera" på ett klipp nedan.</li>';
    if (VIDEOS && VIDEOS.error) { grid.innerHTML = `<div class="warn bad">Kunde inte läsa <code>data/videos.json</code> (${esc(VIDEOS.error)}).</div>`; return; }
    const f = state.ui.vFilter;
    const list = all.filter((v) => f === 'all' || (f === 'impl' ? v.st.impl : v.st.status === f));
    if (state.ui.vSort === 'prio') list.sort((a, b) => byPrio(a.st, b.st) || a.order - b.order);
    else if (state.ui.vSort === 'status') list.sort((a, b) => (STATUS_ORDER[a.st.status] ?? 9) - (STATUS_ORDER[b.st.status] ?? 9) || a.order - b.order);
    else list.sort((a, b) => a.order - b.order);
    $('#vCount').textContent = `${list.length} av ${all.length} klipp`;
    if (!list.length) { grid.innerHTML = '<p class="empty">Inga klipp med nuvarande filter.</p>'; return; }
    grid.innerHTML = list.map((v) => {
      const u = safeUrl(v.url);
      return `<article class="card vcard ${v.st.status === 'skip' ? 'is-skip' : ''}" data-vid="${esc(v.id)}">
        ${v.thumb ? `<a class="vthumb" href="${esc(u)}" target="_blank" rel="noopener noreferrer" title="Öppna på Instagram"><img loading="lazy" src="${esc(v.thumb)}" alt="Stillbild från klippet av ${esc(v.creator)}"><span class="play">Instagram ↗</span></a>` : ''}
        <div class="body">
          <h3>${esc(v.titel_sv)}</h3>
          <div class="muted">${esc(v.creator)} ${v.tag ? `<span class="pill tag ${esc(TAG_LEVEL[v.tag] || '')}">${esc(v.tag)}</span>` : ''} ${v.reklam ? '<span class="pill ad">Reklam</span>' : ''} ${v.needs_review ? '<span class="pill">ej granskad</span>' : ''}</div>
          ${v.custom
            ? `<p>${esc(v.handlar_om)}</p><a class="wrapurl" href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(u)}</a>`
            : `<p><strong>Handlar om:</strong> ${esc(v.handlar_om)}</p><p><strong>Förslag för dig:</strong> ${esc(v.forslag)}</p>`}
          <div class="vctrl">
            <label class="chk"><input type="checkbox" data-k="impl" ${v.st.impl ? 'checked' : ''}> Implementera</label>
            ${prioSel(v.st.prio, 'data-k="prio"')}
            ${statusSel(v.st.status, 'data-k="status"')}
            ${v.custom ? '<button type="button" class="btn sm danger" data-vdel>Ta bort</button>' : ''}
          </div>
        </div></article>`;
    }).join('');
    grid.querySelectorAll('.vthumb img').forEach((img) => img.addEventListener('error', () => { img.style.visibility = 'hidden'; }, { once: true }));
  }

  /* ---------- Marcs egna ---------- */
  let PERS = null;
  async function loadPersonal() {
    try {
      const j = await getJson('data/personal.json');
      const sec = j && j.sections && typeof j.sections === 'object' ? j.sections : {};
      PERS = Object.fromEntries(PSECS.map(([k]) => [k, Array.isArray(sec[k]) ? sec[k].filter((m) => m && m.id && m.t) : []]));
    } catch (e) { console.warn('Kunde inte läsa personal.json', e); PERS = { error: e.message }; }
  }
  // Seedas per sektion så att nya sektioner (t.ex. uppfinningarna) syns även för befintliga användare.
  function seedPersonal() {
    const p = state.personal;
    const done = new Set(p.seededSecs);
    if (p.seeded) PSECS_V1.forEach((k) => done.add(k));
    let changed = false;
    for (const [k] of PSECS) {
      if (done.has(k)) continue;
      for (const title of [].concat(PSEED[k] || [])) p.rows.push({ id: uid(), sec: k, title, prio: 3, status: 'new', created: new Date().toISOString() });
      done.add(k); changed = true;
    }
    if (changed || !p.seeded) { p.seeded = true; p.seededSecs = [...done]; save(); }
  }
  function personalCard(m, sec, listed) {
    const cover = safeUrl(m.c); const added = listed.has(String(m.id));
    const stats = [['⬇', m.d], ['♥', m.l], ['🖨', m.p]].filter(([, v]) => v != null).map(([i, v]) => `<span>${i} ${fmt(v)}</span>`).join('');
    const pills = [m.g7 && 'Dexcom G7', m.tandem && 'Tandem', m.tab && 'tabletter', m.dextro && 'dextro-dispenser', m.featured && 'inspiration']
      .filter(Boolean).map((p) => `<span class="pill exact">${esc(p)}</span>`).join(' ');
    return `<article class="card">
        ${cover ? `<img class="cover" loading="lazy" referrerpolicy="no-referrer" src="${esc(cover)}" alt="">` : '<div class="cover"></div>'}
        <div class="body">
          <h3>${esc(m.t)}</h3>
          <div class="muted">av ${esc(m.by)} ${pills}</div>
          <div class="stats">${stats}</div>
          ${m.fit ? `<div class="muted fit">${esc(m.fit)}</div>` : ''}
          <div class="lic">Licens: ${esc(m.lic || 'okänd')}</div>
          <div class="actions">
            <a class="btn sm" href="${esc(mwUrl(m))}" target="_blank" rel="noopener noreferrer">MakerWorld ↗</a>
            <button type="button" class="btn sm${added ? '' : ' primary'}" data-padd="${esc(m.id)}" data-sec="${esc(sec)}" ${added ? 'disabled' : ''}>${added ? 'I min lista' : '+ Lägg till i min lista'}</button>
          </div>
        </div></article>`;
  }
  function renderPersonal() {
    const el = $('#personalSecs');
    if (!PERS || PERS.error) { el.innerHTML = `<div class="warn bad">Kunde inte läsa <code>data/personal.json</code>${PERS ? ` (${esc(PERS.error)})` : ''}.</div>`; return; }
    const openSecs = state.ui.pOpen || {};
    el.innerHTML = PSECS.map(([k, name, intro]) => {
      const rows = state.personal.rows.filter((r) => r.sec === k).sort(byPrio);
      const listed = new Set(rows.filter((r) => r.mwId).map((r) => String(r.mwId)));
      const models = PERS[k] || [];
      const doneN = rows.filter((r) => r.status === 'done').length;
      const steps = k !== 'hands' ? '' : `<h3>Steg för steg</h3><ol class="tips steps">${HAND_STEPS.map(([s, t]) =>
        `<li><label><input type="checkbox" data-step="${s}" ${state.personal.steps[s] ? 'checked' : ''}><span>${esc(t)}</span></label></li>`).join('')}</ol>
        <label>Egna anteckningar<textarea id="handNotes" rows="4" placeholder="Mått, vilken app som funkade, namn/datum till gravyren …">${esc(state.personal.notes)}</textarea></label>`;
      const rowsHtml = rows.map((r) => `<li class="prow${r.status === 'done' ? ' is-done' : ''}${r.status === 'skip' ? ' is-skip' : ''}" data-rid="${esc(r.id)}">
            <input type="checkbox" data-rk="done" ${r.status === 'done' ? 'checked' : ''} aria-label="Klar">
            <span class="grow">${r.url ? `<a href="${esc(safeUrl(r.url))}" target="_blank" rel="noopener noreferrer">${esc(r.title)}</a>` : esc(r.title)}</span>
            ${prioSel(r.prio, 'data-rk="prio"')} ${statusSel(r.status, 'data-rk="status"')}
            <button type="button" class="btn sm danger" data-rk="del" aria-label="Ta bort rad">✕</button></li>`).join('');
      return `<section class="panel psec" data-sec="${k}">
        <h2>${esc(name)} <span class="muted">${rows.length ? `${doneN}/${rows.length} klara` : ''}</span></h2>
        <p class="muted">${esc(intro)}</p>
        ${steps}
        <h3>Min lista</h3>
        <ul class="prows">${rowsHtml || '<li class="empty">Tom lista.</li>'}</ul>
        <form class="frow paddform" data-sec="${k}"><input name="t" placeholder="Ny rad – vad vill du printa?" aria-label="Ny rad" required><button class="btn" type="submit">Lägg till</button></form>
        ${k === 'uppfinn' ? IDEAS.map((i) => {
          const ms = models.filter((m) => m.idea === i.k);
          return `<article class="idea">
          <span class="pill idea-tag">💡 Egen uppfinning · Idé</span>
          <h3>${esc(i.t)}</h3>
          <p>${esc(i.d)}</p>
          <p class="muted"><strong>Mått:</strong> ${esc(i.mått)}</p>
          <p class="muted"><strong>Filament ur lagret:</strong> ${esc(i.fil)}</p>
          <details ${openSecs[k + ':' + i.k] ? 'open' : ''} data-psec="${k}:${i.k}"><summary>Liknande på MakerWorld (${ms.length})</summary>
            <div class="grid pgrid">${ms.map((m) => personalCard(m, k, listed)).join('') || '<p class="empty">Inga modeller.</p>'}</div>
          </details></article>`;
        }).join('') : `<details ${openSecs[k] ? 'open' : ''} data-psec="${k}"><summary>Modeller från MakerWorld (${models.length})</summary>
          <div class="grid pgrid">${models.map((m) => personalCard(m, k, listed)).join('') || '<p class="empty">Inga modeller.</p>'}</div>
        </details>`}
      </section>`;
    }).join('');
    el.querySelectorAll('img.cover').forEach((img) => img.addEventListener('error', () => { img.style.visibility = 'hidden'; }, { once: true }));
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
    for (const g of ['#grid', '#favGrid']) $(g).addEventListener('click', (e) => { const b = e.target.closest('button[data-add]'); if (b) addModelToBoard(b.dataset.add, b.dataset.src); });
    $('#favbar').addEventListener('click', (e) => { const b = e.target.closest('button[data-fav]'); if (b) { state.ui.favCol = b.dataset.fav; save(); renderFavs(); } });
    $('#tipsList').addEventListener('change', (e) => { const k = e.target.dataset.tip; if (!k) return; state.tips[k] = e.target.checked; save(); renderTips(); });

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
        state.board.push({ id: uid(), cat: null, title: i.note.split('\n')[0].slice(0, 80), cover: '', url: safeUrl(i.link), source: [i.source, i.by].filter(Boolean).join(' · '), lic: null,
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

    // Videotips
    $('#vSort').addEventListener('change', (e) => { state.ui.vSort = e.target.value; save(); renderVideos(); });
    $('#vFilter').addEventListener('change', (e) => { state.ui.vFilter = e.target.value; save(); renderVideos(); });
    $('#videoGrid').addEventListener('change', (e) => {
      const card = e.target.closest('[data-vid]'); const k = e.target.dataset.k; if (!card || !k) return;
      const st = vState(card.dataset.vid);
      if (k === 'impl') { st.impl = e.target.checked; if (st.impl && st.status === 'new') st.status = 'todo'; }
      else if (k === 'prio') st.prio = Math.min(5, Math.max(1, parseInt(e.target.value, 10) || 3));
      else if (k === 'status' && STATUS_ORDER[e.target.value] != null) st.status = e.target.value;
      save(); renderVideos();
    });
    $('#videoGrid').addEventListener('click', (e) => {
      if (!e.target.closest('[data-vdel]')) return;
      const id = e.target.closest('[data-vid]')?.dataset.vid;
      if (!id || !confirm('Ta bort klippet?')) return;
      state.customVideos = state.customVideos.filter((v) => v.id !== id); delete state.videos[id]; save(); renderVideos();
    });
    $('#vChecklist').addEventListener('change', (e) => {
      const id = e.target.dataset.vdone; if (!id) return;
      vState(id).status = e.target.checked ? 'done' : 'todo'; save(); renderVideos();
    });
    $('#videoForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const url = safeUrl($('#vUrl').value.trim()); const note = $('#vNote').value.trim();
      if (!url) { toast('Länken måste börja med http(s)://'); return; }
      if (allVideos().some((v) => v.url === url)) { toast('Klippet finns redan'); return; }
      const id = 'own-' + uid();
      state.customVideos.push({ id, url, note: note.slice(0, 2000), created: new Date().toISOString() });
      state.videos[id] = { impl: false, prio: 3, status: 'new' };
      save(); e.target.reset(); renderVideos(); toast('Klipp tillagt');
    });

    // Marcs egna
    const ps = $('#personalSecs');
    ps.addEventListener('change', (e) => {
      const t = e.target;
      if (t.dataset.step) { state.personal.steps[t.dataset.step] = t.checked; save(); return; }
      const li = t.closest('[data-rid]'); const k = t.dataset.rk; if (!li || !k) return;
      const r = state.personal.rows.find((x) => x.id === li.dataset.rid); if (!r) return;
      if (k === 'done') r.status = t.checked ? 'done' : 'todo';
      else if (k === 'prio') r.prio = Math.min(5, Math.max(1, parseInt(t.value, 10) || 3));
      else if (k === 'status' && STATUS_ORDER[t.value] != null) r.status = t.value;
      save(); renderPersonal();
    });
    ps.addEventListener('click', (e) => {
      const add = e.target.closest('button[data-padd]');
      if (add) {
        const sec = add.dataset.sec; const m = ((PERS && PERS[sec]) || []).find((x) => String(x.id) === add.dataset.padd); if (!m) return;
        state.personal.rows.push({ id: uid(), sec, title: m.t.trim(), mwId: m.id, url: mwUrl(m), prio: 3, status: 'new', created: new Date().toISOString() });
        save(); renderPersonal(); toast('Tillagd i din lista'); return;
      }
      const del = e.target.closest('[data-rk="del"]');
      if (del) {
        const id = del.closest('[data-rid]')?.dataset.rid;
        if (id && confirm('Ta bort raden?')) { state.personal.rows = state.personal.rows.filter((x) => x.id !== id); save(); renderPersonal(); }
      }
    });
    ps.addEventListener('toggle', (e) => {
      const d = e.target.closest?.('details[data-psec]'); if (!d) return;
      state.ui.pOpen = { ...(state.ui.pOpen || {}), [d.dataset.psec]: d.open }; save();
    }, true);
    ps.addEventListener('submit', (e) => {
      const f = e.target.closest('form.paddform'); if (!f) return;
      e.preventDefault();
      const t = f.elements.t.value.trim(); if (!t) return;
      state.personal.rows.push({ id: uid(), sec: f.dataset.sec, title: t.slice(0, 200), prio: 3, status: 'new', created: new Date().toISOString() });
      save(); renderPersonal();
    });
    let nt;
    ps.addEventListener('input', (e) => {
      if (e.target.id !== 'handNotes') return;
      clearTimeout(nt); nt = setTimeout(() => { state.personal.notes = e.target.value; save(); }, 300);
    });

    $('#btnExport').addEventListener('click', exportJson);
    $('#fileImport').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) importJson(f); e.target.value = ''; });
  }

  async function init() {
    bind();
    await loadFavorites();
    await Promise.all([loadData(), seedInbox(), loadVideos(), loadPersonal()]);
    seedPersonal();
    setTab(state.ui.tab);
  }
  init().catch((e) => { console.error('Init misslyckades', e); toast('Något gick fel vid start'); });
})();
