// UAT, SPEC 2.1 "Not a warning" + 6.1 (official bulletin, footer) + 6.3 (btn-advice) + 6.4 (no pop-up):
// no red, no commands outside the quoted official advice, nothing pops up by itself, the official-bulletin block,
// the disclaimer footer, the advice button, and the map's storm drawing in neutral colours.
// UAT_URL=http://localhost:5195/?test=1 node tests/uat/notwarning.mjs
import {
  ACTIONS, ACTIONS_SOURCE, BANNED_PHRASES, BTN_ADVICE, BULLETIN_HREF, BULLETIN_LINK_TEXT, BULLETIN_TEXT, CARD_SAFETY, CARDS,
  DISCLAIMER, HAI_PHONG, HCM, NOW_MS, PALETTE, T, TRACK, canvasShot, check, context, events, finish, inSettings, learnCards, norm, open,
  pickOption, runCheck, scenario, sel, skipOnboarding, text, url, visible, waitView, waitVisible,
} from './lib.mjs';

const SAFETY_TITLE = CARDS[2]; // 'Làm gì khi bão tới?'

/** SPEC 2.1 colour rule: HSL hue in 330°-30° with saturation above 35 % (alpha above 0.1 is checked by the caller). */
export const isRed = (r, g, b) => {
  const R = r / 255;
  const G = g / 255;
  const B = b / 255;
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const d = max - min;
  if (d === 0) return false;
  const l = (max + min) / 2;
  const s = d / (1 - Math.abs(2 * l - 1));
  let h;
  if (max === R) h = 60 * (((G - B) / d) % 6);
  else if (max === G) h = 60 * ((B - R) / d + 2);
  else h = 60 * ((R - G) / d + 4);
  h = (h + 360) % 360;
  return (h >= 330 || h <= 30) && s > 0.35;
};

async function openSheet(page) {
  if (!(await visible(page, 'assistant-sheet'))) {
    await T(page, 'assistant-avatar').first().click();
    await waitVisible(page, 'assistant-sheet');
  }
}
async function clickChip(page, id) {
  await openSheet(page);
  await page.locator(`[data-test="assistant-sheet"] [data-test="chip"][data-chip="${id}"]`).first().click();
  await page.waitForTimeout(500);
}

// ---------------------------------------------------------------- (a) no red in the DOM
/**
 * Every visible element (and its ::before / ::after when they have content), canvas and img left out: its computed
 * color, background-color, border-top/right/bottom/left-color and outline-color, and for SVG elements also the computed
 * fill and stroke, each painted on a 1x1 canvas to get sRGB and alpha (a fill such as "none" or "url(#g)" paints nothing).
 * Returns the ones that are red by SPEC 2.1 with alpha above 0.1.
 */
const redInDom = (page) =>
  page.evaluate((isRedSrc) => {
    const isRed = new Function(`return (${isRedSrc})`)();
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    const g = c.getContext('2d', { willReadFrequently: true });
    const cache = new Map();
    const rgba = (v) => {
      if (cache.has(v)) return cache.get(v);
      g.clearRect(0, 0, 1, 1);
      g.fillStyle = 'rgba(0, 0, 0, 0)';
      g.fillStyle = v;
      g.fillRect(0, 0, 1, 1);
      const d = g.getImageData(0, 0, 1, 1).data;
      const out = [d[0], d[1], d[2], d[3] / 255];
      cache.set(v, out);
      return out;
    };
    const PROPS = ['color', 'backgroundColor', 'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor', 'outlineColor'];
    const SVG_PROPS = ['fill', 'stroke'];
    const bad = [];
    let n = 0;
    const name = (e) => e.getAttribute('data-test') ?? `${e.tagName.toLowerCase()}${e.className && typeof e.className === 'string' ? `.${e.className.split(/\s+/)[0]}` : ''}`;
    for (const e of document.querySelectorAll('body, body *')) {
      if (e.tagName === 'CANVAS' || e.tagName === 'IMG') continue;
      const r = e.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (!e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
      n++;
      for (const pseudo of [null, '::before', '::after']) {
        const cs = getComputedStyle(e, pseudo);
        if (pseudo && (cs.content === 'none' || cs.content === 'normal')) continue;
        for (const p of pseudo || !(e instanceof SVGElement) ? PROPS : [...PROPS, ...SVG_PROPS]) {
          const [R, G, B, A] = rgba(cs[p]);
          if (A > 0.1 && isRed(R, G, B)) bad.push(`${name(e)}${pseudo ?? ''} ${p} ${cs[p]}`);
        }
      }
    }
    return { checked: n, bad };
  }, isRed.toString());

for (const scheme of ['light', 'dark']) {
  await scenario(`no red on the page after a verdict with the sheet open (1440x900 ${scheme})`, async () => {
    const ctx = await context({ geo: HAI_PHONG, colorScheme: scheme });
    const page = await open(ctx);
    await skipOnboarding(page);
    await runCheck(page);
    await page.waitForTimeout(1500);
    await openSheet(page);
    await page.waitForTimeout(500);
    const theme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    const r = await redInDom(page);
    check(`(${scheme}) no visible element or ::before/::after has a red color, background-color, border colour, outline-color or SVG fill/stroke (SPEC 2.1: hue 330°-30°, saturation > 35 %, alpha > 0.1; canvas and img left out)`, r.checked > 20 && r.bad.length === 0, `data-theme=${theme}; ${r.checked} elements; ${r.bad.length} red: ${r.bad.slice(0, 6).join(' | ')}`);
    await ctx.close();
  });
}

// ---------------------------------------------------------------- (a2) window.__app.palette
/** __app.palette as plain data, or the reason it cannot be read. */
const readPalette = (page) => page.evaluate(() => {
  const p = window.__app?.palette;
  return p && typeof p === 'object' ? { storm: p.storm, stormFill: p.stormFill, bulletin: p.bulletin } : { missing: String(p) };
});
const hexRgb = (h) => (/^#[0-9a-f]{6}$/i.test(h ?? '') ? [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) : null);
/** Each key equal to DESIGN.md 3 (6-digit hex, letter case ignored) and not red by SPEC 2.1. */
function paletteChecks(tag, got, want) {
  for (const k of ['storm', 'stormFill', 'bulletin']) {
    const ok = typeof got[k] === 'string' && got[k].toUpperCase() === want[k].toUpperCase();
    check(`${tag} __app.palette.${k} is ${want[k]} (DESIGN.md 3)`, ok, JSON.stringify(got));
    const rgb = hexRgb(got[k]);
    check(`${tag} __app.palette.${k} passes the no-red rule (SPEC 2.1)`, !!rgb && !isRed(...rgb), String(got[k]));
  }
}
for (const scheme of ['light', 'dark']) {
  await scenario(`__app.palette follows the theme (1440x900, ${scheme} colour scheme)`, async () => {
    const ctx = await context({ colorScheme: scheme });
    const page = await open(ctx);
    await skipOnboarding(page);
    paletteChecks(`(${scheme} on first visit)`, await readPalette(page), PALETTE[scheme]);
    // The other theme chosen in settings: the palette is for the current theme.
    const other = scheme === 'light' ? 'dark' : 'light';
    await inSettings(page, () => pickOption(page, sel('set-theme'), other === 'dark' ? 'Tối' : 'Sáng')).catch(() => {});
    await page.waitForTimeout(500);
    paletteChecks(`(${scheme} scheme, "${other === 'dark' ? 'Tối' : 'Sáng'}" chosen in settings)`, await readPalette(page), PALETTE[other]);
    await ctx.close();
  });
}

// ---------------------------------------------------------------- (b) no commands outside the quoted advice
/**
 * document.body.innerText, case and whitespace folded, with the quoted official advice taken out where SPEC 2.1 allows
 * it: inside the "Làm gì khi bão tới?" card body and (when `prepareShown`) the prepare chip's assistant-answer. Only the
 * approved lines (SPEC 10.3 actions, the card's SOURCES.md items, the source line) are taken out of those two places;
 * any other text in them is still checked. Returns the banned phrases found.
 */
async function bannedOnScreen(page, prepareShown) {
  // Longest first, so a heading ("Sau bão") is not cut out of an item that starts with it.
  const quoted = [...ACTIONS, ...CARD_SAFETY.body, ACTIONS_SOURCE].map((s) => norm(s).normalize('NFC')).sort((a, b) => b.length - a.length);
  const r = await page.evaluate(({ title, quoted, prepareShown }) => {
    const norm = (s) => (s ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
    let body = norm(document.body.innerText);
    const places = [];
    const learn = document.querySelector('[data-test="learn"]');
    for (const src of learn?.querySelectorAll('[data-test="learn-source"]') ?? []) {
      let card = src;
      while (card.parentElement && card.parentElement !== learn && card.parentElement.querySelectorAll('[data-test="learn-source"]').length === 1) card = card.parentElement;
      if (norm(card.textContent).includes(title)) places.push(card);
    }
    if (prepareShown) places.push(document.querySelector('[data-test="assistant-answer"]'));
    const missing = [];
    for (const e of places) {
      if (!e) continue;
      const t = norm(e.innerText);
      if (!t) continue;
      let left = t;
      for (const q of quoted) left = left.split(q).join(' ');
      if (!body.includes(t)) missing.push(t.slice(0, 40));
      body = body.split(t).join(` ${left} `);
    }
    return { body, missing };
  }, { title: SAFETY_TITLE, quoted, prepareShown });
  const low = r.body.toLocaleLowerCase('vi');
  const hits = BANNED_PHRASES.filter((p) => low.includes(p.normalize('NFC').toLocaleLowerCase('vi')));
  const ctxOf = (p) => {
    const i = low.indexOf(p.normalize('NFC').toLocaleLowerCase('vi'));
    return i < 0 ? '' : `"…${r.body.slice(Math.max(0, i - 40), i + p.length + 20)}…"`;
  };
  return { hits, detail: hits.map(ctxOf).join(' | ') + (r.missing.length ? ` (advice block text not found in body.innerText: ${r.missing.join(', ')})` : '') };
}
async function bannedCheck(page, tag, prepareShown = false) {
  const b = await bannedOnScreen(page, prepareShown);
  check(`${tag} no "${BANNED_PHRASES.join('", "')}" in the visible text outside the quoted official advice`, b.hits.length === 0, b.detail);
}

await scenario('no command words on screen (1440x900, full mode)', async () => {
  const ctx = await context({ geo: HAI_PHONG });
  const page = await open(ctx, url({ mode: 'full' }));
  await bannedCheck(page, '(onboarding open)');
  await skipOnboarding(page);
  await bannedCheck(page, '(on load, cards shown)');
  await runCheck(page);
  await page.waitForTimeout(1000);
  await bannedCheck(page, '(affected verdict)');
  await clickChip(page, 'prepare');
  await bannedCheck(page, '(prepare chip answer shown)', true);
  await clickChip(page, 'when');
  await bannedCheck(page, '(when chip answer shown)');
  await clickChip(page, 'windlevel');
  await bannedCheck(page, '(windlevel chip answer shown)');
  await page.keyboard.press('Escape');
  await page.evaluate(([lat, lon]) => window.__app.setPlace(lat, lon, 'TP. Hồ Chí Minh'), [HCM.latitude, HCM.longitude]);
  await page.waitForTimeout(1000);
  await bannedCheck(page, '(unaffected verdict)');
  await ctx.close();
});

await scenario('no command words on screen (375x812, easy mode)', async () => {
  const ctx = await context({ phone: true, geo: HCM });
  const page = await open(ctx);
  await skipOnboarding(page);
  await runCheck(page);
  await page.waitForTimeout(1000);
  await bannedCheck(page, '(375 unaffected verdict)');
  await T(page, 'learn').first().getByText('Tìm hiểu thêm', { exact: true }).first().click().catch(() => {});
  await page.waitForTimeout(400);
  await bannedCheck(page, '(375 "Tìm hiểu thêm" open)');
  await ctx.close();
});

// ---------------------------------------------------------------- (c) nothing pops up by itself
/**
 * Init-free watcher: `snap()` records the visible elements as signatures (tag, data-test, class, first 80 characters of
 * text), so a panel the app redraws with the same content does not count as new. `watch(ms)` then lists every visible
 * element whose signature was not there before, outside the verdict card and the map pin (the answer to the click).
 */
const SNAP = () => {
  const norm = (s) => (s ?? '').replace(/\s+/g, ' ').trim();
  window.__uatSig = (e) => `${e.tagName}|${e.getAttribute('data-test') ?? ''}|${typeof e.className === 'string' ? e.className : ''}|${norm(e.textContent).slice(0, 80)}`;
  window.__uatShown = (e) => {
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
  };
  window.__uatBase = new Set([...document.querySelectorAll('body *')].filter(window.__uatShown).map(window.__uatSig));
};
const watchNew = (page, ms) =>
  page.evaluate(async (ms) => {
    const found = new Map();
    const allowed = (e) => !!e.closest('[data-test="verdict"], [data-test="place-pin"]');
    for (const t0 = performance.now(); performance.now() - t0 < ms; await new Promise((r) => setTimeout(r, 200))) {
      for (const e of document.querySelectorAll('body *')) {
        if (allowed(e) || !window.__uatShown(e)) continue;
        const s = window.__uatSig(e);
        if (!window.__uatBase.has(s) && !found.has(s)) found.set(s, Math.round(performance.now() - t0));
      }
    }
    return [...found].map(([s, t]) => `${t}ms ${s.slice(0, 90)}`);
  }, ms);

for (const phone of [false, true]) {
  const tag = phone ? '(375)' : '(1440)';
  await scenario(`nothing pops up by itself for 10 s after a verdict ${tag}`, async () => {
    const ctx = await context({ phone, geo: HAI_PHONG });
    const page = await open(ctx);
    await skipOnboarding(page);
    check(`${tag} no assistant-warning element on the page (SPEC 6.4)`, (await T(page, 'assistant-warning').count()) === 0);
    await page.waitForTimeout(500);
    await page.evaluate(SNAP);
    await runCheck(page);
    const fresh = await watchNew(page, 10000);
    check(`${tag} in the 10 s after an affected verdict, no element appears outside the verdict card and the pin (no pop-up)`, fresh.length === 0, fresh.slice(0, 5).join(' || '));
    check(`${tag} no assistant-warning element 10 s after the verdict`, (await T(page, 'assistant-warning').count()) === 0);
    check(`${tag} the assistant sheet and answer stay closed (Usui-chan does not speak unprompted)`, !(await visible(page, 'assistant-sheet')) && !(await visible(page, 'assistant-answer')));
    const ev = (await events(page)).filter((e) => e.type === 'assistant_warning_shown');
    check(`${tag} no assistant_warning_shown event is logged (SPEC 7 no longer has it)`, ev.length === 0, JSON.stringify(ev));
    await ctx.close();
  });
}

// ---------------------------------------------------------------- (d) official bulletin, (e) disclaimer footer
const boxOf = (page, id) => T(page, id).first().boundingBox().catch(() => null);
for (const phone of [false, true]) {
  for (const mode of ['easy', 'full']) {
    const tag = `(${phone ? '375' : '1440'} ${mode})`;
    await scenario(`official bulletin and disclaimer ${tag}`, async () => {
      const ctx = await context({ phone, geo: HAI_PHONG });
      const page = await open(ctx, url({ mode }));
      await skipOnboarding(page);
      const vw = page.viewportSize().width;
      check(`${tag} official-bulletin is visible in the map view`, await visible(page, 'official-bulletin'));
      const bt = norm(await T(page, 'official-bulletin').first().textContent().catch(() => ''));
      check(`${tag} official-bulletin reads "${BULLETIN_TEXT}"`, bt === BULLETIN_TEXT, bt);
      const links = T(page, 'official-bulletin').first().locator('a');
      const link = await links.evaluateAll((as) => as.map((a) => ({ text: a.textContent.replace(/\s+/g, ' ').trim(), href: a.getAttribute('href'), target: a.getAttribute('target'), rel: a.getAttribute('rel') }))).catch(() => []);
      const L = link[0];
      let sameUrl = false;
      try {
        sameUrl = new URL(L.href).href === new URL(BULLETIN_HREF).href;
      } catch {}
      check(`${tag} official-bulletin has one link, on the centre's name "${BULLETIN_LINK_TEXT}"`, link.length === 1 && L.text === BULLETIN_LINK_TEXT, JSON.stringify(link));
      check(`${tag} the link goes to ${BULLETIN_HREF} with target="_blank" and rel="noopener"`, !!L && sameUrl && L.target === '_blank' && /(^|\s)noopener(\s|$)/.test(L.rel ?? ''), JSON.stringify(L));
      // SPEC 6.1: directly under the top bar, above the map and panel, full width. The top bar is read as the boxes of
      // title, btn-source and btn-settings. "Full width": within 16 px of both edges (our threshold).
      const b = await boxOf(page, 'official-bulletin');
      const bar = (await Promise.all(['title', 'btn-source', 'btn-settings'].map((id) => boxOf(page, id)))).filter(Boolean);
      const barBottom = Math.max(...bar.map((x) => x.y + x.height));
      check(`${tag} official-bulletin sits under the top bar (title, btn-source, btn-settings)`, !!b && bar.length === 3 && b.y >= barBottom - 1, `${JSON.stringify(b)} / bar bottom ${barBottom}`);
      const g = await boxOf(page, 'globe');
      const sum = await boxOf(page, 'storm-summary');
      check(`${tag} official-bulletin sits above the map and the panel (globe and storm-summary below it)`, !!b && !!g && !!sum && g.y >= b.y + b.height - 1 && sum.y >= b.y + b.height - 1, `${JSON.stringify(b)} / globe ${JSON.stringify(g)} / summary ${JSON.stringify(sum)}`);
      check(`${tag} official-bulletin is full width (within 16 px of both edges, our threshold)`, !!b && b.x <= 16 && b.x + b.width >= vw - 16, `${JSON.stringify(b)} in ${vw}`);
      // SPEC 6.1 footer.
      check(`${tag} disclaimer is visible`, await visible(page, 'disclaimer'));
      const dt = norm(await T(page, 'disclaimer').first().textContent().catch(() => ''));
      check(`${tag} disclaimer reads "${DISCLAIMER}"`, dt === DISCLAIMER, dt);
      const fs = await page.evaluate(() => {
        const e = document.querySelector('[data-test="disclaimer"]');
        return e ? { el: parseFloat(getComputedStyle(e).fontSize), root: parseFloat(getComputedStyle(document.documentElement).fontSize) } : null;
      });
      check(`${tag} disclaimer is in small text (font size below the root font size, our threshold)`, !!fs && fs.el < fs.root, JSON.stringify(fs));
      await runCheck(page);
      await page.waitForTimeout(800);
      check(`${tag} official-bulletin and disclaimer are still visible with the verdict open`, (await visible(page, 'official-bulletin')) && (await visible(page, 'disclaimer')));
      // Every view except the satellite close-up.
      await T(page, 'btn-source').first().click();
      await waitView(page, 'satellite', 3000).catch(() => {});
      await page.waitForTimeout(1500);
      check(`${tag} official-bulletin, shown on the map, is hidden in the satellite view`, (await T(page, 'official-bulletin').count()) > 0 && (await page.evaluate(() => window.__app.view)) === 'satellite' && !(await visible(page, 'official-bulletin')));
      const ds = norm(await page.locator(`${sel('disclaimer')}:visible`).first().textContent({ timeout: 1000 }).catch(() => ''));
      check(`${tag} disclaimer is visible in the satellite view, reading "${DISCLAIMER}"`, (await page.evaluate(() => window.__app.view)) === 'satellite' && ds === DISCLAIMER, ds);
      await T(page, 'btn-back').first().click();
      await waitView(page, 'map', 3000).catch(() => {});
      await page.waitForTimeout(1500);
      check(`${tag} official-bulletin is visible again back on the map`, await visible(page, 'official-bulletin'));
      await ctx.close();
    });
  }
}

// ---------------------------------------------------------------- (f) btn-advice
/** The "Làm gì khi bão tới?" card: shown, and whether the focused element is its heading. */
const adviceState = (page) =>
  page.evaluate(({ title }) => {
    const norm = (s) => (s ?? '').replace(/\s+/g, ' ').trim();
    const learn = document.querySelector('[data-test="learn"]');
    let card = null;
    for (const src of learn?.querySelectorAll('[data-test="learn-source"]') ?? []) {
      let c = src;
      while (c.parentElement && c.parentElement !== learn && c.parentElement.querySelectorAll('[data-test="learn-source"]').length === 1) c = c.parentElement;
      if (norm(c.textContent).includes(title)) card = c;
    }
    const src = card?.querySelector('[data-test="learn-source"]');
    const shown = !!src && src.getClientRects().length > 0 && getComputedStyle(src).visibility !== 'hidden';
    const a = document.activeElement;
    const at = a ? norm(a.textContent) : '';
    // The heading: an element in the card whose text is the title (with at most 10 more characters, e.g. a marker).
    const heading = !!card && !!a && card.contains(a) && at.includes(title) && at.length <= title.length + 10;
    return { found: !!card, shown, focus: a ? `${a.tagName.toLowerCase()} "${at.slice(0, 50)}"` : null, heading };
  }, { title: SAFETY_TITLE });

for (const [phone, mode, geo, label] of [[true, 'easy', HAI_PHONG, 'affected'], [false, 'full', HCM, 'unaffected']]) {
  const tag = `(${phone ? '375' : '1440'} ${mode}, ${label})`;
  await scenario(`btn-advice opens "${SAFETY_TITLE}" ${tag}`, async () => {
    const ctx = await context({ phone, geo });
    const page = await open(ctx, url({ mode }));
    await skipOnboarding(page);
    await runCheck(page);
    await page.waitForTimeout(800);
    const adv = await text(page, 'btn-advice').catch(() => '');
    check(`${tag} btn-advice is visible and reads "${BTN_ADVICE}"`, (await visible(page, 'btn-advice')) && adv === BTN_ADVICE, adv);
    if (mode === 'easy') {
      const before = await learnCards(page);
      check(`${tag} before the press, the cards are still collapsed into "Tìm hiểu thêm"`, !!before && before.every((c) => !c.shown), JSON.stringify(before));
    }
    const n0 = (await events(page)).filter((e) => e.type === 'learn_open').length;
    const pressed = await T(page, 'btn-advice').first().click({ timeout: 3000 }).then(() => true, () => false);
    await page.waitForTimeout(600);
    const st = await adviceState(page);
    check(`${tag} pressing btn-advice opens the "${SAFETY_TITLE}" card${mode === 'easy' ? ' (expanding "Tìm hiểu thêm" first)' : ''}`, pressed && st.found && st.shown, `pressed ${pressed}; ${JSON.stringify(st)}`);
    check(`${tag} btn-advice moves focus to the card's heading`, st.heading, JSON.stringify(st));
    const lo = (await events(page)).filter((e) => e.type === 'learn_open').slice(n0);
    check(`${tag} btn-advice logs learn_open with { card: "prepare" }`, lo.some((e) => e.data?.card === 'prepare'), JSON.stringify(lo));
    await ctx.close();
  });
}

// ---------------------------------------------------------------- (g) the storm drawn in neutral colours
/**
 * Where the strong-wind area and the storm marker are on screen. The marker is the storm-marker box (SPEC 6.2). The area
 * has no hook, so its points are found through the pin: for each quadrant whose 34-kt radius at now is above 0, a point
 * at half that radius from the centre (bearing 45°, 135°, 225°, 315°) is given to __app.setPlace and the place-pin's
 * centre is read; the view is fixed (SPEC 6.2), so it is where that point is drawn. The pin is then moved far away
 * (Hà Nội) and hidden for the screenshot, which is taken in reduced motion.
 */
function destination(lat, lon, bearingDeg, km, R = 6371) {
  const RAD = Math.PI / 180;
  const d = km / R;
  const b = bearingDeg * RAD;
  const p1 = lat * RAD;
  const l1 = lon * RAD;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return { lat: p2 / RAD, lon: l2 / RAD };
}
/** Pixels of a PNG at the given screen points (each a square of side 2*half+1), as [r, g, b]. */
const pixelsAt = (page, png, origin, points, half) =>
  page.evaluate(async ({ b64, origin, points, half }) => {
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const bmp = await createImageBitmap(new Blob([bin], { type: 'image/png' }));
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const g = c.getContext('2d');
    g.drawImage(bmp, 0, 0);
    const d = g.getImageData(0, 0, bmp.width, bmp.height).data;
    const out = [];
    for (const p of points) {
      const cx = Math.round(p.x - origin.x);
      const cy = Math.round(p.y - origin.y);
      for (let y = cy - half; y <= cy + half; y++) for (let x = cx - half; x <= cx + half; x++) {
        if (x < 0 || y < 0 || x >= bmp.width || y >= bmp.height) continue;
        const i = (y * bmp.width + x) * 4;
        out.push([d[i], d[i + 1], d[i + 2]]);
      }
    }
    return out;
  }, { b64: png.toString('base64'), origin, points, half });

for (const scheme of ['light', 'dark']) {
  await scenario(`the storm marker and strong-wind area are not red (1440x900 ${scheme}, reduced motion)`, async () => {
    if (!TRACK) return check('yagi.json loads', false);
    const ctx = await context({ colorScheme: scheme, reducedMotion: 'reduce' });
    const page = await open(ctx);
    await skipOnboarding(page);
    const now = TRACK.points.find((p) => Date.parse(p.t) === NOW_MS);
    const g = await boxOf(page, 'globe');
    const area = [];
    for (const [q, brg] of [['ne', 45], ['se', 135], ['sw', 225], ['nw', 315]]) {
      const r = now?.r34nm?.[q];
      if (!(r > 0)) continue;
      const p = destination(now.lat, now.lon, brg, 0.5 * r * 1.852);
      await page.evaluate((p) => window.__app.setPlace(p.lat, p.lon, 'x'), p);
      await page.waitForTimeout(600);
      const pin = await boxOf(page, 'place-pin');
      if (pin) area.push({ q, x: pin.x + pin.width / 2, y: pin.y + pin.height / 2 });
    }
    check(`(${scheme}) found the screen points inside the strong-wind area (one per quadrant with a radius at now, inside the globe)`, area.length > 0 && area.every((p) => !!g && p.x >= g.x && p.x <= g.x + g.width && p.y >= g.y && p.y <= g.y + g.height), JSON.stringify(area));
    await page.evaluate(() => window.__app.setPlace(21.0285, 105.8542, 'Hà Nội'));
    await page.waitForTimeout(600);
    await page.addStyleTag({ content: '[data-test="place-pin"] { visibility: hidden !important; }' });
    await page.waitForTimeout(300);
    const m = await boxOf(page, 'storm-marker');
    const png = await canvasShot(page);
    const origin = await page.evaluate(() => {
      let best = null;
      for (const c of document.querySelectorAll('canvas')) {
        const r = c.getBoundingClientRect();
        const x = Math.max(0, r.left);
        const y = Math.max(0, r.top);
        const w = Math.min(innerWidth, r.right) - x;
        const h = Math.min(innerHeight, r.bottom) - y;
        if (w > 0 && h > 0 && getComputedStyle(c).visibility !== 'hidden' && (!best || w * h > best.w * best.h)) best = { x, y, w, h };
      }
      return best;
    });
    const red = (px) => px.filter(([r, gg, b]) => isRed(r, gg, b));
    const mean = (px) => (px.length ? px.reduce((a, p) => a.map((v, i) => v + p[i] / px.length), [0, 0, 0]).map(Math.round) : null);
    const areaPx = await pixelsAt(page, png, origin, area, 3);
    const ra = red(areaPx);
    check(`(${scheme}) no red pixel in the strong-wind area (7x7 px around each point; SPEC 2.1 hue 330°-30°, saturation > 35 %)`, areaPx.length > 0 && ra.length === 0, `${ra.length}/${areaPx.length} red, mean ${JSON.stringify(mean(areaPx))}, e.g. ${JSON.stringify(ra.slice(0, 3))}`);
    const half = m ? Math.min(32, Math.floor(Math.min(m.width, m.height) / 2)) : 0;
    const markPx = m ? await pixelsAt(page, png, origin, [{ x: m.x + m.width / 2, y: m.y + m.height / 2 }], half) : [];
    const rm = red(markPx);
    check(`(${scheme}) no red pixel on the storm marker (the storm-marker box, up to 65x65 px around its centre)`, markPx.length > 0 && rm.length === 0, `${rm.length}/${markPx.length} red, mean ${JSON.stringify(mean(markPx))}, e.g. ${JSON.stringify(rm.slice(0, 3))}; marker ${JSON.stringify(m)}`);
    await ctx.close();
  });
}

await finish();
