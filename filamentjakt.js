/* Filamentjakt-fliken: läser data/filament.json och ritar ett kort per filament. */
(function () {
  'use strict';
  const root = document.getElementById('jaktList');
  if (!root) return;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const safeUrl = (u) => (/^https:\/\//.test(u || '') ? u : '#');
  const ytId = (s) => (/^[A-Za-z0-9_-]{11}$/.test(s || '') ? s : '');

  function card(f) {
    const p = f.pris || {}, l = p.lagsta || {}, v = f.video, o = f.printat_objekt;
    const butiker = (p.butiker || []).map((b) => `<tr><td><a href="${esc(safeUrl(b.url))}" target="_blank" rel="noopener noreferrer">${esc(b.butik)}</a>${b.anm ? `<br><span class="muted">${esc(b.anm)}</span>` : ''}</td><td>${esc(b.pris)}</td><td>${esc(b.frakt)}</td><td>${esc(b.lager)}</td><td>${esc(b.kollat)}</td></tr>`).join('');
    const incl = p.lagsta_inkl_frakt_sek;
    return `<article class="panel jakt-card">
      <div class="jakt-head">
        ${f.bild ? `<img class="jakt-img" src="${esc(f.bild)}" alt="${esc(f.namn)}" loading="lazy" width="140" height="140">` : ''}
        <div>
          <h3>${esc(f.namn)}</h3>
          <p class="muted"><span class="jakt-dot" style="background:${esc(f.farg_hex || '#ccc')}"></span>${esc(f.material)} · ${esc(f.farg)}</p>
          <p class="jakt-price"><strong>${esc(l.belopp)} ${esc(l.valuta)}</strong>${l.sek_ca ? ` (ca ${esc(l.sek_ca)} kr)` : ''} hos <a href="${esc(safeUrl(l.url))}" target="_blank" rel="noopener noreferrer">${esc(l.butik)}</a></p>
          <p class="muted">Pris kollat ${esc(l.kollat)}. ${esc(l.anm)}</p>
          ${incl ? `<p class="muted">Lägst inkl. frakt (SE): ${esc(incl.belopp)} kr hos ${esc(incl.butik)} – ${esc(incl.anm)}</p>` : ''}
        </div>
      </div>
      ${f.produktlank ? `<p class="jakt-link"><a class="btn primary" href="${esc(safeUrl(f.produktlank.url))}" target="_blank" rel="noopener noreferrer">Öppna i butiken</a> <a href="${esc(safeUrl(f.produktlank.url))}" target="_blank" rel="noopener noreferrer">${esc(f.produktlank.butik)} – ${esc(f.produktlank.url)}</a></p><p class="muted">${esc(f.produktlank.anm)}</p>` : ''}
      ${f.notering ? `<p class="muted">${esc(f.notering)}</p>` : ''}
      <div class="jakt-media">
        <figure class="jakt-fig">
          ${o && o.bild ? `<img src="${esc(o.bild)}" alt="Printat objekt i ${esc(f.namn)}" loading="lazy"><figcaption class="muted">${esc(o.text)} Källa: <a href="${esc(safeUrl(o.kalla_url))}" target="_blank" rel="noopener noreferrer">${esc(o.kalla)}</a></figcaption>` : '<p class="empty">Ingen bild på printat objekt hittad ännu.</p>'}
        </figure>
        <div class="jakt-vid">
          ${v && ytId(v.youtube_id) ? `<iframe src="https://www.youtube-nocookie.com/embed/${ytId(v.youtube_id)}" title="${esc(v.titel)}" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe><p class="muted">${esc(v.titel)} – ${esc(v.kanal)}. ${esc(v.anm)}</p>` : '<p class="empty">Ingen video hittad ännu.</p>'}
        </div>
      </div>
      ${butiker ? `<details><summary>Prisjämförelse (${(p.butiker || []).length} butiker)</summary><div class="jakt-tbl"><table><thead><tr><th>Butik</th><th>Pris</th><th>Frakt</th><th>Lager</th><th>Kollat</th></tr></thead><tbody>${butiker}</tbody></table></div>${p.multipack ? `<p class="muted"><strong>Multipack:</strong> ${esc(p.multipack)}</p>` : ''}</details>` : ''}
      <p class="muted">Bildkälla: ${esc(f.bild_kalla)}</p>
    </article>`;
  }

  // Sektioner (underflikar). Poster utan "sektioner" hör till Allmänt (lagret/prisjakt).
  const TABS = [
    { id: 'allmant', namn: 'Allmänt' },
    { id: 'duo-tri', namn: 'Duo- och tri-color' },
    { id: 'silk', namn: 'Silk' },
    { id: 'karaktar', namn: 'Printa karaktärer' }
  ];
  const GRUPPER = ['hud', 'har', 'klader', 'ogon'];
  const fmtPris = (p) => (p && p.belopp ? `${String(p.belopp).replace('.', ',')} kr` : 'pris oläsbart');
  function swatch(f) {
    const h = (f.farg_hexar && f.farg_hexar.length ? f.farg_hexar : [f.farg_hex || '#ccc']).filter((x) => /^#[0-9a-fA-F]{3,8}$/.test(x));
    const bg = h.length > 1 ? `linear-gradient(90deg,${h.map((c, i) => `${c} ${Math.round(i * 100 / h.length)}% ${Math.round((i + 1) * 100 / h.length)}%`).join(',')})` : (h[0] || '#ccc');
    return `<span class="jakt-swatch" style="background:${bg}" title="Färgprov (ungefärligt)"></span>`;
  }
  function amazonCard(f) {
    const l = (f.pris && f.pris.lagsta) || {};
    const url = f.produktlank && f.produktlank.url;
    return `<article class="panel jakt-card jakt-az">
      <div class="jakt-head">
        ${f.bild ? `<img class="jakt-img" src="${esc(f.bild)}" alt="${esc(f.namn)}" loading="lazy" width="140" height="140">` : swatch(f)}
        <div>
          <h3>${esc(f.namn)}</h3>
          <p class="muted">${swatch(f)} ${esc(f.kombo || f.farg)} · ${esc(f.material)}${f.vikt ? ` · ${esc(f.vikt)}` : ''}</p>
          <p class="jakt-price"><strong>${esc(fmtPris(l))}</strong> <span class="muted">${l.belopp ? `Amazon.se ${esc(l.kollat)}, kan ändras` : ''}</span></p>
          ${f.notering ? `<p class="muted">${esc(f.notering)}</p>` : ''}
        </div>
      </div>
      <p class="jakt-link"><a class="btn primary" href="${esc(safeUrl(url))}" target="_blank" rel="noopener noreferrer">Öppna på Amazon.se</a> <span class="muted">${esc(url)}</span></p>
      ${f.bild ? `<p class="muted jakt-src">Bildkälla: ${esc(f.bild_kalla)}</p>` : ''}
    </article>`;
  }
  const inSek = (f, id) => (f.sektioner || []).includes(id);

  function renderTab(d, id) {
    const all = d.filament || [];
    const intro = (d.sektioner_info || {})[id];
    const introHtml = intro ? `<div class="panel"><h3>${esc(intro.titel)}</h3><p>${esc(intro.text)}</p>${intro.antal ? `<p class="muted">${esc(intro.antal)}</p>` : ''}</div>` : '';
    if (id === 'allmant') {
      return `<p class="muted">Priser senast uppdaterade ${esc(d.uppdaterad)}. ${esc(d.valutakurs_anm)}</p>` + all.filter((f) => !(f.sektioner || []).length).map(card).join('');
    }
    if (id === 'karaktar') {
      const gi = d.karaktar_info || {};
      return introHtml + GRUPPER.map((g) => {
        const items = all.filter((f) => inSek(f, 'karaktar') && (f.grupper || []).includes(g));
        const info = gi[g] || {};
        return `<section class="jakt-grupp"><h3>${esc(info.titel || g)} <span class="muted">(${items.length})</span></h3><p class="muted">${esc(info.text)}</p><div class="jakt-grid">${items.map(amazonCard).join('') || '<p class="empty">Inga hittade.</p>'}</div></section>`;
      }).join('');
    }
    const items = all.filter((f) => inSek(f, id));
    return introHtml + `<div class="jakt-grid">${items.map(amazonCard).join('') || '<p class="empty">Inga hittade.</p>'}</div>`;
  }

  async function load() {
    try {
      const r = await fetch('data/filament.json', { cache: 'no-cache' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      let cur = 'allmant';
      try { cur = sessionStorage.getItem('jaktTab') || cur; } catch { /* privat läge */ }
      if (!TABS.some((t) => t.id === cur)) cur = 'allmant';
      const bar = document.createElement('div');
      bar.className = 'jakt-subtabs';
      bar.setAttribute('role', 'tablist');
      root.parentNode.insertBefore(bar, root);
      const count = (id) => (d.filament || []).filter((f) => (id === 'allmant' ? !(f.sektioner || []).length : inSek(f, id))).length;
      const draw = () => {
        bar.innerHTML = TABS.map((t) => `<button type="button" role="tab" data-sub="${t.id}" aria-selected="${t.id === cur}">${esc(t.namn)} (${count(t.id)})</button>`).join('');
        root.innerHTML = renderTab(d, cur);
      };
      bar.addEventListener('click', (e) => {
        const b = e.target.closest('button[data-sub]');
        if (!b) return;
        cur = b.dataset.sub;
        try { sessionStorage.setItem('jaktTab', cur); } catch { /* ignoreras */ }
        draw();
      });
      draw();
    } catch (e) {
      root.innerHTML = `<div class="warn bad">Kunde inte läsa data/filament.json (${esc(e.message)}). Öppna via webbserver.</div>`;
    }
  }
  load();
})();
