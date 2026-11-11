// UAT, SPEC 6.2 / 6.3 / 6.5 / 7: easy mode (default) and full mode, timeline, knowledge cards, slider log.
// UAT_URL=http://localhost:5195/?test=1 node tests/uat/modes.mjs
import { SAME_PX, canvasShot, centreInside, pixelDiff, CARDS, CARDS_APPROVED, CARD_SAFETY_SECTIONS, CONE, CONE_LEGEND, HAI_PHONG, headAffected, trackAt, waitVisible, NOW_MS, learnCards, PROVINCES, SETTINGS_KEY, T, TIME_RE, TRACK, check, chosenOption, context, events, finish, inSettings, norm, onTop, open, parseKm, pickOption, ready, refVerdict, reload, scenario, sel, skipOnboarding, text, url, visible, vnTime } from './lib.mjs';

const HALF_HOUR = 30 * 60 * 1000;
const stored = (page) => page.evaluate((k) => localStorage.getItem(k), SETTINGS_KEY);

function cardChecks(cards, tag) {
  check(`${tag} 3 knowledge cards titled "${CARDS.join('", "')}"`, !!cards && cards.length === 3 && CARDS.every((t) => cards.some((c) => c.title === t)), JSON.stringify(cards?.map((c) => c.title)));
  check(`${tag} each knowledge card has a body and a non-empty source line`, !!cards && cards.length === 3 && cards.every((c) => c.body.length > 0 && c.source.length > 0), JSON.stringify(cards));
  // SPEC 10.1-10.3: each card's body holds its approved text word for word, in order, and ends with its source line.
  for (const want of CARDS_APPROVED) {
    const got = cards?.find((c) => c.title === want.title);
    const body = got?.body ?? '';
    const missing = want.body.filter((b) => !body.includes(norm(b)));
    check(`${tag} card "${want.title}" body has every approved line of SPEC 10, word for word`, !!got && missing.length === 0, missing.map((m) => m.slice(0, 50)).join(' | '));
    const idx = want.body.map((b) => body.indexOf(norm(b)));
    check(`${tag} card "${want.title}" lines are in SPEC order`, !!got && idx.every((x, i) => x >= 0 && (i === 0 || x > idx[i - 1])), idx.join(','));
    check(`${tag} card "${want.title}" source line = "${want.source}"`, got?.source === want.source, got?.source ?? '');
  }
  const safety = cards?.find((c) => c.title === 'Làm gì khi bão tới?')?.body ?? '';
  check(`${tag} card "Làm gì khi bão tới?" has the headings ${CARD_SAFETY_SECTIONS.map((x) => `"${x.heading}"`).join(', ')}`, CARD_SAFETY_SECTIONS.every((x) => safety.includes(x.heading)));
}

// Expected timeline rows, from the tests' own SPEC 5 rule on yagi.json; two Earth radii so either common one passes.
const REF = TRACK && PROVINCES.length ? PROVINCES.map((p) => ({ p, a: refVerdict(p, TRACK, NOW_MS, 6371), b: refVerdict(p, TRACK, NOW_MS, 6378.137) })) : [];
const nameIn = (rowText) => [...PROVINCES].sort((x, y) => y.name.length - x.name.length).find((p) => rowText.includes(p.name)) ?? null;
const near = (x, y, tol) => x !== null && y !== null && Math.abs(x - y) <= tol;

async function timelineChecks(page, tag) {
  check(`${tag} timeline is visible`, await visible(page, 'timeline'));
  const rows = await T(page, 'timeline-row').evaluateAll((rs) => rs.map((r) => ({ aff: r.getAttribute('data-affected'), text: r.textContent.replace(/\s+/g, ' ').trim() })));
  check(`${tag} timeline has one row per province (34)`, rows.length === 34, `${rows.length}`);
  const firstFalse = rows.findIndex((r) => r.aff === 'false');
  const grouped = rows.length > 0 && rows.every((r) => r.aff === 'true' || r.aff === 'false') && (firstFalse === -1 || rows.slice(firstFalse).every((r) => r.aff === 'false'));
  check(`${tag} affected rows come first`, grouped && rows[0]?.aff === 'true', rows.map((r) => r.aff).join(','));
  if (!REF.length) return check(`${tag} provinces.json and yagi.json load for the expected timeline`, false);

  const named = rows.map((r) => ({ ...r, ref: REF.find((x) => x.p === nameIn(r.text)) ?? null }));
  check(`${tag} every province in provinces.json appears exactly once by name`, new Set(named.map((r) => r.ref?.p.id)).size === 34 && named.every((r) => r.ref), named.filter((r) => !r.ref).map((r) => r.text).join(' | '));
  const known = named.filter((r) => r.ref);
  const flagBad = known.filter((r) => (r.aff === 'true') !== r.ref.a.affected && (r.aff === 'true') !== r.ref.b.affected);
  check(`${tag} each row's data-affected matches the SPEC 5 rule on the real track`, flagBad.length === 0, flagBad.map((r) => r.ref.p.name).join(', '));

  const aff = known.filter((r) => r.aff === 'true');
  const un = known.filter((r) => r.aff === 'false');
  const firstOf = (r) => r.ref.a.firstInside ?? r.ref.b.firstInside;
  const orderA = aff.every((r, i) => i === 0 || firstOf(r) >= firstOf(aff[i - 1]) - HALF_HOUR);
  check(`${tag} affected rows are ordered by firstInside, earliest first`, orderA, aff.map((r) => `${r.ref.p.name} ${firstOf(r) ? vnTime(firstOf(r)) : '-'}`).join(' | '));
  const distOf = (r) => r.ref.a.closest.distanceKm;
  const orderU = un.every((r, i) => i === 0 || distOf(r) >= distOf(un[i - 1]) * 0.99);
  check(`${tag} unaffected rows are ordered by closest distance`, orderU, un.map((r) => `${r.ref.p.name} ${Math.round(distOf(r))}`).join(' | '));

  const timeOk = (shown, refMs) => refMs !== null && [refMs - HALF_HOUR, refMs, refMs + HALF_HOUR].some((x) => vnTime(x) === shown);
  const badA = aff.filter((r) => {
    const m = r.text.match(/(\d{2}:\d{2}, \d{2}\/\d{2}) – (\d{2}:\d{2}, \d{2}\/\d{2})/);
    const v = r.ref.a.affected ? r.ref.a : r.ref.b;
    return !m || !timeOk(m[1], v.firstInside) || !timeOk(m[2], v.lastInside);
  });
  check(`${tag} affected rows show "{firstInside} – {lastInside}" in Vietnam time`, aff.length > 0 && badA.length === 0, badA.slice(0, 4).map((r) => r.text).join(' | '));
  const badU = un.filter((r) => {
    const m = r.text.match(/cách (\d[\d.,\s]*?) km/);
    return !m || !near(parseKm(m[1]), distOf(r), Math.max(1, distOf(r) * 0.01));
  });
  check(`${tag} unaffected rows show "cách {km} km" with the closest distance`, badU.length === 0, badU.slice(0, 4).map((r) => `${r.text} (want ~${Math.round(distOf(r))})`).join(' | '));

  // Tapping a row selects that province as the place.
  const first = known[0];
  await T(page, 'timeline-row').first().click();
  await page.waitForFunction((n) => (document.querySelector('[data-test="verdict-head"]')?.textContent ?? '').includes(n), first?.ref.p.name, { timeout: 10000 }).catch(() => {});
  const head = await text(page, 'verdict-head');
  check(`${tag} tapping the first timeline row shows the verdict for ${first?.ref.p.name}`, !!first && head === headAffected(first.ref.p.name), head);
  const v = await page.evaluate(() => window.__app.verdict);
  const want = first?.ref.a.affected ? first.ref.a : first?.ref.b;
  check(`${tag} after tapping the row, __app.verdict is that province's verdict`, v?.affected === true && !!want && near(new Date(v.firstInside).getTime(), want.firstInside, HALF_HOUR), JSON.stringify(v));
}

async function sliderInput(page) {
  const range = T(page, 'time-slider').first();
  return (await range.evaluate((e) => e.tagName)) === 'INPUT' ? range : range.locator('input[type=range]').first();
}

async function fullModeChecks(page, tag) {
  check(`${tag} time-slider is visible`, await visible(page, 'time-slider'));
  const kind = await T(page, 'time-slider').first().evaluate((e) => (e.tagName === 'INPUT' ? e.type : e.querySelector('input')?.type ?? null)).catch(() => null);
  check(`${tag} time-slider is a native input type=range`, kind === 'range', String(kind));
  const r0 = await text(page, 'time-readout');
  check(`${tag} time-readout starts at now: "07:00, 05/09"`, r0 === '07:00, 05/09' || r0.endsWith('07:00, 05/09'), r0);
  const input = await sliderInput(page);
  const { min, max, value } = await input.evaluate((e) => ({ min: +e.min, max: +e.max, value: +e.value }));
  const stepSize = +((await input.getAttribute('step')) ?? 1) || 1;
  const steps = (max - min) / stepSize;
  check(`${tag} the slider spans first to last point in 3-hour steps (80 steps)`, steps === 80, `min=${min} max=${max} step=${await input.getAttribute('step')}`);
  // SPEC 6.2 "starts at now": 30/08 12:00 UTC to 05/09 00:00 UTC is 44 steps of 3 hours.
  check(`${tag} the slider value starts at now (44 steps of 3 h after the first point)`, (value - min) / stepSize === 44, `min=${min} value=${value} step=${stepSize}`);
  // SPEC 6.2: the slider moves the storm marker.
  const g = await T(page, 'globe').first().boundingBox().catch(() => null);
  const m0 = await T(page, 'storm-marker').first().boundingBox().catch(() => null);
  check(`${tag} storm-marker is visible and sits inside the globe`, (await visible(page, 'storm-marker')) && centreInside(m0, g), `${JSON.stringify(m0)} in ${JSON.stringify(g)}`);
  await input.fill(String(value + 8 * stepSize)); // now + 24 h
  await page.waitForTimeout(600);
  const m1 = await T(page, 'storm-marker').first().boundingBox().catch(() => null);
  const moved = !!m0 && !!m1 && Math.hypot(m1.x + m1.width / 2 - (m0.x + m0.width / 2), m1.y + m1.height / 2 - (m0.y + m0.height / 2)) > 2;
  check(`${tag} moving the slider 24 h on moves storm-marker on screen`, moved, `${JSON.stringify(m0)} -> ${JSON.stringify(m1)}`);
  await input.fill(String(max));
  await page.waitForTimeout(300);
  const r1 = await text(page, 'time-readout');
  check(`${tag} moving the slider to the end updates time-readout to the last point (19:00, 09/09)`, r1 !== r0 && (r1 === '19:00, 09/09' || r1.endsWith('19:00, 09/09')), `${r0} -> ${r1}`);
  await input.fill(String(min));
  await page.waitForTimeout(300);
  const r2 = await text(page, 'time-readout');
  check(`${tag} moving it to the start shows the first point (19:00, 30/08)`, r2.endsWith('19:00, 30/08') && TIME_RE.test(r2.slice(-12)), r2);
  await input.fill(String(value));
  check(`${tag} demo-label is visible and not covered in full mode`, (await visible(page, 'demo-label')) && (await onTop(page, 'demo-label')));
  await timelineChecks(page, tag);
}

// SPEC 6.2 + 8: three 70% circles at now + 24/48/72 h, centred on the interpolated track, radii 86/148/217 km.
async function coneChecks(page, tag) {
  const cone = await page.evaluate(() => window.__app.cone ?? null);
  check(`${tag} __app.cone is an array of 3`, Array.isArray(cone) && cone.length === 3, JSON.stringify(cone));
  if (!Array.isArray(cone)) return;
  for (const want of CONE) {
    const c = cone.find((x) => x?.hours === want.hours);
    const at = TRACK ? trackAt(TRACK, NOW_MS + want.hours * 3600 * 1000) : null;
    check(`${tag} cone +${want.hours} h has radiusKm ${want.radiusKm} exactly`, c?.radiusKm === want.radiusKm, JSON.stringify(c));
    check(`${tag} cone +${want.hours} h is centred on the track position at now + ${want.hours} h (within 1e-6°)`, !!c && !!at && Math.abs(c.lat - at.lat) <= 1e-6 && Math.abs(c.lon - at.lon) <= 1e-6, `${JSON.stringify(c)} vs ${JSON.stringify(at)}`);
  }
  check(`${tag} cone entries are ordered +24, +48, +72 h`, JSON.stringify(cone.map((x) => x?.hours)) === '[24,48,72]', JSON.stringify(cone.map((x) => x?.hours)));
  await waitVisible(page, 'cone-legend', 3000).catch(() => {});
  const legend = norm(await T(page, 'cone-legend').first().textContent().catch(() => ''));
  check(`${tag} cone-legend is visible and reads "${CONE_LEGEND}"`, (await visible(page, 'cone-legend')) && legend === CONE_LEGEND, legend);
}

await scenario('easy mode is the default (375x812)', async () => {
  const ctx = await context({ phone: true });
  const page = await open(ctx);
  await skipOnboarding(page);
  check('(375) no time-slider in easy mode', !(await visible(page, 'time-slider')));
  check('(375) timeline hidden in easy mode', !(await visible(page, 'timeline')));
  let cards = await learnCards(page);
  const learnText = norm(await T(page, 'learn').first().textContent().catch(() => ''));
  check('(375) knowledge cards are collapsed into one "Tìm hiểu thêm" disclosure', learnText.includes('Tìm hiểu thêm') && !!cards && cards.every((c) => !c.shown), JSON.stringify(cards));
  await T(page, 'learn').first().getByText('Tìm hiểu thêm', { exact: true }).first().click();
  await page.waitForTimeout(400);
  cards = await learnCards(page);
  check('(375) opening "Tìm hiểu thêm" shows the 3 cards with their source lines', !!cards && cards.length === 3 && cards.every((c) => c.shown), JSON.stringify(cards));
  cardChecks(cards, '(375 easy)');
  // SPEC 7: learn_open with { card }. SPEC does not say which press logs it, so if opening "Tìm hiểu thêm"
  // logged none, each card title that is itself a summary or button is pressed once.
  const learnOpens = async () => (await events(page)).filter((e) => e.type === 'learn_open');
  if ((await learnOpens()).length === 0) {
    for (const title of CARDS) {
      const t = T(page, 'learn').first().locator('summary, button').filter({ hasText: title }).first();
      if (await t.isVisible().catch(() => false)) await t.click().catch(() => {});
    }
    await page.waitForTimeout(300);
  }
  const lo = await learnOpens();
  check('(375) opening the knowledge cards logs learn_open with a non-empty { card }', lo.length > 0 && lo.every((e) => e.data && e.data.card !== undefined && e.data.card !== null && String(e.data.card).length > 0), JSON.stringify(lo));
  // SPEC 6.2 easy mode: the marker shows the storm at now and the camera is locked, so the marker stays put.
  const g = await T(page, 'globe').first().boundingBox().catch(() => null);
  const m0 = await T(page, 'storm-marker').first().boundingBox().catch(() => null);
  check('(375) storm-marker is visible and sits inside the globe', (await visible(page, 'storm-marker')) && centreInside(m0, g), `${JSON.stringify(m0)} in ${JSON.stringify(g)}`);
  await page.waitForTimeout(1000);
  const m1 = await T(page, 'storm-marker').first().boundingBox().catch(() => null);
  check('(375) storm-marker stays put in easy mode (same box 1 s later, within 1 px)', !!m0 && !!m1 && Math.abs(m0.x - m1.x) <= 1 && Math.abs(m0.y - m1.y) <= 1, `${JSON.stringify(m0)} -> ${JSON.stringify(m1)}`);
  await coneChecks(page, '(375 easy)');
  await inSettings(page, async () => {
    const m = await chosenOption(page, sel('set-mode'));
    check('(375) set-mode shows "Dễ dùng" as chosen on a fresh load', m === 'Dễ dùng', String(m));
  });
  await ctx.close();
});

await scenario('full mode via settings (1440x900)', async () => {
  const ctx = await context({ geo: HAI_PHONG });
  const page = await open(ctx);
  await skipOnboarding(page);
  const s0 = await stored(page);
  await inSettings(page, () => pickOption(page, sel('set-mode'), 'Đầy đủ'));
  await page.waitForTimeout(300);
  const s1 = await stored(page);
  check(`(set-mode) choosing "Đầy đủ" changes the saved ${SETTINGS_KEY}`, !!s1 && s1 !== s0, `${s0} -> ${s1}`);
  await fullModeChecks(page, '(set-mode)');
  await coneChecks(page, '(full)');
  const cards = await learnCards(page);
  check('(set-mode) the 3 knowledge cards each show a source line', !!cards && cards.length === 3 && cards.every((c) => c.shown), JSON.stringify(cards));
  cardChecks(cards, '(full)');
  // SPEC 10: each source line is "shown in small text": smaller than the page's base (root) font size.
  const fs = await page.evaluate(() => {
    const root = parseFloat(getComputedStyle(document.documentElement).fontSize);
    return { root, src: [...document.querySelectorAll('[data-test="learn-source"]')].map((e) => parseFloat(getComputedStyle(e).fontSize)) };
  });
  check('(full) every learn-source is in small text (font size below the root font size)', fs.src.length === 3 && fs.src.every((x) => x < fs.root), JSON.stringify(fs));
  await reload(page);
  check('(set-mode) full mode chosen in settings is kept after reload', await visible(page, 'time-slider'));

  // SPEC 7: slider events are throttled to one per 2 s.
  await page.waitForTimeout(2500);
  const input = await sliderInput(page);
  const { min } = await input.evaluate((e) => ({ min: +e.min }));
  const sliderEvents = async () => (await events(page)).filter((e) => e.type === 'slider');
  const n0 = (await sliderEvents()).length;
  for (let k = 1; k <= 5; k++) {
    await input.fill(String(min + k));
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(2500);
  const burst = (await sliderEvents()).length - n0;
  check('(slider) 5 moves within 1 s log 1 or 2 slider events (one per 2 s)', burst >= 1 && burst <= 2, `${burst}`);
  await input.fill(String(min + 10));
  await page.waitForTimeout(2500);
  const logged = await sliderEvents();
  check('(slider) a move more than 2 s later logs another slider event', logged.length - n0 > burst, `${burst} -> ${logged.length - n0}`);
  const all = logged.filter((e) => e.session === logged[logged.length - 1]?.session); // t restarts with each page open
  const gaps = all.map((e, i) => (i ? e.t - all[i - 1].t : Infinity));
  check('(slider) slider events are at least 2 s apart', gaps.every((g) => g >= 1950), gaps.filter((g) => g !== Infinity).join(','));

  await inSettings(page, () => pickOption(page, sel('set-mode'), 'Dễ dùng'));
  await page.waitForTimeout(300);
  check('(set-mode) switching back to "Dễ dùng" removes the slider', !(await visible(page, 'time-slider')));
  await ctx.close();
});

await scenario('full mode via ?mode=full, not saved', async () => {
  const ctx = await context();
  const page = await open(ctx, url());
  await skipOnboarding(page);
  const s0 = await stored(page);
  await page.goto(url({ mode: 'full' }));
  await ready(page);
  await fullModeChecks(page, '(?mode=full)');
  check(`(?mode=full) ${SETTINGS_KEY} is unchanged by ?mode=full`, (await stored(page)) === s0, `${s0} -> ${await stored(page)}`);
  await page.goto(url({ mode: null }));
  await ready(page);
  check('(?mode=full) the next load without ?mode= is back in easy mode', !(await visible(page, 'time-slider')) && !(await visible(page, 'timeline')));
  await ctx.close();
});

await scenario('?mode=easy overrides a saved "Đầy đủ" for one load, not saved', async () => {
  const ctx = await context();
  const page = await open(ctx, url());
  await skipOnboarding(page);
  await inSettings(page, () => pickOption(page, sel('set-mode'), 'Đầy đủ'));
  await page.waitForTimeout(300);
  await reload(page);
  check('(?mode=easy) the saved "Đầy đủ" shows the slider before the override', await visible(page, 'time-slider'));
  const s0 = await stored(page);
  await page.goto(url({ mode: 'easy' }));
  await ready(page);
  check('(?mode=easy) ?mode=easy gives easy mode over the saved "Đầy đủ" (no slider, no timeline)', !(await visible(page, 'time-slider')) && !(await visible(page, 'timeline')));
  check(`(?mode=easy) ${SETTINGS_KEY} is unchanged by ?mode=easy`, (await stored(page)) === s0, `${s0} -> ${await stored(page)}`);
  await page.goto(url({ mode: null }));
  await ready(page);
  check('(?mode=easy) the next load without ?mode= is back in the saved full mode (slider shows)', await visible(page, 'time-slider'));
  await ctx.close();
});

// SPEC 6.2: full mode, drag rotates and scroll zooms; easy mode, the camera is locked over Vietnam.
// Run under reduced motion so the only thing that can change the globe image is the input itself.
async function dragAndWheel(page) {
  const g = await T(page, 'globe').first().boundingBox();
  const cx = g.x + g.width / 2;
  const cy = g.y + g.height / 2;
  await page.mouse.move(5, 5);
  await page.waitForTimeout(500);
  const a = await canvasShot(page);
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let k = 1; k <= 10; k++) await page.mouse.move(cx + k * 15, cy + k * 5);
  await page.mouse.up();
  await page.mouse.move(5, 5);
  await page.waitForTimeout(1000);
  const b = await canvasShot(page);
  await page.mouse.move(cx, cy);
  for (let k = 0; k < 5; k++) await page.mouse.wheel(0, -200);
  await page.mouse.move(5, 5);
  await page.waitForTimeout(1000);
  const c = await canvasShot(page);
  return { drag: await pixelDiff(page, a, b), wheel: await pixelDiff(page, b, c) };
}

for (const mode of ['easy', 'full']) {
  await scenario(`globe input in ${mode} mode (1440x900, reduced motion)`, async () => {
    const ctx = await context({ reducedMotion: 'reduce' });
    const page = await open(ctx, url({ mode }));
    await skipOnboarding(page);
    await page.waitForTimeout(1000);
    const d = await dragAndWheel(page);
    if (mode === 'full') {
      check('(full) dragging the globe changes the view (rotates)', d.drag > SAME_PX, `${(d.drag * 100).toFixed(2)} % of pixels changed`);
      check('(full) scrolling over the globe changes the view (zooms)', d.wheel > SAME_PX, `${(d.wheel * 100).toFixed(2)} % of pixels changed`);
    } else {
      check('(easy) dragging the globe does not move the camera', d.drag <= SAME_PX, `${(d.drag * 100).toFixed(2)} % of pixels changed`);
      check('(easy) scrolling over the globe does not move the camera', d.wheel <= SAME_PX, `${(d.wheel * 100).toFixed(2)} % of pixels changed`);
    }
    await ctx.close();
  });
}

await finish();
