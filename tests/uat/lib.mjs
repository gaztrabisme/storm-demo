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
 * init: one init script or an array of them.
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
  for (const f of [init].flat()) if (f) await ctx.addInitScript(f);
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
  window.__uatDrawBy = new Map(); // canvas (HTMLCanvasElement or OffscreenCanvas) -> draw calls
  for (const C of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
    if (!C) continue;
    for (const m of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced', 'drawRangeElements']) {
      const f = C.prototype[m];
      if (typeof f !== 'function') continue;
      C.prototype[m] = function (...args) {
        window.__uatDraws++;
        window.__uatDrawBy.set(this.canvas, (window.__uatDrawBy.get(this.canvas) ?? 0) + 1);
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

/** Draw calls so far on every canvas except the globe's (the largest canvas on the page), e.g. the Usui-chan figure. */
export const otherDraws = (page) =>
  page.evaluate(() => {
    let globe = null;
    let area = 0;
    for (const c of document.querySelectorAll('canvas')) {
      const r = c.getBoundingClientRect();
      if (r.width * r.height > area) {
        area = r.width * r.height;
        globe = c;
      }
    }
    let n = 0;
    for (const [c, k] of window.__uatDrawBy ?? []) if (c !== globe) n += k;
    return n;
  });

// ---- SPEC 6.8: the Usui-chan figure [assistant-figure] and its data-clip ----

/**
 * Init script: every 40 ms, records the data-clip values of the visible assistant-figure elements in
 * window.__uatClips as { t (performance.now), clip ("a|b" for several figures), n (figures shown) }, one entry per change.
 */
export const CLIP_WATCH = () => {
  window.__uatClips = [];
  let last = null;
  setInterval(() => {
    const figs = [...document.querySelectorAll('[data-test="assistant-figure"]')].filter((e) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden');
    const v = figs.map((e) => e.getAttribute('data-clip') ?? '').join('|');
    if (v !== last) {
      last = v;
      window.__uatClips.push({ t: performance.now(), clip: v, n: figs.length });
    }
  }, 40);
};
export const pageNow = (page) => page.evaluate(() => performance.now());
/** Clip names in a data-clip value: SPEC gives one name, or two played together ("alert" + "talk"), so any separator is read. */
export const clipTokens = (v) => String(v ?? '').split(/[^A-Za-z]+/).filter(Boolean);
/** data-clip entries recorded since page time `since` (ms): [{ t: ms after since, clip, tokens }]. */
export const clipsSince = (page, since) =>
  page.evaluate((since) => (window.__uatClips ?? []).filter((e) => e.t >= since).map((e) => ({ t: Math.round(e.t - since), clip: e.clip, n: e.n })), since).then((xs) => xs.map((x) => ({ ...x, tokens: clipTokens(x.clip) })));
/** Wait until a visible figure's data-clip holds every name in `names` (since page time `since`); returns the entries seen. */
export async function waitClips(page, since, names, timeout = 3000) {
  const t0 = Date.now();
  let seen = [];
  for (;;) {
    seen = await clipsSince(page, since);
    const all = new Set(seen.flatMap((e) => e.tokens));
    if (names.every((n) => all.has(n)) || Date.now() - t0 > timeout) return seen;
    await page.waitForTimeout(100);
  }
}
export const clipSummary = (seen) => seen.map((e) => `${e.t}ms:${e.clip || '-'}`).join(' ').slice(0, 300);

// ---- SPEC 6.7: satellite close-up ----
export const satState = (page) => page.evaluate(() => (window.__app.satellite ? { ...window.__app.satellite } : null));

/** Box of the largest visible canvas (the 3D view). */
export const viewBox = (page) =>
  page.evaluate(() => {
    let best = null;
    for (const c of document.querySelectorAll('canvas')) {
      const r = c.getBoundingClientRect();
      if (r.width * r.height > 0 && getComputedStyle(c).visibility !== 'hidden' && (!best || r.width * r.height > best.width * best.height)) best = { x: r.left, y: r.top, width: r.width, height: r.height };
    }
    return best;
  });

/** Touch events through the Chrome DevTools protocol (Playwright has no pinch). points: [[x, y], ...] per step. */
export async function touchPath(page, steps, stepMs = 16) {
  const cdp = await page.context().newCDPSession(page);
  const pts = (ps) => ps.map(([x, y], id) => ({ x, y, id, radiusX: 1, radiusY: 1, force: 1 }));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(steps[0]) });
  for (const s of steps.slice(1)) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(s) });
    await page.waitForTimeout(stepMs);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}
/** A two-finger pinch around (cx, cy), the fingers going from d0 to d1 px apart (d1 > d0 spreads them). */
export function pinch(page, cx, cy, d0, d1, n = 10) {
  const steps = Array.from({ length: n + 1 }, (_, i) => {
    const d = (d0 + ((d1 - d0) * i) / n) / 2;
    return [[cx - d, cy], [cx + d, cy]];
  });
  return touchPath(page, steps);
}

/**
 * The HUD leaders: every visible SVG line, polyline or path inside [satellite-hud], as its two end points on screen.
 * SPEC gives the leaders no data-test; the tests read them as SVG geometry (see tests/README.md).
 */
export const hudLines = (page) =>
  page.evaluate(() => {
    const hud = document.querySelector('[data-test="satellite-hud"]');
    if (!hud) return [];
    const out = [];
    for (const el of hud.querySelectorAll('line, polyline, path')) {
      if (el.getClientRects().length === 0 || getComputedStyle(el).visibility === 'hidden' || getComputedStyle(el).display === 'none') continue;
      let op = 1;
      for (let a = el; a && a !== document.documentElement; a = a.parentElement) op *= Number(getComputedStyle(a).opacity);
      if (op < 0.05) continue;
      const m = el.getScreenCTM();
      if (!m || typeof el.getTotalLength !== 'function') continue;
      const len = el.getTotalLength();
      if (!(len > 0)) continue;
      const p0 = el.getPointAtLength(0);
      const p1 = el.getPointAtLength(len);
      const tr = (p) => ({ x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f });
      out.push([tr(p0), tr(p1)]);
    }
    return out;
  });

/** Boxes of the visible hud-label elements with their text. */
export const hudLabels = (page) =>
  page.locator('[data-test="hud-label"]').evaluateAll((ls) =>
    ls
      .filter((l) => l.getClientRects().length > 0 && getComputedStyle(l).visibility !== 'hidden')
      .map((l) => {
        const r = l.getBoundingClientRect();
        return { text: l.textContent.replace(/\s+/g, ' ').trim(), x: r.left, y: r.top, width: r.width, height: r.height };
      }),
  );

/**
 * Leaders, matched to labels: a line whose one end is within `near` px of a label's box is that label's leader,
 * and its other end is the anchor on the model. With `view` (the 3D view's box), a line whose two ends both lie
 * within 40 px of one corner of the view is a corner bracket, not a leader, and is left out.
 */
export function leadersOf(lines, labels, near = 12, view = null) {
  const dist = (p, b) => Math.hypot(Math.max(b.x - p.x, 0, p.x - (b.x + b.width)), Math.max(b.y - p.y, 0, p.y - (b.y + b.height)));
  const corners = view ? [[view.x, view.y], [view.x + view.width, view.y], [view.x, view.y + view.height], [view.x + view.width, view.y + view.height]] : [];
  const bracket = (a, b) => corners.some(([x, y]) => Math.hypot(a.x - x, a.y - y) <= 40 && Math.hypot(b.x - x, b.y - y) <= 40);
  const out = [];
  for (const [a, b] of lines) {
    if (bracket(a, b)) continue;
    for (const l of labels) {
      if (dist(a, l) <= near) out.push({ label: l.text, anchor: b });
      else if (dist(b, l) <= near) out.push({ label: l.text, anchor: a });
    }
  }
  return out;
}

/**
 * Init script for timing camera flights: WebGL canvases keep their drawing buffer (preserveDrawingBuffer), so the
 * page can copy the 3D view while it runs. Page screenshots are too slow (0.3-0.5 s each here) to time a 1 s flight.
 */
export const FLIGHT_PROBE = () => {
  const orig = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, attrs) {
    if (/webgl/.test(String(type))) attrs = { ...(attrs ?? {}), preserveDrawingBuffer: true };
    return orig.call(this, type, attrs);
  };
};

/**
 * Times a camera flight (needs FLIGHT_PROBE): calls `start`, then every 100 ms for `ms` copies the largest visible canvas
 * into a 160 x 120 picture and records when __app.view becomes `view`.
 * Returns { viewMs, steps: [{ from, t, diff }] }: diff is the share of pixels changed (more than 8 in a channel) between
 * the copies at `from` and `t` (ms after the click). Copies come every 100 ms or later when the page is busy.
 */
export async function timeFlight(page, view, start, ms = 2500) {
  await page.evaluate(({ view, ms }) => {
    const W = 160;
    const H = 120;
    const g = new OffscreenCanvas(W, H).getContext('2d', { willReadFrequently: true });
    const st = { t0: performance.now(), viewAt: null, steps: [], done: false };
    window.__uatFlight = st;
    let prev = null;
    const grab = () => {
      let best = null;
      for (const c of document.querySelectorAll('canvas')) {
        const r = c.getBoundingClientRect();
        if (r.width * r.height > 0 && getComputedStyle(c).visibility !== 'hidden' && (!best || r.width * r.height > best.r.width * best.r.height)) best = { c, r };
      }
      if (!best) return null;
      g.clearRect(0, 0, W, H);
      g.drawImage(best.c, 0, 0, W, H);
      return g.getImageData(0, 0, W, H).data;
    };
    const tick = () => {
      const t = performance.now() - st.t0;
      if (window.__app.view === view && st.viewAt === null) st.viewAt = t;
      const cur = grab();
      if (prev && cur) {
        let n = 0;
        for (let i = 0; i < cur.length; i += 4) if (Math.abs(cur[i] - prev[i]) > 8 || Math.abs(cur[i + 1] - prev[i + 1]) > 8 || Math.abs(cur[i + 2] - prev[i + 2]) > 8) n++;
        st.steps.push({ from: Math.round(st.last), t: Math.round(t), diff: n / (W * H) });
      }
      prev = cur;
      st.last = t;
      if (t < ms) setTimeout(tick, 100);
      else st.done = true;
    };
    prev = grab();
    st.last = 0;
    setTimeout(tick, 100);
    const viewTick = () => {
      if (window.__app.view === view && st.viewAt === null) st.viewAt = performance.now() - st.t0;
      if (st.viewAt === null && !st.done) requestAnimationFrame(viewTick);
    };
    requestAnimationFrame(viewTick);
  }, { view, ms });
  await start();
  await page.waitForFunction(() => window.__uatFlight.done, null, { timeout: ms + 5000 }).catch(() => {});
  return page.evaluate(() => ({ viewMs: window.__uatFlight.viewAt, steps: window.__uatFlight.steps }));
}
/** Our threshold for "the camera is flying": over 2 % of the 160 x 120 picture changes between two copies. */
export const MOVING_PX = 0.02;

export async function finish() {
  check('no page errors and no network requests SPEC 2 / 7 forbid', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  const failed = results.filter((x) => !x).length;
  console.log(`\n${results.length - failed}/${results.length} PASS`);
  process.exit(failed ? 1 : 0);
}
