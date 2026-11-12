// UAT, SPEC 6.2 / 6.3 / 6.5 / 7: easy mode (default) and full mode, timeline, knowledge cards, slider log.
// UAT_URL=http://localhost:5195/?test=1 node tests/uat/modes.mjs
import { SUMMARY_AT_NOW, vtext, TIMELINE_UNAFFECTED_HEADING, SAME_PX, canvasShot, centreInside, pixelDiff, CARDS, CARDS_APPROVED, CARD_SAFETY_SECTIONS, CONE, CONE_LEGEND, HAI_PHONG, headAffected, headUnaffected, pinch, trackAt, waitVisible, NOW_MS, learnCards, PROVINCES, SETTINGS_KEY, T, TIME_RE, TRACK, check, chosenOption, context, events, finish, inSettings, norm, onTop, open, parseKm, pickOption, ready, refVerdict, reload, scenario, sel, skipOnboarding, text, url, visible, vnTime } from './lib.mjs';

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
    const m = r.text.match(/tâm bão cách (\d[\d.,\s]*?) km/);
    return !m || !near(parseKm(m[1]), distOf(r), Math.max(1, distOf(r) * 0.01));
  });
  check(`${tag} unaffected rows show "tâm bão cách {km} km" with the closest distance`, badU.length === 0, badU.slice(0, 4).map((r) => `${r.text} (want ~${Math.round(distOf(r))})`).join(' | '));

  // SPEC 6.3: the unaffected rows come under the sub-heading "Không có gió từ cấp 8 trở lên".
  const sub = await T(page, 'timeline').first().evaluate((tl, h) => {
    const norm = (s) => (s ?? '').replace(/\s+/g, ' ').trim();
    const el = [...tl.querySelectorAll('*')].find((e) => norm(e.textContent) === h && !e.closest('[data-test="timeline-row"]'));
    const firstUn = tl.querySelector('[data-test="timeline-row"][data-affected="false"]');
    const lastAff = [...tl.querySelectorAll('[data-test="timeline-row"][data-affected="true"]')].pop();
    if (!el) return { found: false };
    const r = el.getBoundingClientRect();
    return { found: true, aboveUn: !firstUn || r.top <= firstUn.getBoundingClientRect().top, belowAff: !lastAff || r.top >= lastAff.getBoundingClientRect().top };
  }, TIMELINE_UNAFFECTED_HEADING);
  check(`${tag} the sub-heading "${TIMELINE_UNAFFECTED_HEADING}" is in the timeline, after the affected rows and before the unaffected ones`, sub.found && sub.aboveUn && sub.belowAff, JSON.stringify(sub));

  // Tapping a row selects that province as the place.
  const first = known[0];
  await T(page, 'timeline-row').first().click();
  await page.waitForFunction((n) => (document.querySelector('[data-test="verdict-head"]')?.textContent ?? '').includes(n), first?.ref.p.name, { timeout: 10000 }).catch(() => {});
  const head = await text(page, 'verdict-head');
  check(`${tag} tapping the first timeline row shows the verdict for ${first?.ref.p.name}`, !!first && head === headAffected(first.ref.p.name), head);
  const v = await page.evaluate(() => window.__app.verdict);
  const want = first?.ref.a.affected ? first.ref.a : first?.ref.b;
  check(`${tag} after tapping the row, __app.verdict is that province's verdict`, v?.affected === true && !!want && near(new Date(v.firstInside).getTime(), want.firstInside, HALF_HOUR), JSON.stringify(v));

  // Tapping an unaffected row selects that province too: an unaffected verdict for it.
  const unIdx = named.findIndex((r) => r.aff === 'false' && r.ref);
  const unRow = unIdx >= 0 ? named[unIdx] : null;
  check(`${tag} the timeline has an unaffected row to tap`, !!unRow);
  if (unRow) {
    await page.keyboard.press('Escape'); // the warning pop-up, if open
    await T(page, 'timeline-row').nth(unIdx).click();
    await page.waitForFunction((n) => (document.querySelector('[data-test="verdict-head"]')?.textContent ?? '').includes(n), unRow.ref.p.name, { timeout: 10000 }).catch(() => {});
    const head2 = await text(page, 'verdict-head');
    const aff2 = await T(page, 'verdict').first().getAttribute('data-affected').catch(() => null);
    check(`${tag} tapping the unaffected row ${unRow.ref.p.name} shows verdict-head "${headUnaffected(unRow.ref.p.name)}" and data-affected="false"`, head2 === headUnaffected(unRow.ref.p.name) && aff2 === 'false', `${head2} / ${aff2}`);
  }
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
  const sum = await vtext(page, 'storm-summary').catch(() => '');
  check(`${tag} with the slider at the end, storm-summary still describes now: "${SUMMARY_AT_NOW}"`, sum === SUMMARY_AT_NOW, sum);
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
  // SPEC 6.2 easy mode: the marker shows the storm at now and the view is fixed, so the marker stays put.
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

// SPEC 6.2: the map view is fixed in both modes: no drag, no scroll or pinch zoom, no camera moves.
// Run under reduced motion so the only thing that could change the globe image is the input itself.
async function dragAndWheel(page) {
  const g = await T(page, 'globe').first().boundingBox();
  const cx = g.x + g.width / 2;
  const cy = g.y + g.height / 2;
  await page.mouse.move(5, 5);
  await page.waitForTimeout(500);
  const m0 = await T(page, 'storm-marker').first().boundingBox().catch(() => null);
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
  const m1 = await T(page, 'storm-marker').first().boundingBox().catch(() => null);
  return { drag: await pixelDiff(page, a, b), wheel: await pixelDiff(page, b, c), m0, m1 };
}

for (const mode of ['easy', 'full']) {
  await scenario(`the map ignores drag and scroll in ${mode} mode (1440x900, reduced motion)`, async () => {
    const ctx = await context({ reducedMotion: 'reduce' });
    const page = await open(ctx, url({ mode }));
    await skipOnboarding(page);
    await page.waitForTimeout(1000);
    const d = await dragAndWheel(page);
    check(`(${mode}) dragging the globe does not move the view (same image)`, d.drag <= SAME_PX, `${(d.drag * 100).toFixed(2)} % of pixels changed`);
    check(`(${mode}) scrolling over the globe does not zoom (same image)`, d.wheel <= SAME_PX, `${(d.wheel * 100).toFixed(2)} % of pixels changed`);
    check(`(${mode}) storm-marker is in the same place after the drag and the scroll (within 1 px)`, !!d.m0 && !!d.m1 && Math.abs(d.m0.x - d.m1.x) <= 1 && Math.abs(d.m0.y - d.m1.y) <= 1, `${JSON.stringify(d.m0)} -> ${JSON.stringify(d.m1)}`);
    await ctx.close();
  });
}

// SPEC 6.2: the storm marker is at the selected time's track position. The tests place a pin (__app.setPlace) at the
// track position for that time, from yagi.json (linear in lat/lon, SPEC 5.1), and compare it with the marker on
// screen. SPEC does not say which point of the pin's box marks the place (its centre or a tip), so the check is: the
// marker's centre lies inside the pin's box (8 px margin), and the offset from the pin's centre to the marker's centre
// is the same, within 4 px, at each time (our thresholds).
const centreOf = (b) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
async function markerAtTrack(page, tag, slider, times) {
  const offsets = [];
  for (const [label, ms] of times) {
    if (slider) {
      const { min } = await slider.evaluate((e) => ({ min: +e.min }));
      const step = +((await slider.getAttribute('step')) ?? 1) || 1;
      await slider.fill(String(min + Math.round((ms - Date.parse(TRACK.points[0].t)) / (3 * 3600 * 1000)) * step));
      await page.waitForTimeout(400);
    }
    const at = trackAt(TRACK, ms);
    await page.evaluate((p) => window.__app.setPlace(p.lat, p.lon, 'Tâm bão'), at);
    await page.waitForTimeout(800);
    await page.keyboard.press('Escape'); // the warning pop-up, if open
    const m = await T(page, 'storm-marker').first().boundingBox().catch(() => null);
    const pin = await T(page, 'place-pin').first().boundingBox().catch(() => null);
    const c = m ? centreOf(m) : null;
    const ok = !!c && !!pin && c.x >= pin.x - 8 && c.x <= pin.x + pin.width + 8 && c.y >= pin.y - 8 && c.y <= pin.y + pin.height + 8;
    check(`${tag} at ${label}, storm-marker sits on a pin placed at the track position for that time (marker centre inside the pin's box, 8 px margin)`, ok, `marker ${JSON.stringify(m)} pin ${JSON.stringify(pin)} track ${at?.lat?.toFixed(2)}, ${at?.lon?.toFixed(2)}`);
    if (c && pin) offsets.push({ label, dx: c.x - centreOf(pin).x, dy: c.y - centreOf(pin).y });
  }
  if (times.length > 1) {
    const spread = offsets.length === times.length ? Math.max(...offsets.flatMap((a) => offsets.map((b) => Math.hypot(a.dx - b.dx, a.dy - b.dy)))) : Infinity;
    check(`${tag} the marker-to-pin offset is the same at each time (within 4 px)`, spread <= 4, JSON.stringify(offsets));
  }
}
await scenario('the storm marker is at the track position for the selected time (1440x900, full and easy, reduced motion)', async () => {
  const ctx = await context({ reducedMotion: 'reduce' });
  const page = await open(ctx, url({ mode: 'full' }));
  await skipOnboarding(page);
  if (!TRACK) return check('yagi.json loads', false);
  const last = Date.parse(TRACK.points[TRACK.points.length - 1].t);
  await markerAtTrack(page, '(full)', await sliderInput(page), [['now', NOW_MS], ['now + 24 h', NOW_MS + 24 * 3600 * 1000], ['the last point', last]]);
  await page.goto(url({ mode: 'easy' }));
  await ready(page);
  await markerAtTrack(page, '(easy)', null, [['now', NOW_MS]]);
  await ctx.close();
});

// SPEC 6.2: no pinch zoom on the map. A two-finger pinch over the globe on a phone leaves the image and the marker.
await scenario('the map ignores a pinch (375x812 touch, reduced motion)', async () => {
  const ctx = await context({ phone: true, reducedMotion: 'reduce' });
  const page = await open(ctx);
  await skipOnboarding(page);
  await page.waitForTimeout(1000);
  const g = await T(page, 'globe').first().boundingBox();
  const m0 = await T(page, 'storm-marker').first().boundingBox().catch(() => null);
  const a = await canvasShot(page);
  await pinch(page, g.x + g.width / 2, g.y + g.height / 2, 60, 220);
  await page.waitForTimeout(1000);
  const b = await canvasShot(page);
  const m1 = await T(page, 'storm-marker').first().boundingBox().catch(() => null);
  const d = await pixelDiff(page, a, b);
  check('(375) a pinch over the globe does not zoom (same image)', d <= SAME_PX, `${(d * 100).toFixed(2)} % of pixels changed`);
  check('(375) storm-marker is in the same place after the pinch (within 1 px)', !!m0 && !!m1 && Math.abs(m0.x - m1.x) <= 1 && Math.abs(m0.y - m1.y) <= 1, `${JSON.stringify(m0)} -> ${JSON.stringify(m1)}`);
  await ctx.close();
});

// SPEC 6.2: the fixed view frames the whole track and all of Vietnam for the current layout.
// Vietnam's four extreme points (our choice of test points): north, south, east and west.
const VN_EDGES = [
  { name: 'cực Bắc', lat: 23.39, lon: 105.32 },
  { name: 'cực Nam', lat: 8.56, lon: 104.82 },
  { name: 'cực Đông', lat: 12.65, lon: 109.46 },
  { name: 'cực Tây', lat: 22.4, lon: 102.14 },
];
for (const phone of [true, false]) {
  const tag = phone ? '(375 frame)' : '(1440 frame)';
  await scenario(`the fixed view frames the track and Vietnam ${tag}`, async () => {
    const ctx = await context({ phone, reducedMotion: 'reduce' });
    const page = await open(ctx, url({ mode: 'full' }));
    await skipOnboarding(page);
    const g = await T(page, 'globe').first().boundingBox().catch(() => null);
    const input = await sliderInput(page);
    const { min, max, value } = await input.evaluate((e) => ({ min: +e.min, max: +e.max, value: +e.value }));
    const m0 = await T(page, 'storm-marker').first().boundingBox().catch(() => null);
    for (const [label, v] of [['first', min], ['last', max]]) {
      await input.fill(String(v));
      await page.waitForTimeout(400);
      const m = await T(page, 'storm-marker').first().boundingBox().catch(() => null);
      check(`${tag} with the slider at the ${label} track point, storm-marker sits inside the globe`, (await visible(page, 'storm-marker')) && centreInside(m, g), `${JSON.stringify(m)} in ${JSON.stringify(g)}`);
    }
    await input.fill(String(value));
    await page.waitForTimeout(400);
    for (const p of VN_EDGES) {
      await page.evaluate((p) => window.__app.setPlace(p.lat, p.lon, p.name), p);
      await page.waitForTimeout(800);
      const pin = await T(page, 'place-pin').first().boundingBox().catch(() => null);
      check(`${tag} a place at Vietnam's ${p.name} (${p.lat}, ${p.lon}) puts place-pin inside the globe`, (await visible(page, 'place-pin')) && centreInside(pin, g), `${JSON.stringify(pin)} in ${JSON.stringify(g)}`);
    }
    await page.keyboard.press('Escape');
    const m1 = await T(page, 'storm-marker').first().boundingBox().catch(() => null);
    check(`${tag} after four verdicts the view has not moved (storm-marker at the same place, within 1 px)`, !!m0 && !!m1 && Math.abs(m0.x - m1.x) <= 1 && Math.abs(m0.y - m1.y) <= 1, `${JSON.stringify(m0)} -> ${JSON.stringify(m1)}`);
    await ctx.close();
  });
}

await finish();
