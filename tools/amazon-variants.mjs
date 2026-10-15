#!/usr/bin/env node
// Listar färgvarianter (ASIN -> etikett) för en Amazon.se-produktsida: node tools/amazon-variants.mjs <ASIN>
import { execFileSync } from 'node:child_process';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const asin = process.argv[2];
if (!/^B[0-9A-Z]{9}$/.test(asin || '')) { console.error('Ange ett ASIN'); process.exit(1); }
const h = execFileSync('curl', ['-sL', '--max-time', '40', '-A', UA, '-H', 'Accept-Language: sv-SE,sv;q=0.9', `https://www.amazon.se/dp/${asin}`], { encoding: 'utf8', maxBuffer: 30e6 });
const m = /"dimensionValuesDisplayData"\s*:\s*(\{.*?\})\s*,\s*"/s.exec(h);
console.log(m ? JSON.stringify(JSON.parse(m[1]), null, 0) : `inga varianter (${h.length} byte)`);
