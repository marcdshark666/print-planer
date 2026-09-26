#!/usr/bin/env node
/*
 * Hämtar og:title/og:description/og:image för Instagram-poster direkt från instagram.com
 * (Node, ingen webbläsare) och skriver en raw.json som tools/add-videos.js tar emot.
 *
 *   node tools/fetch-instagram.js <ut.json> <id|url> [<id|url> ...] [--alla]
 *
 * Id:n som redan finns i data/videos.json hoppas över (om inte --alla anges).
 * Bilden läses som JPEG och läggs som base64 i fältet b64.
 * Utskriften innehåller aldrig bildadresser (de bär signerade querystrings).
 * Svenska fält (titel_sv, handlar_om, forslag, tag, reklam) fylls i efteråt i ut.json.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data', 'videos.json');
const ID_RE = /^[A-Za-z0-9_-]{5,40}$/;
// curl-liknande UA: Instagram serverar og-taggar till enkla klienter, inte till en webbläsar-UA.
const UA = 'curl/8.9.1';

function idOf(s) {
  const m = /instagram\.com\/(?:[^/]+\/)?(?:reel|reels|p)\/([A-Za-z0-9_-]+)/.exec(String(s));
  if (m) return m[1];
  return ID_RE.test(String(s)) ? String(s) : '';
}
function decode(s) {
  return String(s)
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}
function og(html, prop) {
  const m = new RegExp(`<meta[^>]+property="og:${prop}"[^>]+content="([^"]*)"`, 'i').exec(html)
    || new RegExp(`<meta[^>]+content="([^"]*)"[^>]+property="og:${prop}"`, 'i').exec(html);
  return m ? decode(m[1]) : '';
}

async function hamta(id) {
  const url = `https://www.instagram.com/reel/${id}/`;
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' }, redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  const title = og(html, 'title'); const desc = og(html, 'description'); const img = og(html, 'image');
  if (!title && !desc) throw new Error('inga og-taggar (inloggningsvägg eller borttagen post)');
  let b64 = '';
  if (img) {
    const r2 = await fetch(img, { headers: { 'User-Agent': UA } });
    if (r2.ok) {
      const buf = Buffer.from(await r2.arrayBuffer());
      if (buf[0] === 0xff && buf[1] === 0xd8) b64 = buf.toString('base64');
    }
  }
  return { id, url, title, desc, b64 };
}

async function main() {
  const args = process.argv.slice(2);
  const alla = args.includes('--alla');
  const [ut, ...rest] = args.filter((a) => !a.startsWith('--'));
  if (!ut || !rest.length) { console.error('användning: node tools/fetch-instagram.js <ut.json> <id|url> ... [--alla]'); process.exit(1); }
  let finns = new Set();
  try { finns = new Set(JSON.parse(fs.readFileSync(DATA, 'utf8')).map((v) => v.id)); } catch { /* ingen data än */ }
  const ids = [...new Set(rest.map(idOf).filter(Boolean))];
  const nya = alla ? ids : ids.filter((i) => !finns.has(i));
  const out = []; const fel = [];
  for (const id of nya) {
    try { const r = await hamta(id); out.push(r); console.log(`${id}: ok (bild ${r.b64 ? Math.round(r.b64.length * 0.75 / 1024) + ' kB' : 'saknas'}) — ${r.title.slice(0, 80).replace(/\s+/g, ' ')}`); }
    catch (e) { fel.push(id); console.log(`${id}: FEL ${e.message}`); }
  }
  fs.writeFileSync(path.resolve(ut), JSON.stringify(out, null, 1) + '\n', 'utf8');
  console.log(`Hämtade ${out.length} av ${nya.length} nya (${ids.length - nya.length} fanns redan)${fel.length ? `, fel: ${fel.join(', ')}` : ''}. Skrev ${ut}.`);
  if (fel.length && !out.length) process.exitCode = 1;
}

main().catch((e) => { console.error(`fetch-instagram: ${e.stack || e.message}`); process.exit(1); });
