#!/usr/bin/env node
// Läser publik produktsida på Amazon.se (ingen inloggning) och skriver titel, pris, vikt, bild-URL som JSON.
//   node tools/amazon-probe.mjs B0BHVCMHWP B0CD77VHBZ ...   (skriver ut JSON-lista)
// Amazon kan svara med captcha/503: då ges fel i posten, inget hittas på.
import { execFileSync } from 'node:child_process';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const dec = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
export async function probe(asin) {
  if (!/^B[0-9A-Z]{9}$/.test(asin)) return { asin, fel: 'ogiltigt ASIN' };
  try {
    // curl (Windows 10+/Git) ger sidan där Nodes fetch får en 4 kB-spärrsida; vanlig GET, ingen inloggning.
    const h = execFileSync('curl', ['-sL', '--max-time', '40', '-A', UA, '-H', 'Accept-Language: sv-SE,sv;q=0.9', `https://www.amazon.se/dp/${asin}`], { encoding: 'utf8', maxBuffer: 30e6 });
    if (h.length < 50000) return { asin, fel: `${h.length} byte (spärrsida/blockerad?)` };
    const t = /id="productTitle"[^>]*>\s*([^<]+)/.exec(h);
    if (!t) return { asin, fel: 'ingen produkttitel (captcha/annan sida?)' };
    const img = /"hiRes":"([^"]+)"/.exec(h) || /"large":"([^"]+)"/.exec(h);
    const core = h.indexOf('corePrice');
    const pm = /a-offscreen">\s*([\d\s.,\u00a0]+)\s*(?:kr|SEK)/.exec(core >= 0 ? h.slice(core) : h);
    const vm = /(?:Artikelvikt|Vikt|Item Weight)[^<]*<\/[^>]+>\s*<[^>]+>\s*([^<]+)/.exec(h);
    const brand = /id="bylineInfo"[^>]*>([^<]+)/.exec(h);
    return { asin, titel: dec(t[1]), pris_sek: pm ? Number(pm[1].replace(/[\s\u00a0.]/g, '').replace(',', '.')) : null, vikt: vm ? dec(vm[1]) : null, varumarke: brand ? dec(brand[1]) : null, bild: img ? img[1] : null };
  } catch (e) { return { asin, fel: e.message }; }
}
if ((process.argv[1] || '').endsWith('amazon-probe.mjs')) {
  const out = [];
  for (const a of process.argv.slice(2)) { out.push(await probe(a)); await new Promise((r) => setTimeout(r, 4000)); }
  console.log(JSON.stringify(out, null, 1));
}
