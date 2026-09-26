#!/usr/bin/env node
/*
 * Slår ihop nya Instagram-poster i data/videos.json + images/videos/<id>.jpg.
 *
 *   node tools/add-videos.js <raw.json> [--dry-run]
 *
 * raw.json = [{ id, url, title, desc, b64 }]  (b64 = data:image/jpeg;base64,… eller ren base64)
 * Valfria fält per post (skrivs rakt in om de finns): titel_sv, handlar_om, forslag, tag, reklam, creator, anteckning.
 * Saknas svensk text sätts needs_review: true och originalbeskrivningen läggs i handlar_om – skriv om den för hand.
 * Dubbletter (samma id eller url) hoppas över; befintliga poster ändras aldrig.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data', 'videos.json');
const IMG_DIR = path.join(ROOT, 'images', 'videos');
const ID_RE = /^[A-Za-z0-9_-]{5,40}$/;

function fail(msg) { console.error(`add-videos: ${msg}`); process.exit(1); }

function idFromUrl(u) {
  const m = /instagram\.com\/(?:[^/]+\/)?(?:reel|reels|p)\/([A-Za-z0-9_-]+)/.exec(String(u || ''));
  return m ? m[1] : '';
}
function normUrl(u) {
  try {
    const x = new URL(String(u));
    if (!/^https?:$/.test(x.protocol) || !/(^|\.)instagram\.com$/.test(x.hostname)) return '';
    return `https://www.instagram.com${x.pathname.endsWith('/') ? x.pathname : x.pathname + '/'}`;
  } catch { return ''; }
}
function creatorFrom(title, desc) {
  const d = /comments? - ([A-Za-z0-9._]+) on /.exec(String(desc || ''));
  if (d) return '@' + d[1];
  const t = /^(.*?) on Instagram/.exec(String(title || ''));
  return t ? t[1].trim() : '';
}
function captionFrom(desc) {
  const m = /on [A-Z][a-z]+ \d{1,2}, \d{4}: "([\s\S]*)/.exec(String(desc || ''));
  return (m ? m[1] : String(desc || '')).replace(/"\.?\s*$/, '').trim();
}
function titleFrom(title) {
  const m = /on Instagram: "([\s\S]*)/.exec(String(title || ''));
  return (m ? m[1] : String(title || '')).replace(/"\s*$/, '').split('\n')[0].trim().slice(0, 90);
}

function main() {
  const args = process.argv.slice(2);
  const dry = args.includes('--dry-run');
  const file = args.find((a) => !a.startsWith('--'));
  if (!file) fail('användning: node tools/add-videos.js <raw.json> [--dry-run]');

  let raw;
  try { raw = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8')); } catch (e) { fail(`kunde inte läsa ${file}: ${e.message}`); }
  if (!Array.isArray(raw)) fail('raw.json måste vara en lista');

  let videos = [];
  try { videos = JSON.parse(fs.readFileSync(DATA, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') fail(`kunde inte läsa videos.json: ${e.message}`); }
  if (!Array.isArray(videos)) fail('data/videos.json är inte en lista');

  const seenIds = new Set(videos.map((v) => v.id));
  const seenUrls = new Set(videos.map((v) => normUrl(v.url)).filter(Boolean));
  const added = []; const skipped = [];

  for (const r of raw) {
    if (!r || typeof r !== 'object') { skipped.push('(ogiltig post)'); continue; }
    const url = normUrl(r.url);
    const id = String(r.id || idFromUrl(url));
    if (!url || !ID_RE.test(id)) { skipped.push(`${r.id || r.url || '?'}: saknar giltigt id/url`); continue; }
    if (seenIds.has(id) || seenUrls.has(url)) { skipped.push(`${id}: finns redan`); continue; }

    let thumb = '';
    if (r.b64) {
      const b64 = String(r.b64).replace(/^data:image\/[a-z]+;base64,/i, '');
      const buf = Buffer.from(b64, 'base64');
      if (buf.length > 100 && buf[0] === 0xff && buf[1] === 0xd8) {
        thumb = `images/videos/${id}.jpg`;
        if (!dry) { fs.mkdirSync(IMG_DIR, { recursive: true }); fs.writeFileSync(path.join(ROOT, thumb), buf); }
      } else {
        console.warn(`add-videos: ${id}: b64 är inte en JPEG – ingen bild sparad`);
      }
    }
    const caption = captionFrom(r.desc);
    const hasSv = Boolean(r.titel_sv && r.handlar_om);
    const entry = {
      id, url,
      creator: String(r.creator || creatorFrom(r.title, r.desc)),
      thumb,
      titel_sv: String(r.titel_sv || titleFrom(r.title) || id),
      handlar_om: String(r.handlar_om || (caption ? `(Originaltext, ej sammanfattad) ${caption.slice(0, 400)}` : 'Ingen beskrivning – titta på klippet.')),
      forslag: String(r.forslag || ''),
      tag: String(r.tag || ''),
      reklam: typeof r.reklam === 'boolean' ? r.reklam : /#(ad|adv|annons|reklam|sponsored)\b/i.test(String(r.desc || '')),
      anteckning: String(r.anteckning || ''),
    };
    if (!hasSv) entry.needs_review = true;
    videos.push(entry); seenIds.add(id); seenUrls.add(url); added.push(id);
  }

  if (!dry && added.length) {
    const tmp = DATA + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(videos, null, 1) + '\n', 'utf8');
    fs.renameSync(tmp, DATA);
  }
  console.log(`${dry ? '[dry-run] ' : ''}Tillagda: ${added.length}${added.length ? ` (${added.join(', ')})` : ''}. Hoppade över: ${skipped.length}. Totalt: ${videos.length}.`);
  for (const s of skipped) console.log(`  – ${s}`);
  if (added.length && videos.some((v) => v.needs_review)) console.log('Obs: poster med needs_review saknar svensk sammanfattning/förslag – skriv dem i data/videos.json.');
}

try { main(); } catch (e) { fail(e.stack || e.message); }
