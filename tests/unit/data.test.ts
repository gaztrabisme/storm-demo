// Locked acceptance tests: SPEC section 3 (storm track and provinces data files).
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const read = (rel: string) => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'));

describe('src/data/generated/yagi.json', () => {
  const y = read('../../src/data/generated/yagi.json');

  it('is Yagi, season 2024, with 81 points', () => {
    expect(y.name).toBe('Yagi');
    expect(y.season).toBe(2024);
    expect(y.points.length).toBe(81);
  });

  it('names its source "IBTrACS v04r01"', () => {
    expect(y.source).toBe('IBTrACS v04r01');
  });

  it('runs from 2024-08-30 12:00 to 2024-09-09 12:00 UTC', () => {
    expect(Date.parse(y.points[0].t)).toBe(Date.parse('2024-08-30T12:00:00Z'));
    expect(Date.parse(y.points[y.points.length - 1].t)).toBe(Date.parse('2024-09-09T12:00:00Z'));
  });

  it('every time is UTC: an ISO time ending in Z or an explicit offset (SPEC 3.1 "Data times are UTC")', () => {
    const bad = y.points.map((p: { t: string }) => p.t).filter((t: unknown) => typeof t !== 'string' || !/Z$|[+-]\d{2}:\d{2}$/.test(t));
    expect(bad).toEqual([]);
  });

  it('times are strictly increasing', () => {
    const ts = y.points.map((p: { t: string }) => Date.parse(p.t));
    expect(ts.every((t: number) => Number.isFinite(t))).toBe(true);
    for (let i = 1; i < ts.length; i++) expect(ts[i], `point ${i}`).toBeGreaterThan(ts[i - 1]);
  });

  it('points are exactly 3 hours apart', () => {
    const ts = y.points.map((p: { t: string }) => Date.parse(p.t));
    for (let i = 1; i < ts.length; i++) expect(ts[i] - ts[i - 1], `point ${i}`).toBe(3 * 3600 * 1000);
  });

  it('every point has lat, lon, windKt (number or null) and four r34nm quadrants (number or null)', () => {
    for (const p of y.points) {
      expect(typeof p.lat).toBe('number');
      expect(typeof p.lon).toBe('number');
      expect(p.windKt === null || typeof p.windKt === 'number').toBe(true);
      for (const q of ['ne', 'se', 'sw', 'nw']) expect(p.r34nm[q] === null || typeof p.r34nm[q] === 'number').toBe(true);
    }
  });
});

// SPEC 3.1 field mapping, checked against the CSV itself (the tests' own parser).
const CSV = new URL('../../../experiments/d1_track/work/ibtracs_last3years.csv', import.meta.url);
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let f = '';
  let q = false;
  for (let i = text.charCodeAt(0) === 0xfeff ? 1 : 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') (f += '"'), i++;
      else if (c === '"') q = false;
      else f += c;
    } else if (c === '"') q = true;
    else if (c === ',') row.push(f), (f = '');
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(f), rows.push(row), (row = []), (f = '');
    } else f += c;
  }
  if (f !== '' || row.length) row.push(f), rows.push(row);
  return rows;
}
const cell = (s: string | undefined) => (s === undefined || s.trim() === '' ? null : Number(s.trim()));

describe('yagi.json matches the IBTrACS CSV (SPEC 3.1)', () => {
  const y = read('../../src/data/generated/yagi.json');
  const rows = parseCsv(readFileSync(CSV, 'utf8'));
  const h = rows[0].map((x) => x.trim());
  const c = (n: string) => h.indexOf(n);
  const want = rows
    .slice(2)
    .filter((r) => (r[c('NAME')] ?? '').trim() === 'YAGI' && (r[c('SEASON')] ?? '').trim() === '2024')
    .map((r) => ({
      t: Date.parse(r[c('ISO_TIME')].trim().replace(' ', 'T') + 'Z'),
      lat: cell(r[c('LAT')]),
      lon: cell(r[c('LON')]),
      windKt: cell(r[c('USA_WIND')]),
      r34nm: { ne: cell(r[c('USA_R34_NE')]), se: cell(r[c('USA_R34_SE')]), sw: cell(r[c('USA_R34_SW')]), nw: cell(r[c('USA_R34_NW')]) },
    }))
    .sort((a, b) => a.t - b.t);

  it('the CSV has the 81 Yagi 2024 rows', () => {
    expect(want.length).toBe(81);
  });

  it('every point has the CSV time, LAT, LON, USA_WIND and USA_R34_NE/SE/SW/NW (blank -> null)', () => {
    expect(y.points.length).toBe(want.length);
    want.forEach((w, i) => {
      const p = y.points[i];
      expect(Date.parse(p.t), `point ${i} t`).toBe(w.t);
      expect({ lat: p.lat, lon: p.lon, windKt: p.windKt, r34nm: p.r34nm }, `point ${i} (${p.t})`).toEqual({ lat: w.lat, lon: w.lon, windKt: w.windKt, r34nm: w.r34nm });
    });
  });

  it('2024-09-05 00:00 UTC is lat 19.0, lon 115.8, 130 kt, r34 140/130/115/120 nm', () => {
    const p = y.points.find((x: { t: string }) => Date.parse(x.t) === Date.parse('2024-09-05T00:00:00Z'));
    expect(p).toBeDefined();
    expect(p.lat).toBe(19.0);
    expect(p.lon).toBe(115.8);
    expect(p.windKt).toBe(130);
    expect(p.r34nm).toEqual({ ne: 140, se: 130, sw: 115, nw: 120 });
  });

  it('blank values in the CSV become null (the last point has no wind and no radii)', () => {
    const last = y.points[y.points.length - 1];
    expect(last.windKt).toBeNull();
    expect(last.r34nm).toEqual({ ne: null, se: null, sw: null, nw: null });
  });
});

describe('scripts/build-storm.mjs is deterministic (SPEC 3.1)', () => {
  const out = new URL('../../src/data/generated/yagi.json', import.meta.url);
  const script = fileURLToPath(new URL('../../scripts/build-storm.mjs', import.meta.url));
  const original = existsSync(out) ? readFileSync(out) : null;
  afterAll(() => {
    if (original) writeFileSync(out, original); // leave the committed file as it was
  });

  it('two runs write the same bytes as each other and as the committed yagi.json', () => {
    expect(original, 'committed yagi.json').not.toBeNull();
    execFileSync(process.execPath, [script], { stdio: 'ignore' });
    const a = readFileSync(out);
    execFileSync(process.execPath, [script], { stdio: 'ignore' });
    const b = readFileSync(out);
    expect(a.equals(b)).toBe(true);
    expect(a.equals(original!)).toBe(true);
  });
});

// SPEC 3.2: `name` is the bare name, except `TP. Hồ Chí Minh` (so it is not read as the person's name).
const HCM_DISPLAY = 'TP. Hồ Chí Minh';
/** The display name SPEC 3.2 gives a bare unit name. */
const display = (bare: string) => (bare.normalize('NFC') === 'Hồ Chí Minh'.normalize('NFC') ? HCM_DISPLAY.normalize('NFC') : bare.normalize('NFC'));
/** The bare name behind a display name (only `TP. Hồ Chí Minh` differs). */
const bareOf = (name: string) => (name.normalize('NFC') === HCM_DISPLAY.normalize('NFC') ? 'Hồ Chí Minh'.normalize('NFC') : name);

describe('src/data/provinces.json', () => {
  let pv: any[] = [];
  beforeAll(() => {
    pv = read('../../src/data/provinces.json');
  });

  it('has 34 entries with unique ids', () => {
    expect(pv.length).toBe(34);
    expect(new Set(pv.map((p: { id: string }) => p.id)).size).toBe(34);
  });

  it('all 34 have numeric lat and lon', () => {
    const bad = pv.filter((p) => !(typeof p.lat === 'number' && Number.isFinite(p.lat) && typeof p.lon === 'number' && Number.isFinite(p.lon))).map((p) => `${p.id} ${p.lat},${p.lon}`);
    expect(bad).toEqual([]);
  });

  it('name is the bare name: no "tỉnh " or "thành phố " prefix (any case)', () => {
    const bad = pv.filter((p) => typeof p.name !== 'string' || /^(tỉnh|thành phố)\s/.test(p.name.toLowerCase())).map((p) => `${p.id}: ${p.name}`);
    expect(bad).toEqual([]);
  });

  it('the only name with a prefix is "TP. Hồ Chí Minh", on the ho-chi-minh entry', () => {
    const bad = pv.filter((p) => typeof p.name !== 'string' || (p.name.startsWith('TP.') && !(p.id === 'ho-chi-minh' && p.name.normalize('NFC') === HCM_DISPLAY.normalize('NFC')))).map((p) => `${p.id}: ${p.name}`);
    expect(bad).toEqual([]);
    expect(pv.find((p) => p.id === 'ho-chi-minh')?.name?.normalize('NFC')).toBe(HCM_DISPLAY.normalize('NFC'));
  });

  it('fullName is the bare name, with the "tỉnh"/"thành phố" prefix when the source gives one', () => {
    const bad = pv
      .filter((p) => {
        if (typeof p.fullName !== 'string' || typeof p.name !== 'string') return true;
        const bare = bareOf(p.name);
        if (p.fullName === bare) return false;
        if (!p.fullName.endsWith(` ${bare}`)) return true;
        const prefix = p.fullName.slice(0, p.fullName.length - bare.length - 1).toLowerCase();
        return !['tỉnh', 'thành phố'].includes(prefix);
      })
      .map((p) => `${p.id}: ${p.fullName} / ${p.name}`);
    expect(bad).toEqual([]);
  });

  it('every entry has a name and lies within lat 8-24, lon 102-110', () => {
    for (const p of pv) {
      expect(typeof p.name === 'string' && p.name.length > 0, p.id).toBe(true);
      expect(p.lat, p.id).toBeGreaterThanOrEqual(8);
      expect(p.lat, p.id).toBeLessThanOrEqual(24);
      expect(p.lon, p.id).toBeGreaterThanOrEqual(102);
      expect(p.lon, p.id).toBeLessThanOrEqual(110);
    }
  });

  it('every bare name comes from web/SOURCES.md', () => {
    const src = new URL('../../SOURCES.md', import.meta.url);
    expect(existsSync(src), 'web/SOURCES.md exists').toBe(true);
    const md = readFileSync(src, 'utf8').normalize('NFC');
    const bad = pv.filter((p) => typeof p.name !== 'string' || !md.includes(bareOf(p.name.normalize('NFC')))).map((p) => p.id);
    expect(bad).toEqual([]);
  });

  it("each entry's lat and lon are written in its own SOURCES.md row \"| {id} |\" (comma or dot decimal mark)", () => {
    const md = readFileSync(new URL('../../SOURCES.md', import.meta.url), 'utf8');
    const rowOf = (id: string) => md.split('\n').find((l) => l.startsWith(`| ${id} |`)) ?? '';
    // The number as written: same integer part and decimals, trailing zeros allowed, not part of a longer number.
    const written = (row: string, n: number) => {
      const [int, frac = ''] = String(n).split('.');
      const f = frac ? `[.,]${frac}0*` : '(?:[.,]0+)?';
      return new RegExp(`(?<![\\d.,])${int}${f}(?![\\d]|[.,]\\d)`).test(row);
    };
    const bad = pv.filter((p) => {
      const row = rowOf(p.id);
      return !row || !written(row, p.lat) || !written(row, p.lon);
    }).map((p) => `${p.id} ${p.lat},${p.lon}`);
    expect(bad).toEqual([]);
  });

  // SPEC 3.2: the 34 units in force since 1 July 2025, as named in SOURCES.md rows names-23-merged (23 units
  // formed by merger) and names-11-unchanged (11 units kept as they were). Bare names; display() gives what the UI shows.
  const MERGED_23 = ['Tuyên Quang', 'Lào Cai', 'Thái Nguyên', 'Phú Thọ', 'Bắc Ninh', 'Hưng Yên', 'Ninh Bình', 'Quảng Trị', 'Quảng Ngãi', 'Gia Lai', 'Khánh Hòa', 'Lâm Đồng', 'Đắk Lắk', 'Đồng Nai', 'Tây Ninh', 'Vĩnh Long', 'Đồng Tháp', 'Cà Mau', 'An Giang', 'Hải Phòng', 'Đà Nẵng', 'Hồ Chí Minh', 'Cần Thơ'];
  const UNCHANGED_11 = ['Cao Bằng', 'Điện Biên', 'Hà Tĩnh', 'Lai Châu', 'Lạng Sơn', 'Nghệ An', 'Quảng Ninh', 'Thanh Hóa', 'Sơn La', 'Hà Nội', 'Huế'];

  it('self-check: the 34 names above are the ones in the SOURCES.md rows names-23-merged and names-11-unchanged', () => {
    const md = readFileSync(new URL('../../SOURCES.md', import.meta.url), 'utf8').normalize('NFC');
    const row = (id: string) => md.split('\n').find((l) => l.startsWith(`| ${id} |`)) ?? '';
    expect(MERGED_23.length + UNCHANGED_11.length).toBe(34);
    expect(MERGED_23.filter((n) => !row('names-23-merged').includes(n.normalize('NFC')))).toEqual([]);
    expect(UNCHANGED_11.filter((n) => !row('names-11-unchanged').includes(n.normalize('NFC')))).toEqual([]);
  });

  it('the names are exactly the 34 units in force since 1 July 2025 under the SPEC 3.2 display rule, each once', () => {
    const want = [...MERGED_23, ...UNCHANGED_11].map(display);
    const got = pv.map((p) => (typeof p.name === 'string' ? p.name.normalize('NFC') : String(p.name)));
    expect(got.filter((n) => !want.includes(n)), 'names that are not one of the 34').toEqual([]);
    expect(want.filter((n) => got.filter((g) => g === n).length !== 1), 'units missing or listed more than once').toEqual([]);
  });

  it('every fullName appears in web/SOURCES.md (any case)', () => {
    const md = readFileSync(new URL('../../SOURCES.md', import.meta.url), 'utf8').toLowerCase();
    const bad = pv.filter((p) => typeof p.fullName !== 'string' || !md.includes(p.fullName.toLowerCase())).map((p) => `${p.id}: ${p.fullName}`);
    expect(bad).toEqual([]);
  });
});
