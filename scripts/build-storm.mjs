// Builds src/data/generated/yagi.json from the IBTrACS CSV (SPEC.md section 3.1).
// Node built-ins only. Deterministic: same input gives the same bytes.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const webDir = resolve(here, '..');
const csvPath = resolve(webDir, '../experiments/d1_track/work/ibtracs_last3years.csv');
const outPath = resolve(webDir, 'src/data/generated/yagi.json');

// RFC 4180 CSV parser: quoted fields, escaped quotes, CRLF or LF.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  if (text.charCodeAt(0) === 0xfeff) i = 1;
  for (; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

function num(s) {
  if (s === undefined) return null;
  const t = s.trim();
  if (t === '') return null;
  const n = Number(t);
  if (!Number.isFinite(n)) throw new Error(`Not a number: ${JSON.stringify(s)}`);
  return n;
}

function isoTime(s) {
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})$/.exec(s.trim());
  if (!m) throw new Error(`Bad ISO_TIME: ${JSON.stringify(s)}`);
  return `${m[1]}T${m[2]}Z`;
}

const rows = parseCsv(readFileSync(csvPath, 'utf8'));
const header = rows[0].map((h) => h.trim());
const col = (name) => {
  const idx = header.indexOf(name);
  if (idx < 0) throw new Error(`Missing column ${name}`);
  return idx;
};
const C = {
  SEASON: col('SEASON'), NAME: col('NAME'), ISO_TIME: col('ISO_TIME'),
  LAT: col('LAT'), LON: col('LON'), USA_WIND: col('USA_WIND'),
  NE: col('USA_R34_NE'), SE: col('USA_R34_SE'), SW: col('USA_R34_SW'), NW: col('USA_R34_NW'),
};
col('SID');

// rows[1] is the units row.
const points = rows.slice(2)
  .filter((r) => r.length > 1 && (r[C.NAME] ?? '').trim() === 'YAGI' && num(r[C.SEASON]) === 2024)
  .map((r) => ({
    t: isoTime(r[C.ISO_TIME]),
    lat: num(r[C.LAT]),
    lon: num(r[C.LON]),
    windKt: num(r[C.USA_WIND]),
    r34nm: { ne: num(r[C.NE]), se: num(r[C.SE]), sw: num(r[C.SW]), nw: num(r[C.NW]) },
  }))
  .sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));

const out = { name: 'Yagi', season: 2024, source: 'IBTrACS v04r01', points };
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n');
console.log(`Wrote ${points.length} points to ${outPath}`);
