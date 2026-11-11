// Shared helpers for the locked UAT scripts. Each area script imports these, runs its
// scenarios, and calls finish() which prints "N/M PASS" and exits 1 on any failure.
import { mkdirSync, readFileSync } from 'node:fs';
import { chromium } from 'playwright';
export * from '../content.mjs';

export const BASE = process.env.UAT_URL ?? 'http://localhost:5195/?test=1';
export const READY_MS = Number(process.env.UAT_READY_MS ?? 20000);
export const SHOTS = new URL('./shots/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

export const HAI_PHONG = { latitude: 20.8449, longitude: 106.6881 };
export const HCM = { latitude: 10.7769, longitude: 106.7009 };
export const SETTINGS_KEY = 'stormdemo.settings.v1';
export const LOG_KEY = 'stormdemo.log.v1';
export const TIME_RE = /^\d{2}:\d{2}, \d{2}\/\d{2}$/;
export const TIME_IN = /\d{2}:\d{2}, \d{2}\/\d{2}/;

const results = [];
export const errors = [];
export function check(name, ok, detail = '') {
  results.push(!!ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  return !!ok;
}
export const note = (text) => console.log(`NOTE  ${text}`);

/** Run one scenario; a thrown error counts as one FAIL and the script carries on. */
export async function scenario(name, fn) {
  console.log(`\n# ${name}`);
  try {
    await fn();
  } catch (e) {
    check(`${name}: scenario ran to the end`, false, String(e?.message ?? e).split('\n')[0]);
  }
}

export const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

/** URL of the app with extra query params set (null deletes). */
export function url(params = {}) {
  const u = new URL(BASE);
  for (const [k, v] of Object.entries(params)) {
    if (v === null) u.searchParams.delete(k);
    else u.searchParams.set(k, v);
  }
  return u.toString();
}

/**
 * New browser context. Fresh storage unless `init` says otherwise.
 * phone: 375x812 isMobile + hasTouch; otherwise 1440x900.
 * geo: { latitude, longitude } grants geolocation there; geo: false (default) grants nothing.
 */
export async function context({ phone = false, geo = false, reducedMotion = 'no-preference', colorScheme = 'light', init, acceptDownloads = false } = {}) {
  const ctx = await browser.newContext({
    viewport: phone ? { width: 375, height: 812 } : { width: 1440, height: 900 },
    ...(phone ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}),
    reducedMotion,
    colorScheme,
    acceptDownloads,
    ...(geo ? { geolocation: geo, permissions: ['geolocation'] } : { permissions: [] }),
  });
  ctx.setDefaultTimeout(5000);
  if (init) await ctx.addInitScript(init);
  return ctx;
}

/** Init script: clear localStorage once per tab (not on reloads). */
export const CLEAR_ONCE = () => {
  try {
    if (!sessionStorage.getItem('__uat_cleared')) {
      localStorage.clear();
      sessionStorage.setItem('__uat_cleared', '1');
    }
  } catch {}
};

/**
 * SPEC 2 "no runtime network requests" and SPEC 7 "nothing is sent over the network".
 * Every page opened through these helpers fails the run on: a request off the page's origin,
 * any method other than GET, a beacon/ping, a fetch/XHR carrying a query string, or a websocket off the origin.
 * Same-origin GETs of files that ship in dist/ are allowed.
 */
export function guardNetwork(page, target, errs = errors) {
  const origin = new URL(target).origin;
  page.on('request', (r) => {
    const u = r.url();
    if (u.startsWith('data:') || u.startsWith('blob:')) return;
    let o = null;
    let q = '';
    try {
      const x = new URL(u);
      o = x.origin;
      q = x.search;
    } catch {}
    const kind = r.resourceType();
    if (o !== origin) errs.push(`network: request off the origin ${r.method()} ${u}`);
    else if (r.method() !== 'GET') errs.push(`network: ${r.method()} ${u}`);
    else if (kind === 'ping') errs.push(`network: beacon/ping ${u}`);
    else if ((kind === 'fetch' || kind === 'xhr') && q) errs.push(`network: ${kind} with query string ${u}`);
  });
  page.on('websocket', (ws) => {
    try {
      const w = new URL(ws.url());
      if (w.host !== new URL(origin).host) errs.push(`network: websocket off the origin ${ws.url()}`);
    } catch {
      errs.push(`network: websocket ${ws.url()}`);
    }
  });
}

/** Open a page, collect uncaught page errors and network violations, wait for window.__app.ready. */
export async function open(ctx, target = BASE, errs = errors) {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errs.push(String(e)));
  guardNetwork(page, target, errs);
  await page.goto(target);
  await ready(page);
  return page;
}
export async function ready(page) {
  await page.waitForFunction(() => !!window.__app && !!window.__app.ready, null, { timeout: READY_MS });
  await page.evaluate(() => window.__app.ready);
}
export async function reload(page) {
  await page.reload();
  await ready(page);
}

export const sel = (id) => `[data-test="${id}"]`;
export const T = (page, id) => page.locator(sel(id));
export const visible = (page, id) => T(page, id).first().isVisible().catch(() => false);
export const text = async (page, id) => ((await T(page, id).first().textContent()) ?? '').replace(/\s+/g, ' ').trim();
/** Rendered text (innerText): leaves out parts hidden with CSS. */
export const vtext = async (page, id) => ((await T(page, id).first().innerText()) ?? '').replace(/\s+/g, ' ').trim();
export const norm = (s) => (s ?? '').replace(/\s+/g, ' ').trim();
export async function waitVisible(page, id, timeout = 5000) {
  await T(page, id).first().waitFor({ state: 'visible', timeout });
}
export async function waitHidden(page, id, timeout = 5000) {
  await T(page, id).first().waitFor({ state: 'hidden', timeout });
}
export const waitView = (page, view, timeout = 8000) => page.waitForFunction((v) => window.__app.view === v, view, { timeout });

/** If the first-run onboarding is open, press "Bỏ qua" so the rest of the page is usable. */
export async function skipOnboarding(page) {
  const ob = T(page, 'onboarding').first();
  if (await ob.isVisible().catch(() => false)) {
    await ob.getByRole('button', { name: 'Bỏ qua', exact: true }).first().click();
    await ob.waitFor({ state: 'hidden' });
  }
}

/**
 * Choose the option labelled `label` inside every element matching `selector`.
 * Works for a native select, radios (clicks the label when there is one), or buttons.
 */
export async function pickOption(page, selector, label) {
  const kind = await page.evaluate(
    ({ selector, label }) => {
      document.querySelectorAll('[data-uat-pick]').forEach((e) => e.removeAttribute('data-uat-pick'));
      const norm = (s) => (s ?? '').replace(/\s+/g, ' ').trim();
      const roots = [...document.querySelectorAll(selector)];
      for (const root of roots) {
        const selects = root.matches('select') ? [root] : [...root.querySelectorAll('select')];
        for (const s of selects) {
          if ([...s.options].some((o) => norm(o.textContent) === label)) {
            s.setAttribute('data-uat-pick', '1');
            return 'select';
          }
        }
      }
      for (const root of roots) {
        const ctrls = root.matches('input,button,[role=radio]') ? [root] : [...root.querySelectorAll('input[type=radio],button,[role=radio]')];
        for (const c of ctrls) {
          const lab = c.labels?.[0] ?? c.closest('label');
          const txt = norm(lab?.textContent) || norm(c.textContent) || c.getAttribute('aria-label') || c.value;
          if (norm(txt) === label) {
            (lab ?? c).setAttribute('data-uat-pick', '1');
            return 'click';
          }
        }
      }
      return null;
    },
    { selector, label },
  );
  if (!kind) throw new Error(`no option "${label}" in ${selector}`);
  const el = page.locator('[data-uat-pick="1"]').first();
  if (kind === 'select') await el.selectOption({ label });
  else await el.click();
}

/** Open settings, run fn, close with Esc. */
export async function inSettings(page, fn) {
  if (!(await visible(page, 'settings'))) {
    await T(page, 'btn-settings').first().click();
    await waitVisible(page, 'settings');
  }
  await fn();
  await page.keyboard.press('Escape');
}

export const rootFont = (page) => page.evaluate(() => getComputedStyle(document.documentElement).fontSize);
export const dataTheme = (page) => page.evaluate(() => document.documentElement.getAttribute('data-theme'));
export const bodyBg = (page) =>
  page.evaluate(() => {
    for (const e of [document.body, document.documentElement]) {
      const c = getComputedStyle(e).backgroundColor;
      if (c && c !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(c)) return c;
    }
    return 'transparent';
  });
export function luminance(rgb) {
  const m = String(rgb).match(/[\d.]+/g);
  if (!m) return NaN;
  const [r, g, b] = m.slice(0, 3).map((v) => {
    const c = Number(v) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
export const events = (page) => page.evaluate(() => window.__app.events());

/** Vietnam time "HH:mm, dd/MM" for a Date / ISO / ms value. */
export function vnTime(x) {
  const d = new Date(typeof x === 'string' || typeof x === 'number' ? x : x.getTime());
  const v = new Date(d.getTime() + 7 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(v.getUTCHours())}:${p(v.getUTCMinutes())}, ${p(v.getUTCDate())}/${p(v.getUTCMonth() + 1)}`;
}

/** Press btn-check and wait for the verdict card. */
export async function runCheck(page, timeout = 15000) {
  await T(page, 'btn-check').first().click();
  await waitVisible(page, 'verdict', timeout);
}

/** In the province picker, choose the option whose text contains `name`. */
export async function pickProvince(page, name) {
  const picker = T(page, 'province-picker').first();
  await picker.waitFor({ state: 'visible', timeout: 12000 });
  const select = (await picker.evaluate((e) => e.tagName)) === 'SELECT' ? picker : picker.locator('select').first();
  const value = await select.evaluate((s, n) => [...s.options].find((o) => o.textContent.includes(n))?.value ?? null, name);
  if (value === null) throw new Error(`no province option containing "${name}"`);
  await select.selectOption(value);
}

/**
 * Label of the chosen option inside `selector`: the checked radio's label, the selected option of a select,
 * or the button with aria-pressed / aria-checked / aria-selected = "true". null if none.
 */
export const chosenOption = (page, selector) =>
  page.evaluate((selector) => {
    const norm = (s) => (s ?? '').replace(/\s+/g, ' ').trim();
    const root = document.querySelector(selector);
    if (!root) return null;
    const sel = root.matches('select') ? root : root.querySelector('select');
    if (sel) return norm(sel.selectedOptions[0]?.textContent);
    const r = [...root.querySelectorAll('input[type=radio]')].find((x) => x.checked);
    if (r) return norm((r.labels?.[0] ?? r.closest('label'))?.textContent) || r.getAttribute('aria-label') || r.value;
    const b = [...root.querySelectorAll('button,[role=radio],[role=button]')].find((x) => ['aria-pressed', 'aria-checked', 'aria-selected'].some((a) => x.getAttribute(a) === 'true'));
    return b ? norm(b.textContent) || b.getAttribute('aria-label') : null;
  }, selector);

/** True when the centre of the element is not covered by another element (it is what the user sees there). */
export const onTop = (page, id) =>
  page.evaluate((id) => {
    const el = document.querySelector(`[data-test="${id}"]`);
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return false;
    const hit = document.elementFromPoint(x, y);
    return !!hit && (hit === el || el.contains(hit));
  }, id);

/**
 * A km figure as shown on the page. "1.087" / "1,087" / "1 087" with groups of three digits are thousands
 * separators; otherwise a single "," or "." is the decimal mark. SPEC does not fix the format.
 */
export function parseKm(s) {
  const t = String(s).trim().replace(/\s/g, '');
  if (/^\d{1,3}([.,]\d{3})+$/.test(t)) return Number(t.replace(/[.,]/g, ''));
  return Number(t.replace(',', '.'));
}

// ---- Data the app ships, read from disk so the UAT can compute expected values (SPEC 3 and 5). ----
const WEB = new URL('../../', import.meta.url);
export const PROVINCES = (() => {
  try {
    return JSON.parse(readFileSync(new URL('src/data/provinces.json', WEB), 'utf8'));
  } catch {
    return [];
  }
})();
export const TRACK = (() => {
  try {
    return JSON.parse(readFileSync(new URL('src/data/generated/yagi.json', WEB), 'utf8'));
  } catch {
    return null;
  }
})();
export const NOW_MS = Date.parse('2024-09-05T00:00:00Z');
/** The province whose name contains `part` (from src/data/provinces.json), or null. */
export const province = (part) => PROVINCES.find((p) => p.name.includes(part)) ?? null;

/** The tests' own SPEC 5 verdict, for one Earth radius (km). Times in ms. */
export function refVerdict(place, track, nowMs = NOW_MS, R = 6371) {
  const RAD = Math.PI / 180;
  const pts = track.points.map((p) => ({ ...p, ms: Date.parse(p.t) }));
  const lerp = (a, b, f) => (a === null || b === null ? null : a + (b - a) * f);
  const end = pts[pts.length - 1].ms;
  let first = null;
  let last = null;
  let closest = null;
  let peak = null;
  for (let t = nowMs; t <= end; t += 30 * 60 * 1000) {
    let i = pts.findIndex((p) => p.ms >= t);
    const b = pts[i];
    const a = i > 0 ? pts[i - 1] : b;
    const f = b.ms === a.ms ? 0 : (t - a.ms) / (b.ms - a.ms);
    const lat = a.lat + (b.lat - a.lat) * f;
    const lon = a.lon + (b.lon - a.lon) * f;
    const wind = lerp(a.windKt, b.windKt, f);
    const dLat = (place.lat - lat) * RAD;
    const dLon = (place.lon - lon) * RAD;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat * RAD) * Math.cos(place.lat * RAD) * Math.sin(dLon / 2) ** 2;
    const d = 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
    const y = Math.sin(dLon) * Math.cos(place.lat * RAD);
    const x = Math.cos(lat * RAD) * Math.sin(place.lat * RAD) - Math.sin(lat * RAD) * Math.cos(place.lat * RAD) * Math.cos(dLon);
    const brg = ((Math.atan2(y, x) / RAD) % 360 + 360) % 360;
    const q = brg < 90 ? 'ne' : brg < 180 ? 'se' : brg < 270 ? 'sw' : 'nw';
    const r = lerp(a.r34nm[q], b.r34nm[q], f);
    if (!closest || d < closest.distanceKm) closest = { time: t, distanceKm: d };
    if (r !== null && d <= r * 1.852) {
      if (first === null) first = t;
      last = t;
      if (wind !== null && (peak === null || wind > peak)) peak = wind;
    }
  }
  return { affected: first !== null, firstInside: first, lastInside: last, closest, peakWindKt: peak };
}

/** Texts of the safety actions in verdict-actions, in order: list items if it is a list, else its child elements. */
export const actionTexts = (page) =>
  T(page, 'verdict-actions').first().evaluate((e) => {
    const norm = (s) => (s ?? '').replace(/\s+/g, ' ').trim();
    const li = [...e.querySelectorAll('li')];
    if (li.length) return li.map((x) => norm(x.textContent));
    const box = [...e.children].filter((c) => !/^H\d$/.test(c.tagName));
    return (box.length === 1 ? [...box[0].children] : box).map((x) => norm(x.textContent));
  });

/** Track position at time ms, linear in lat/lon between the yagi.json points (SPEC 5.1). */
export function trackAt(track, tMs) {
  const pts = track.points.map((p) => ({ ...p, ms: Date.parse(p.t) }));
  const i = pts.findIndex((p) => p.ms >= tMs);
  if (i < 0) return null;
  const b = pts[i];
  const a = i > 0 ? pts[i - 1] : b;
  const f = b.ms === a.ms ? 0 : (tMs - a.ms) / (b.ms - a.ms);
  return { lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f };
}

/** The knowledge cards: one per learn-source, as the largest block under [learn] holding only that source line. */
export const CARDS = ['Cấp gió là gì?', 'Vùng gió mạnh là gì?', 'Làm gì khi bão tới?'];
export const learnCards = (page) =>
  page.evaluate((titles) => {
    const learn = document.querySelector('[data-test="learn"]');
    if (!learn) return null;
    const norm = (s) => (s ?? '').replace(/\s+/g, ' ').trim();
    const shown = (e) => !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
    return [...learn.querySelectorAll('[data-test="learn-source"]')].map((src) => {
      let card = src;
      while (card.parentElement && card.parentElement !== learn && card.parentElement.querySelectorAll('[data-test="learn-source"]').length === 1) card = card.parentElement;
      const all = norm(card.textContent);
      const title = titles.find((t) => all.includes(t)) ?? null;
      const body = norm(all.replace(title ?? '', '').replace(norm(src.textContent), ''));
      return { title, body, source: norm(src.textContent), shown: shown(src) };
    });
  }, CARDS);

/** { lat, lon } from a Playwright geolocation { latitude, longitude }. */
export const placeOf = (g) => ({ lat: g.latitude, lon: g.longitude });

/**
 * The tests' own SPEC 5 verdict for a place, for both common Earth radii (6371 and 6378.137 km),
 * compared with the app's __app.verdict: times within 30 min, closest distance within 1 %, peak wind within 1 kt.
 * Returns '' when it matches for either radius, else what differs.
 */
export function verdictMismatch(app, place, track = TRACK) {
  if (!track) return 'yagi.json did not load';
  if (!app) return 'no __app.verdict';
  const ms = (x) => (x === null || x === undefined ? null : new Date(x).getTime());
  const HALF = 30 * 60 * 1000;
  const diffs = [6371, 6378.137].map((R) => {
    const ref = refVerdict(place, track, NOW_MS, R);
    const bad = [];
    if (app.affected !== ref.affected) bad.push(`affected ${app.affected} vs ${ref.affected}`);
    for (const k of ['firstInside', 'lastInside']) {
      const a = ms(app[k]);
      const b = ref[k];
      if ((a === null) !== (b === null) || (a !== null && Math.abs(a - b) > HALF)) bad.push(`${k} ${app[k]} vs ${b === null ? null : new Date(b).toISOString()}`);
    }
    const cd = app.closest?.distanceKm;
    if (typeof cd !== 'number' || Math.abs(cd - ref.closest.distanceKm) > ref.closest.distanceKm * 0.01) bad.push(`closest.distanceKm ${cd} vs ${ref.closest.distanceKm.toFixed(1)}`);
    const ct = ms(app.closest?.time);
    if (ct === null || Math.abs(ct - ref.closest.time) > HALF) bad.push(`closest.time ${app.closest?.time} vs ${new Date(ref.closest.time).toISOString()}`);
    const pw = app.peakWindKt ?? null;
    if ((pw === null) !== (ref.peakWindKt === null) || (pw !== null && Math.abs(pw - ref.peakWindKt) > 1)) bad.push(`peakWindKt ${pw} vs ${ref.peakWindKt}`);
    return bad.join('; ');
  });
  return diffs.some((d) => d === '') ? '' : diffs[0];
}

/** True when the centre of box `inner` lies inside box `outer`. */
export const centreInside = (inner, outer) =>
  !!inner && !!outer && inner.width > 0 && inner.height > 0 &&
  inner.x + inner.width / 2 >= outer.x && inner.x + inner.width / 2 <= outer.x + outer.width &&
  inner.y + inner.height / 2 >= outer.y && inner.y + inner.height / 2 <= outer.y + outer.height;

/** PNG of the screen area covered by the largest visible canvas (the globe), with whatever is drawn over it except the warning pop-up. */
export async function canvasShot(page) {
  const box = await page.evaluate(() => {
    let best = null;
    for (const c of document.querySelectorAll('canvas')) {
      const r = c.getBoundingClientRect();
      const x = Math.max(0, r.left);
      const y = Math.max(0, r.top);
      const w = Math.min(innerWidth, r.right) - x;
      const h = Math.min(innerHeight, r.bottom) - y;
      if (w > 0 && h > 0 && getComputedStyle(c).visibility !== 'hidden' && (!best || w * h > best.width * best.height)) best = { x, y, width: w, height: h };
    }
    return best;
  });
  if (!box) throw new Error('no visible canvas');
  // The warning pop-up may open over the globe at any moment after a verdict; it is masked so it does not count as globe movement.
  return page.screenshot({ clip: box, animations: 'allow', mask: [page.locator('[data-test="assistant-warning"]')] });
}

/**
 * Share of pixels (0..1) that differ by more than 8 in any channel between two PNGs of the same size.
 * Decoded in the page, so the tests need no image library. Different sizes count as 1.
 */
export const pixelDiff = (page, a, b) =>
  page.evaluate(
    async ([a, b]) => {
      const load = async (b64) => {
        const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const bmp = await createImageBitmap(new Blob([bin], { type: 'image/png' }));
        const c = new OffscreenCanvas(bmp.width, bmp.height);
        const g = c.getContext('2d');
        g.drawImage(bmp, 0, 0);
        return g.getImageData(0, 0, bmp.width, bmp.height);
      };
      const [x, y] = await Promise.all([load(a), load(b)]);
      if (x.width !== y.width || x.height !== y.height) return 1;
      let n = 0;
      for (let i = 0; i < x.data.length; i += 4) {
        if (Math.abs(x.data[i] - y.data[i]) > 8 || Math.abs(x.data[i + 1] - y.data[i + 1]) > 8 || Math.abs(x.data[i + 2] - y.data[i + 2]) > 8) n++;
      }
      return n / (x.width * x.height);
    },
    [a.toString('base64'), b.toString('base64')],
  );
/** Our thresholds for the pixel comparisons (SPEC gives none): "the same" is under 0.5 % of pixels changed, "changed" is over 0.5 %. */
export const SAME_PX = 0.005;

/**
 * Init script: counts WebGL draw calls in window.__uatDraws, and lets a test pretend the tab is hidden
 * with window.__uatHide() (document.hidden = true, visibilityState = "hidden", then a visibilitychange event).
 */
export const DRAW_COUNTER = () => {
  window.__uatDraws = 0;
  for (const C of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
    if (!C) continue;
    for (const m of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced', 'drawRangeElements']) {
      const f = C.prototype[m];
      if (typeof f !== 'function') continue;
      C.prototype[m] = function (...args) {
        window.__uatDraws++;
        return f.apply(this, args);
      };
    }
  }
  window.__uatHide = () => {
    Object.defineProperty(document, 'hidden', { get: () => true, configurable: true });
    Object.defineProperty(document, 'visibilityState', { get: () => 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  };
};

export async function finish() {
  check('no page errors and no network requests SPEC 2 / 7 forbid', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  const failed = results.filter((x) => !x).length;
  console.log(`\n${results.length - failed}/${results.length} PASS`);
  process.exit(failed ? 1 : 0);
}
