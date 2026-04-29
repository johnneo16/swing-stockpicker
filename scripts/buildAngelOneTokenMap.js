/**
 * One-shot setup script: downloads Angel One's full instrument master
 * and writes a JSON file mapping every NSE equity symbol → token.
 *
 * Run once after expanding the universe:
 *   node scripts/buildAngelOneTokenMap.js
 *
 * Output: data/angelone-tokens.json
 */

import 'dotenv/config';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import STOCK_UNIVERSE_EXTENDED from '../src/engine/stockUniverseExtended.js';
import ETF_UNIVERSE from '../src/engine/etfUniverse.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const OUT_PATH = path.join(PROJECT_ROOT, 'data', 'angelone-tokens.json');

const MASTER_URL = 'https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json';

async function main() {
  console.log('📥 Downloading Angel One scrip master (~10 MB)...');
  const t0 = Date.now();
  const { data } = await axios.get(MASTER_URL, { responseType: 'json' });
  console.log(`   ✓ Got ${data.length} instruments in ${Date.now() - t0}ms`);

  // Build NSE-EQ symbol → token map
  // Angel One: name = base symbol (e.g. "RELIANCE"), symbol = "RELIANCE-EQ", exch_seg = "NSE"
  const tokenMap = {};
  for (const inst of data) {
    if (inst.exch_seg !== 'NSE') continue;
    if (!inst.symbol?.endsWith('-EQ')) continue;
    const base = inst.name; // base symbol, e.g. "RELIANCE"
    if (base && inst.token) {
      tokenMap[base] = inst.token;
    }
  }
  console.log(`   ✓ Indexed ${Object.keys(tokenMap).length} NSE equity symbols`);

  // Resolve our universe + ETFs
  const universeSymbols = [
    ...STOCK_UNIVERSE_EXTENDED.map(s => s.symbol),
    ...ETF_UNIVERSE.map(s => s.symbol),
  ];

  const resolved = {};
  const missing = [];

  for (const sym of universeSymbols) {
    if (tokenMap[sym]) {
      resolved[sym] = tokenMap[sym];
    } else {
      // Try alternate forms — Angel One sometimes uses different names
      const alternates = [
        sym.replace('-', ''),                          // BAJAJ-AUTO → BAJAJAUTO
        sym.replace('&', 'AND'),                       // M&M → MANDM
        sym.replace('M&M', 'MAHINDRA'),                // M&M → MAHINDRA
      ];
      let found = null;
      for (const alt of alternates) {
        if (tokenMap[alt]) { found = tokenMap[alt]; break; }
      }
      if (found) resolved[sym] = found;
      else       missing.push(sym);
    }
  }

  console.log(`\n✅ Resolved: ${Object.keys(resolved).length}/${universeSymbols.length}`);
  if (missing.length > 0) {
    console.log(`⚠ Missing  (${missing.length}): ${missing.join(', ')}`);
  }

  fs.writeFileSync(OUT_PATH, JSON.stringify({
    generatedAt: new Date().toISOString(),
    totalUniverse: universeSymbols.length,
    resolved: Object.keys(resolved).length,
    missing,
    tokens: resolved,
  }, null, 2));

  console.log(`\n💾 Wrote ${OUT_PATH}`);
}

main().catch(err => {
  console.error('❌ Failed:', err.message);
  process.exit(1);
});
