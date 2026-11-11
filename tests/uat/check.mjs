// UAT, SPEC 4 + 6.1 + 6.3 + 7: the "Nhà tôi có bị ảnh hưởng không?" check, verdict card, province picker.
// UAT_URL=http://localhost:5195/?test=1 node tests/uat/check.mjs
import { centreInside, placeOf, verdictMismatch, ACTIONS, ACTIONS_SOURCE, HAI_PHONG, HCM, PROVINCES, SUMMARY_AT_NOW, T, TIME_RE, VERDICT_NOTE, actionTexts, check, context, events, finish, headAffected, headUnaffected, open, parseKm, pickProvince, province, refWindLevel, runCheck, scenario, skipOnboarding, text, verdictWind, visible, vnTime, vtext, waitVisible } from './lib.mjs';

const PLACE = 'Vị trí của bạn';
const PICK_LINE = 'Không lấy được vị trí. Chọn tỉnh của bạn:';
const HP = province('Hải Phòng');
// SPEC 3.2: the ho-chi-minh entry is shown as "TP. Hồ Chí Minh" everywhere.
const HCM_NAME = 'TP. Hồ Chí Minh';
const HCMP = PROVINCES.find((p) => p.id === 'ho-chi-minh') ?? null;
const verdictState = (page) => page.evaluate(() => window.__app.verdict);
// The 3 safety actions: list items if the block is a list, else its child elements.
const actionCount = (page) => T(page, 'verdict-actions').first().evaluate((e) => { const li = e.querySelectorAll('li'); if (li.length) return li.length; const box = [...e.children].filter((c) => !/^H\d$/.test(c.tagName)); return box.length === 1 ? box[0].children.length : box.length; });
// SPEC 6.3: the source line [verdict-source] of SPEC 10.3, under the actions.
async function sourceChecks(page, tag) {
  const src = await text(page, 'verdict-source').catch(() => '');
  check(`${tag}verdict-source = the SPEC 10.3 source line`, (await visible(page, 'verdict-source')) && src === ACTIONS_SOURCE, src);
  const a = await T(page, 'verdict-actions').first().boundingBox().catch(() => null);
  const s = await T(page, 'verdict-source').first().boundingBox().catch(() => null);
  check(`${tag}verdict-source sits under verdict-actions`, !!a && !!s && s.y >= a.y + a.height - 1, `${JSON.stringify(a)} / ${JSON.stringify(s)}`);
  // SPEC 10: each source line is "shown in small text": smaller than the page's base (root) font size.
  const fs = await page.evaluate(() => {
    const e = document.querySelector('[data-test="verdict-source"]');
    return e ? { src: parseFloat(getComputedStyle(e).fontSize), root: parseFloat(getComputedStyle(document.documentElement).fontSize) } : null;
  });
  check(`${tag}verdict-source is in small text (font size below the root font size)`, !!fs && fs.src < fs.root, JSON.stringify(fs));
}
// SPEC 6.3 step 4: the pin marks the place on the globe. Polls up to 8 s so a camera flight can finish.
async function pinOnGlobe(page, tag) {
  let ok = false;
  let last = '';
  for (const t0 = Date.now(); !ok && Date.now() - t0 < 8000; await page.waitForTimeout(250)) {
    const pin = await T(page, 'place-pin').first().boundingBox().catch(() => null);
    const globe = await T(page, 'globe').first().boundingBox().catch(() => null);
    ok = (await visible(page, 'place-pin')) && centreInside(pin, globe);
    last = `${JSON.stringify(pin)} in ${JSON.stringify(globe)}`;
  }
  check(`${tag}place-pin is visible and sits inside the globe`, ok, last);
}
const bodyText = async (page) => ((await page.locator('body').textContent()) ?? '').replace(/\s+/g, ' ');

check('src/data/provinces.json has Hải Phòng and a Hồ Chí Minh entry (needed by the scenarios below)', !!HP && !!HCMP, `${HP?.name} / ${HCMP?.name}`);
check(`the ho-chi-minh entry is named "${HCM_NAME}" (SPEC 3.2)`, HCMP?.name === HCM_NAME, HCMP?.name);

await scenario('geolocation granted at Hải Phòng (1440x900)', async () => {
  const ctx = await context({ geo: HAI_PHONG });
  const page = await open(ctx);
  await skipOnboarding(page);
  const now = await page.evaluate(() => window.__app.now);
  check('__app.now is 2024-09-05 00:00 UTC', Date.parse(now) === Date.parse('2024-09-05T00:00:00Z'), now);
  check('title reads "Bản đồ bão"', (await text(page, 'title')) === 'Bản đồ bão', await text(page, 'title'));
  check('btn-settings reads "Cài đặt"', (await text(page, 'btn-settings')) === 'Cài đặt', await text(page, 'btn-settings'));
  check('btn-check reads "Nhà tôi có bị ảnh hưởng không?"', (await text(page, 'btn-check')) === 'Nhà tôi có bị ảnh hưởng không?', await text(page, 'btn-check'));
  const summary = await vtext(page, 'storm-summary');
  check(`storm-summary reads "${SUMMARY_AT_NOW}" (130 kt at now -> level 17)`, summary === SUMMARY_AT_NOW, summary);
  check('__app.verdict is null before any check', (await verdictState(page)) === null);
  await runCheck(page);
  const aff = await T(page, 'verdict').first().getAttribute('data-affected');
  check('verdict data-affected="true"', aff === 'true', aff);
  const v = await verdictState(page);
  check('__app.verdict.affected is true', v?.affected === true, JSON.stringify(v));
  const mis = verdictMismatch(v, placeOf(HAI_PHONG));
  check('__app.verdict for Hải Phòng equals the tests\' own SPEC 5 verdict on yagi.json (times ±30 min, distance ±1 %, wind ±1 kt)', mis === '', mis);
  const head = await text(page, 'verdict-head');
  check(`verdict-head = "${headAffected(PLACE)}"`, head === headAffected(PLACE), head);
  const when = await text(page, 'verdict-when');
  const m = when.match(/^Từ khoảng (.+) đến (.+)$/);
  check('verdict-when = "Từ khoảng {HH:mm, dd/MM} đến {HH:mm, dd/MM}"', !!m && TIME_RE.test(m[1]) && TIME_RE.test(m[2]), when);
  if (v?.firstInside && v?.lastInside) {
    check('verdict-when shows firstInside and lastInside in Vietnam time', when === `Từ khoảng ${vnTime(v.firstInside)} đến ${vnTime(v.lastInside)}`, `${when} vs ${vnTime(v.firstInside)} / ${vnTime(v.lastInside)}`);
  } else check('__app.verdict has firstInside and lastInside', false, JSON.stringify(v));
  const wind = await text(page, 'verdict-wind').catch(() => '');
  const wantLevel = refWindLevel(v?.peakWindKt ?? null);
  check('verdict-wind is visible', await visible(page, 'verdict-wind'));
  check('verdict-wind = "Sức gió lớn nhất: cấp {n} (ước tính)" with n = windLevel(peakWindKt)', wantLevel !== null && wind === verdictWind(wantLevel), `${wind} / peakWindKt ${v?.peakWindKt} -> ${wantLevel}`);
  check('affected card has no verdict-note', !(await visible(page, 'verdict-note')));
  const card = (await T(page, 'verdict').first().textContent()) ?? '';
  check('affected card has the heading "Bạn nên làm ngay"', card.includes('Bạn nên làm ngay'));
  check('affected card does not have the unaffected heading "Vẫn nên theo dõi tin bão"', !card.includes('Vẫn nên theo dõi tin bão'));
  const actions = T(page, 'verdict-actions').first();
  const items = await actionCount(page);
  check('verdict-actions is visible with 3 safety actions', (await actions.isVisible()) && items === 3, `li=${items}`);
  const acts = await actionTexts(page);
  check('verdict-actions are the 3 actions of SPEC 10.3, word for word, in order', JSON.stringify(acts) === JSON.stringify(ACTIONS), JSON.stringify(acts));
  await sourceChecks(page, '');
  await pinOnGlobe(page, '');
  check('btn-recheck reads "Chọn nơi khác"', (await text(page, 'btn-recheck')) === 'Chọn nơi khác', await text(page, 'btn-recheck'));
  await T(page, 'btn-recheck').first().click();
  await waitVisible(page, 'province-picker').catch(() => {});
  check('btn-recheck opens the province picker', await visible(page, 'province-picker'));
  // Options naming a province from provinces.json; one placeholder option at most may come on top.
  const names = PROVINCES.map((p) => p.name);
  const opts = await T(page, 'province-picker').first().evaluate((e, names) => {
    const s = e.tagName === 'SELECT' ? e : e.querySelector('select');
    if (!s) return null;
    const all = [...s.options].map((o) => o.textContent.replace(/\s+/g, ' ').trim());
    return { total: all.length, named: new Set(all.filter((t) => names.some((n) => t.includes(n)))).size };
  }, names);
  check('the province picker is a native select listing the 34 provinces', !!opts && opts.named === 34 && opts.total <= 35, JSON.stringify(opts));
  // Round trip: pick TP. Hồ Chí Minh from the picker opened by btn-recheck.
  await pickProvince(page, HCM_NAME);
  await page.waitForFunction(() => window.__app.verdict && window.__app.verdict.affected === false, null, { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(500);
  const aff2 = await T(page, 'verdict').first().getAttribute('data-affected');
  check('btn-recheck -> picking TP. Hồ Chí Minh gives data-affected="false"', aff2 === 'false', aff2);
  const head2 = await text(page, 'verdict-head');
  check(`btn-recheck -> verdict-head = "${headUnaffected(HCM_NAME)}"`, head2 === headUnaffected(HCM_NAME), head2);
  const picks = (await events(page)).filter((e) => e.type === 'province_pick');
  check('province_pick logged with { id } of TP. Hồ Chí Minh', !!HCMP && picks.some((e) => e.data?.id === HCMP.id), JSON.stringify(picks));
  await ctx.close();
});

await scenario('geolocation granted at TP. Hồ Chí Minh (375x812 touch)', async () => {
  const ctx = await context({ phone: true, geo: HCM });
  const page = await open(ctx);
  await skipOnboarding(page);
  await runCheck(page);
  const aff = await T(page, 'verdict').first().getAttribute('data-affected');
  check('(375) verdict data-affected="false"', aff === 'false', aff);
  const head = await text(page, 'verdict-head');
  check(`(375) verdict-head = "${headUnaffected(PLACE)}"`, head === headUnaffected(PLACE), head);
  const when = await text(page, 'verdict-when');
  const v = await verdictState(page);
  const mis = verdictMismatch(v, placeOf(HCM));
  check('(375) __app.verdict for TP. Hồ Chí Minh equals the tests\' own SPEC 5 verdict on yagi.json (distance ±1 %, times ±30 min)', mis === '', mis);
  const m = when.match(/^Tâm bão gần nhất cách (.+) khoảng (\d[\d.,\s]*) km, lúc (.+)$/);
  check('(375) verdict-when = "Tâm bão gần nhất cách {place} khoảng {km} km, lúc {time}"', !!m && m[1] === PLACE && TIME_RE.test(m[3]), when);
  if (m && v?.closest) {
    const km = parseKm(m[2]);
    check('(375) the km figure is the closest distance (within 1 % or 1 km)', Math.abs(km - v.closest.distanceKm) <= Math.max(1, v.closest.distanceKm * 0.01), `${km} vs ${v.closest.distanceKm}`);
    check('(375) the time is closest.time in Vietnam time', m[3] === vnTime(v.closest.time), `${m[3]} vs ${vnTime(v.closest.time)}`);
  }
  const card = (await T(page, 'verdict').first().textContent()) ?? '';
  check('(375) unaffected card has "Vẫn nên theo dõi tin bão" and the 3 actions', card.includes('Vẫn nên theo dõi tin bão') && (await actionCount(page)) === 3);
  check('(375) unaffected card does not have the affected heading "Bạn nên làm ngay"', !card.includes('Bạn nên làm ngay'));
  check(`(375) verdict-note = "${VERDICT_NOTE}"`, (await visible(page, 'verdict-note')) && (await text(page, 'verdict-note')) === VERDICT_NOTE, await text(page, 'verdict-note').catch(() => ''));
  check('(375) unaffected card has no verdict-wind', !(await visible(page, 'verdict-wind')));
  const acts = await actionTexts(page);
  check('(375) unaffected verdict-actions are the same 3 actions, in order', JSON.stringify(acts) === JSON.stringify(ACTIONS), JSON.stringify(acts));
  await sourceChecks(page, '(375) ');
  await pinOnGlobe(page, '(375) ');
  await ctx.close();
});

await scenario('geolocation denied -> province picker within 3 s', async () => {
  const ctx = await context({ geo: false });
  const page = await open(ctx);
  await skipOnboarding(page);
  await T(page, 'btn-check').first().click();
  // Denial answers at once; waiting for the 8 s timer instead would miss this window.
  await waitVisible(page, 'province-picker', 3000).catch(() => {});
  check('denied geolocation shows the province picker within 3 s', await visible(page, 'province-picker'));
  check(`the line "${PICK_LINE}" is shown`, (await bodyText(page)).includes(PICK_LINE));
  const geo = (await events(page)).filter((e) => e.type === 'geo_result');
  check('geo_result logged with { granted: false }', geo.some((e) => e.data?.granted === false), JSON.stringify(geo));
  await pickProvince(page, 'Hải Phòng');
  await waitVisible(page, 'verdict', 10000);
  const aff = await T(page, 'verdict').first().getAttribute('data-affected');
  check('picking Hải Phòng produces an affected verdict', aff === 'true', aff);
  const head = await text(page, 'verdict-head');
  check(`the verdict names the province: "${headAffected(HP?.name)}"`, !!HP && head === headAffected(HP.name), head);
  const picks = (await events(page)).filter((e) => e.type === 'province_pick');
  check('province_pick logged with { id } of Hải Phòng', !!HP && picks.some((e) => e.data?.id === HP.id), JSON.stringify(picks));
  await pinOnGlobe(page, '(picked Hải Phòng) ');
  await ctx.close();
});

await scenario('geolocation never answers -> province picker after 8 s', async () => {
  const ctx = await context({
    init: () => {
      const never = () => {};
      Object.defineProperty(navigator.geolocation, 'getCurrentPosition', { value: never, configurable: true });
      Object.defineProperty(navigator.geolocation, 'watchPosition', { value: () => 1, configurable: true });
    },
  });
  const page = await open(ctx);
  await skipOnboarding(page);
  const t0 = Date.now();
  await T(page, 'btn-check').first().click();
  await page.waitForTimeout(Math.max(0, 7000 - (Date.now() - t0)));
  check('(no answer) the province picker is not shown before 7 s', !(await visible(page, 'province-picker')));
  await waitVisible(page, 'province-picker', Math.max(100, 9500 - (Date.now() - t0))).catch(() => {});
  check('(no answer) the province picker is shown by 9.5 s', await visible(page, 'province-picker'), `${Date.now() - t0} ms`);
  check(`(no answer) the line "${PICK_LINE}" is shown`, (await bodyText(page)).includes(PICK_LINE));
  await ctx.close();
});

await scenario('geolocation fails (position unavailable) -> province picker', async () => {
  const ctx = await context({
    init: () => {
      const fail = (_ok, err) => setTimeout(() => err && err({ code: 2, message: 'unavailable', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 }), 50);
      Object.defineProperty(navigator.geolocation, 'getCurrentPosition', { value: fail, configurable: true });
      Object.defineProperty(navigator.geolocation, 'watchPosition', { value: (ok, err) => (fail(ok, err), 1), configurable: true });
    },
  });
  const page = await open(ctx);
  await skipOnboarding(page);
  await T(page, 'btn-check').first().click();
  await waitVisible(page, 'province-picker', 3000).catch(() => {});
  check('(failed) the province picker is shown within 3 s', await visible(page, 'province-picker'));
  check(`(failed) the line "${PICK_LINE}" is shown`, (await bodyText(page)).includes(PICK_LINE));
  await ctx.close();
});

await finish();
