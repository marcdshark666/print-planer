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

  async function load() {
    try {
      const r = await fetch('data/filament.json', { cache: 'no-cache' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      root.innerHTML = `<p class="muted">Priser senast uppdaterade ${esc(d.uppdaterad)}. ${esc(d.valutakurs_anm)}</p>` + (d.filament || []).map(card).join('');
    } catch (e) {
      root.innerHTML = `<div class="warn bad">Kunde inte läsa data/filament.json (${esc(e.message)}). Öppna via webbserver.</div>`;
    }
  }
  load();
})();
