/* Fliken "Filament i skrivaren": läser data/canvas.json (bild, datum, slotar). */
(function () {
  'use strict';
  const rader = document.getElementById('canvasRader');
  if (!rader) return;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  fetch('data/canvas.json', { cache: 'no-cache' }).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); }).then((d) => {
    document.querySelector('#canvasDatum strong').textContent = `Bild uppdaterad: ${d.bild_uppdaterad || 'okänt'}`;
    const img = document.getElementById('canvasBild');
    if (/^images\/[\w.-]+$/.test(d.bild || '')) img.src = `${d.bild}?d=${encodeURIComponent(d.bild_uppdaterad || '')}`;
    rader.innerHTML = (d.slots || []).map((s) => `<tr><td>${esc(s.slot)}</td><td><span class="jakt-dot" style="background:${/^#[0-9a-fA-F]{3,8}$/.test(s.hex) ? s.hex : '#ccc'}"></span>${esc(s.farg)}</td><td>${esc(s.typ)}</td><td>${esc(s.anm)}</td></tr>`).join('');
    document.getElementById('canvasNot').textContent = d.notering || '';
  }).catch((e) => { rader.innerHTML = `<tr><td colspan="4">Kunde inte läsa data/canvas.json (${esc(e.message)})</td></tr>`; });
})();
