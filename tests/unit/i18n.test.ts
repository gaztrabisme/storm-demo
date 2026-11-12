// Locked acceptance tests: SPEC section 2, all user-facing text in src/i18n/vi.json, no user-facing English.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { APPROVED_FIXED, SUMMARY_TEMPLATE, VERDICT_WIND_TEMPLATE, WHERE_TEMPLATE, templateRe } from '../content.mjs';

const FILE = new URL('../../src/i18n/vi.json', import.meta.url);
const ENGLISH = ['button', 'click', 'settings', 'loading', 'error', 'close', 'next', 'back', 'skip', 'export', 'source', 'done', 'mode', 'theme', 'menu', 'open', 'cancel', 'ok', 'help', 'home', 'info'];

function leaves(node: unknown, path: string, out: Array<[string, unknown]>) {
  if (node !== null && typeof node === 'object') {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) leaves(v, path ? `${path}.${k}` : k, out);
  } else {
    out.push([path, node]);
  }
  return out;
}

describe('src/i18n/vi.json', () => {
  const vi = JSON.parse(readFileSync(FILE, 'utf8'));
  const all = leaves(vi, '', []);

  it('has strings', () => {
    expect(all.length).toBeGreaterThan(0);
  });

  it('every entry is a non-empty string', () => {
    const bad = all.filter(([, v]) => typeof v !== 'string' || v.trim() === '').map(([k]) => k);
    expect(bad).toEqual([]);
  });

  const strings = all.map(([, v]) => v).filter((v): v is string => typeof v === 'string');

  it('the SOURCES.md rows that SPEC 10 names by id are all found (self-check)', () => {
    const missing = APPROVED_FIXED.filter((s: string) => s.startsWith('<SOURCES.md row'));
    expect(missing).toEqual([]);
  });

  it('every approved string of SPEC 10 (cards, actions, satellite panel, 10.6 HUD labels), the 6.2 legend and the 6.4 credits is in vi.json word for word', () => {
    const missing = APPROVED_FIXED.filter((s: string) => !strings.some((v) => v.includes(s)));
    expect(missing).toEqual([]);
  });

  it('the SPEC 10.5 "where" answer template is in vi.json word for word (placeholder names free)', () => {
    const re = templateRe(WHERE_TEMPLATE);
    expect(strings.some((v) => re.test(v)), WHERE_TEMPLATE).toBe(true);
  });

  it('the SPEC 6.3 storm-summary and verdict-wind templates are in vi.json word for word (placeholder names free)', () => {
    for (const tpl of [SUMMARY_TEMPLATE, VERDICT_WIND_TEMPLATE]) {
      const re = templateRe(tpl);
      expect(strings.some((v) => re.test(v)), tpl).toBe(true);
    }
  });

  it('no entry contains common English UI words', () => {
    const re = new RegExp(`(^|[^A-Za-z])(${ENGLISH.join('|')})(?![A-Za-z])`, 'i');
    const bad = all.filter(([, v]) => typeof v === 'string' && re.test(v)).map(([k, v]) => `${k}: ${v}`);
    expect(bad).toEqual([]);
  });
});

// SPEC 2: all user-facing text is in vi.json, read through t(). Vietnamese text written as a string literal in
// the code (outside src/i18n/) is text that does not come from vi.json. Comments are not string literals.
const SRC = new URL('../../src/', import.meta.url);
const VI_LETTERS = /[ăâđêôơưĂÂĐÊÔƠƯàáãèéìíòóõùúýÀÁÃÈÉÌÍÒÓÕÙÚÝ\u1EA0-\u1EF9\u0300-\u0323]/;

function codeFiles(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = `${dir}${name}`;
    if (statSync(full).isDirectory()) {
      if (name !== 'i18n' || dir !== SRC.pathname) out.push(...codeFiles(`${full}/`));
    } else if (/\.(ts|tsx|js|mjs)$/.test(name) && !/\.d\.ts$/.test(name)) out.push(full);
  }
  return out;
}

/** String and template literal texts of a JS/TS file, comments skipped (a small tokenizer; regex literals are not parsed). */
function literals(code: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < code.length) {
    const c = code[i];
    if (c === '/' && code[i + 1] === '/') {
      while (i < code.length && code[i] !== '\n') i++;
    } else if (c === '/' && code[i + 1] === '*') {
      const end = code.indexOf('*/', i + 2);
      i = end < 0 ? code.length : end + 2;
    } else if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      let buf = '';
      let depth = 0;
      while (j < code.length) {
        const d = code[j];
        if (d === '\\') {
          buf += code.slice(j, j + 2);
          j += 2;
          continue;
        }
        if (c === '`' && d === '$' && code[j + 1] === '{') depth++;
        else if (c === '`' && depth > 0 && d === '}') depth--;
        else if (d === c && depth === 0) break;
        else if (c !== '`' && d === '\n') break;
        buf += d;
        j++;
      }
      out.push(buf);
      i = j + 1;
    } else i++;
  }
  return out;
}

describe('no user-facing text outside vi.json (SPEC 2)', () => {
  it('self-check: the scanner finds literals and skips comments', () => {
    expect(literals("// 'Bão'\nconst a = 'Cấp gió'; /* \"Bỏ qua\" */ const b = `x ${y} Tiếp`;")).toEqual(['Cấp gió', 'x ${y} Tiếp']);
  });

  it('no string literal with Vietnamese letters in src/ outside src/i18n/', () => {
    const files = codeFiles(SRC.pathname);
    expect(files.length, 'code files under src/').toBeGreaterThan(0);
    const bad: string[] = [];
    for (const f of files) {
      for (const lit of literals(readFileSync(f, 'utf8'))) if (VI_LETTERS.test(lit)) bad.push(`${f.slice(SRC.pathname.length)}: ${lit.slice(0, 60)}`);
    }
    expect(bad).toEqual([]);
  });
});
