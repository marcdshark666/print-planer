#!/usr/bin/env node
// Lägg till filament från en produkt-URL i data/filament.json.
//   node tools/add-filament.mjs <produkt-url> [--material PLA] [--farg Vit] [--hex #ffffff] [--dry-run]
// Läser titel, og:image och pris (og/JSON-LD) ur sidan, laddar ner bilden (max 600 px, kräver python+Pillow)
// och lägger posten sist. Köper aldrig något, ingen inloggning. Fyll i printat objekt/video/butiker för hand i JSON-filen.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data', 'filament.json');
const args = process.argv.slice(2);
const url = args.find((a) => /^https?:\/\//.test(a));
const opt = (n, d = '') => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const dry = args.includes('--dry-run');
if (!url) { console.error('Ange en http(s)-URL.'); process.exit(1); }

const slug = (s) => s.toLowerCase().normalize('NFD').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
const meta = (h, k) => {
  const m = new RegExp(`<meta[^>]+(?:property|name)=["']${k}["'][^>]*content=["']([^"']*)["']`, 'i').exec(h)
    || new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${k}["']`, 'i').exec(h);
  return m ? m[1].replace(/&amp;/g, '&') : '';
};

try {
  const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 print-planer' }, redirect: 'follow' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const h = await r.text();
  const titel = meta(h, 'og:title') || (/<title>([^<]*)/i.exec(h) || [])[1] || url;
  let img = meta(h, 'og:image');
  if (img.startsWith('//')) img = 'https:' + img;
  if (img) img = new URL(img, url).href;
  let belopp = Number(meta(h, 'product:price:amount') || meta(h, 'og:price:amount')) || 0;
  let valuta = meta(h, 'product:price:currency') || meta(h, 'og:price:currency');
  if (!belopp) {
    for (const m of h.matchAll(/<script[^>]+ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
      try {
        const walk = (o) => {
          if (!o || typeof o !== 'object') return;
          if (o.price && !belopp) { belopp = Number(o.price); valuta = o.priceCurrency || valuta; }
          Object.values(o).forEach(walk);
        };
        walk(JSON.parse(m[1]));
      } catch { /* ogiltig JSON-LD, hoppa */ }
    }
  }
  const id = slug(titel);
  const db = JSON.parse(fs.readFileSync(DATA, 'utf8'));
  if (db.filament.some((f) => f.id === id)) throw new Error(`Finns redan: ${id}`);
  let bild = '';
  if (img && !dry) {
    const dir = path.join(ROOT, 'images', 'filament');
    fs.mkdirSync(dir, { recursive: true });
    const tmp = path.join(dir, `_${id}.tmp`);
    const out = path.join(dir, `${id}.jpg`);
    fs.writeFileSync(tmp, Buffer.from(await (await fetch(img)).arrayBuffer()));
    execFileSync('python', ['-c', 'import sys;from PIL import Image;i=Image.open(sys.argv[1]).convert("RGB");i.thumbnail((600,600));i.save(sys.argv[2],quality=78,optimize=True)', tmp, out]);
    fs.unlinkSync(tmp);
    bild = `images/filament/${id}.jpg`;
  }
  const host = new URL(url).hostname.replace(/^www\./, '');
  const idag = new Date().toISOString().slice(0, 10);
  const post = {
    id, namn: titel.trim(), material: opt('material', 'PLA'), farg: opt('farg', ''), farg_hex: opt('hex', '#cccccc'),
    notering: '', bild, bild_kalla: `Produktbild från ${host}, nedskalad`,
    pris: {
      lagsta: { belopp, valuta: valuta || '', sek_ca: null, butik: host, url, kollat: idag, anm: belopp ? '' : 'Pris hittades inte automatiskt - fyll i för hand' },
      butiker: [], multipack: ''
    },
    printat_objekt: null, video: null
  };
  if (dry) { console.log(JSON.stringify(post, null, 1)); process.exit(0); }
  db.filament.push(post);
  db.uppdaterad = idag;
  fs.writeFileSync(DATA, JSON.stringify(db, null, 1) + '\n');
  console.log(`Lade till ${id} (${belopp || 'inget pris'} ${valuta})`);
} catch (e) {
  console.error('add-filament:', e.message);
  process.exit(1);
}
