// UAT, SPEC 6.4: Usui-chan warning pop-up, question sheet and its 7 chips.
// UAT_URL=http://localhost:5195/?test=1 node tests/uat/assistant.mjs
import { ACTIONS, ACTIONS_SOURCE, CARD_RADIUS, CARD_WIND, parseKm, TRACK, refWindLevel, url, verdictMismatch, HAI_PHONG, HCM, T, TIME_IN, actionTexts, headAffected, learnCards, norm, check, context, finish, open, runCheck, scenario, skipOnboarding, text, visible, vnTime, waitView, waitVisible } from './lib.mjs';

const CHIPS = {
  affected: 'Nhà tôi có bị ảnh hưởng không?',
  when: 'Khi nào bão tới chỗ tôi?',
  prepare: 'Tôi cần chuẩn bị gì?',
  windlevel: 'Cấp gió là gì?',
  radius: 'Vùng gió mạnh là gì?',
  where: 'Bão đang ở đâu?',
  source: 'Dữ liệu này lấy từ đâu?',
};
const EMOJI = /\p{Extended_Pictographic}/u;
const sentences = (s) => s.split(/[.!?](?:\s|$)/).filter((x) => x.trim()).length;

async function openSheet(page) {
  if (!(await visible(page, 'assistant-sheet'))) {
    await T(page, 'assistant-avatar').first().click();
    await waitVisible(page, 'assistant-sheet');
  }
}
async function clickChip(page, id) {
  await openSheet(page);
  await page.locator(`[data-test="assistant-sheet"] [data-test="chip"][data-chip="${id}"]`).first().click();
}
// Voice (SPEC 6.4): Usui-chan says "mình" to "bạn"; "tôi" only where the answer quotes a chip's own text.
const TOI = /(^|[^\p{L}])tôi(?![\p{L}])/iu;
const voiceOk = (a) => /(^|[^\p{L}])(mình|bạn)(?![\p{L}])/iu.test(a) && !TOI.test(Object.values(CHIPS).reduce((s, c) => s.split(c).join(' '), a));
const answer = async (page) => ((await visible(page, 'assistant-answer')) ? await text(page, 'assistant-answer') : '');

await scenario('warning after an affected verdict, once per session (1440x900)', async () => {
  const ctx = await context({ geo: HAI_PHONG });
  const page = await open(ctx);
  await skipOnboarding(page);
  check('no warning before any check', !(await visible(page, 'assistant-warning')));
  const av = await T(page, 'assistant-avatar').first().boundingBox();
  check('assistant-avatar is about 56 px', !!av && Math.abs(av.width - 56) <= 4 && Math.abs(av.height - 56) <= 4, JSON.stringify(av));
  const img = await T(page, 'assistant-avatar').first().evaluate(async (e) => {
    const im = e.matches('img') ? e : e.querySelector('img');
    if (im) {
      if (!im.complete) await new Promise((r) => { im.onload = im.onerror = r; setTimeout(r, 3000); });
      return { kind: 'img', ok: im.naturalWidth > 0, src: im.currentSrc || im.src };
    }
    const bg = getComputedStyle(e).backgroundImage;
    return { kind: 'background', ok: /\.webp/.test(bg), src: bg };
  });
  check('assistant-avatar shows the Usui-chan portrait image (loaded)', img.ok, JSON.stringify(img));
  // SPEC 6.4 "in the corner". SPEC gives no distance; 24 px from two edges of the viewport is our threshold.
  const vp = page.viewportSize();
  const corner = !!av && Math.min(av.x, vp.width - av.x - av.width) <= 24 && Math.min(av.y, vp.height - av.y - av.height) <= 24;
  check('assistant-avatar sits in a corner of the viewport (within 24 px of two edges, our threshold)', corner, `${JSON.stringify(av)} in ${vp.width}x${vp.height}`);
  await runCheck(page);
  await waitVisible(page, 'assistant-warning', 5000).catch(() => {});
  check('the warning appears after an affected verdict', await visible(page, 'assistant-warning'));
  const v = await page.evaluate(() => window.__app.verdict);
  const w = await text(page, 'assistant-warning');
  const wm = w.match(/Vị trí của bạn sẽ có gió từ cấp 8 trở lên từ khoảng (\d{2}:\d{2}, \d{2}\/\d{2})\. Bấm vào mình nếu cần hỏi gì nhé\./);
  check('warning text "{place} sẽ có gió từ cấp 8 trở lên từ khoảng {firstInside}. Bấm vào mình nếu cần hỏi gì nhé."', !!wm && !!v?.firstInside && wm[1] === vnTime(v.firstInside), w);
  check('warning has no emoji', !EMOJI.test(w));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  check('Esc closes the warning', !(await visible(page, 'assistant-warning')));
  // A second affected verdict in the same session.
  await page.evaluate(() => window.__app.setPlace(21.0285, 105.8542, 'Hà Nội'));
  await page.waitForTimeout(1500);
  check('__app.setPlace runs a new verdict', (await page.evaluate(() => window.__app.verdict?.affected)) === true && v !== null);
  const mis = verdictMismatch(await page.evaluate(() => window.__app.verdict), { lat: 21.0285, lon: 105.8542 });
  check('__app.setPlace(21.0285, 105.8542) gives the tests\' own SPEC 5 verdict for that point (times ±30 min, distance ±1 %, wind ±1 kt)', mis === '', mis);
  check(`__app.setPlace uses its label: verdict-head "${headAffected('Hà Nội')}"`, (await text(page, 'verdict-head')) === headAffected('Hà Nội'), await text(page, 'verdict-head'));
  check('the warning does not appear a second time in the session', !(await visible(page, 'assistant-warning')));
  const ev = (await page.evaluate(() => window.__app.events())).filter((e) => e.type === 'assistant_warning_shown').length;
  check('assistant_warning_shown logged exactly once', ev === 1, `${ev}`);
  // "Once per session": SPEC 7 makes a new session on each page open. A second page in the same browser (same
  // localStorage, new session) shows the warning again after an affected verdict.
  const page2 = await open(ctx);
  await skipOnboarding(page2);
  await runCheck(page2);
  await waitVisible(page2, 'assistant-warning', 5000).catch(() => {});
  check('a new page open (new session, same localStorage) shows the warning again after an affected verdict', await visible(page2, 'assistant-warning'));
  await ctx.close();
});

await scenario('the warning can be closed with its × button', async () => {
  const ctx = await context({ geo: HAI_PHONG, phone: true });
  const page = await open(ctx);
  await skipOnboarding(page);
  await runCheck(page);
  await waitVisible(page, 'assistant-warning', 5000);
  await T(page, 'assistant-warning').first().getByRole('button', { name: /^(×|✕|Đóng)/ }).first().click();
  await page.waitForTimeout(400);
  check('(375) × closes the warning', !(await visible(page, 'assistant-warning')));
  await ctx.close();
});

await scenario('no warning after an unaffected verdict', async () => {
  const ctx = await context({ geo: HCM });
  const page = await open(ctx);
  await skipOnboarding(page);
  await runCheck(page);
  await page.waitForTimeout(2000);
  check('no warning for TP. Hồ Chí Minh (unaffected)', !(await visible(page, 'assistant-warning')));
  await ctx.close();
});

await scenario('question sheet and chips', async () => {
  const ctx = await context({ geo: HAI_PHONG });
  const page = await open(ctx);
  await skipOnboarding(page);
  await T(page, 'assistant-avatar').first().click();
  await waitVisible(page, 'assistant-sheet').catch(() => {});
  check('tapping the avatar opens assistant-sheet', await visible(page, 'assistant-sheet'));
  const chips = await page.locator('[data-test="assistant-sheet"] [data-test="chip"]').evaluateAll((cs) => cs.map((c) => ({ id: c.getAttribute('data-chip'), text: c.textContent.replace(/\s+/g, ' ').trim() })));
  const ids = chips.map((c) => c.id).sort();
  check('exactly the 7 chips of SPEC 6.4 by data-chip', chips.length === 7 && JSON.stringify(ids) === JSON.stringify(Object.keys(CHIPS).sort()), ids.join(','));
  check('each chip has its SPEC text', chips.every((c) => CHIPS[c.id] === c.text), JSON.stringify(chips));

  // "when" before any verdict runs the check first.
  await clickChip(page, 'when');
  await waitVisible(page, 'verdict', 15000).catch(() => {});
  check('chip "when" with no verdict yet runs the check', await visible(page, 'verdict'));
  await page.waitForTimeout(800);
  await page.keyboard.press('Escape'); // close the warning if it is open
  await clickChip(page, 'when');
  await page.waitForTimeout(500);
  const aWhen = await answer(page);
  const vNow = await page.evaluate(() => window.__app.verdict);
  check('chip "when" answers with the verdict\'s firstInside in Vietnam time', !!vNow?.firstInside && aWhen.includes(vnTime(vNow.firstInside)), `${aWhen} / want ${vNow?.firstInside ? vnTime(vNow.firstInside) : '-'}`);
  check('chip "when" answer speaks as "mình" to "bạn" and never says "tôi"', voiceOk(aWhen), aWhen);
  check('chip "when" answer: at most two sentences, no emoji', sentences(aWhen) <= 2 && !EMOJI.test(aWhen), aWhen);

  // The prepare answer holds the 3 approved actions of SPEC 10.3; the wind-level and radius answers hold each approved
  // line of SPEC 10.1 / 10.2 word for word.
  const want = { prepare: ACTIONS.map(norm), windlevel: CARD_WIND.body.map(norm), radius: CARD_RADIUS.body.map(norm) };
  const cardOf = { prepare: null, windlevel: CARD_WIND, radius: CARD_RADIUS };
  for (const id of ['prepare', 'windlevel', 'radius']) {
    await clickChip(page, id);
    await page.waitForTimeout(400);
    const a = norm(await answer(page));
    check(`chip "${id}" shows assistant-answer text`, a.length > 0, a.slice(0, 120));
    const label = id === 'prepare' ? 'the 3 safety actions of SPEC 10.3' : `each line of the SPEC 10 card "${cardOf[id].title}"`;
    check(`chip "${id}" answer contains ${label}`, want[id].length > 0 && want[id].every((w) => w.length > 0 && a.includes(w)), `${a.slice(0, 160)} / want ${JSON.stringify(want[id]).slice(0, 160)}`);
    check(`chip "${id}" answer has no emoji`, !EMOJI.test(a));
    // SPEC 10.5: the answer is built only from 10.1-10.4 and the verdict. With the approved lines (and the card's title
    // and source line; for prepare, the 10.3 source line) taken out, what is left may only join them. Our threshold:
    // no digit, at most 15 words.
    let rest = a;
    for (const w of [...want[id], ...(cardOf[id] ? [norm(cardOf[id].title), norm(cardOf[id].source)] : [norm(ACTIONS_SOURCE)])]) rest = rest.split(w).join(' ');
    rest = norm(rest);
    const words = rest.split(/\s+/).filter((x) => /\p{L}/u.test(x)).length;
    check(`chip "${id}" answer adds nothing beyond the approved lines (the rest has no digit and at most 15 words)`, !/\d/.test(rest) && words <= 15, JSON.stringify(rest.slice(0, 160)));
  }

  await clickChip(page, 'where');
  await page.waitForTimeout(800);
  const aWhere = await answer(page);
  // SPEC 10.5: "Lúc {time}, tâm bão ở khoảng {lat}° Bắc, {lon}° Đông, sức gió cấp {n} (ước tính)." At now: 19.0 N, 115.8 E, 130 kt -> 17.
  const wm = aWhere.match(/Lúc (\d{2}:\d{2}, \d{2}\/\d{2}), tâm bão ở khoảng (\d+(?:[.,]\d+)?)° Bắc, (\d+(?:[.,]\d+)?)° Đông, sức gió cấp (\d+) \(ước tính\)\./);
  const num = (x) => Number(String(x).replace(',', '.'));
  check('chip "where" answer follows the SPEC 10.5 sentence', !!wm, aWhere);
  check('chip "where" answers with the selected time (easy mode: now, 07:00, 05/09)', wm?.[1] === '07:00, 05/09', aWhere);
  check('chip "where" gives the storm position at now (19.0° Bắc, 115.8° Đông, within 0.1°)', !!wm && Math.abs(num(wm[2]) - 19.0) <= 0.1 && Math.abs(num(wm[3]) - 115.8) <= 0.1, aWhere);
  check('chip "where" gives wind level 17 (130 kt at now)', wm?.[4] === '17', aWhere);
  check('chip "where" answer never says "tôi"', !TOI.test(aWhere), aWhere);
  check('chip "where" answer: at most two sentences, no emoji', sentences(aWhere) <= 2 && !EMOJI.test(aWhere), aWhere);

  const before = (await page.evaluate(() => window.__app.events())).filter((e) => e.type === 'check_start').length;
  await clickChip(page, 'affected');
  await page.waitForTimeout(1500);
  const after = (await page.evaluate(() => window.__app.events())).filter((e) => e.type === 'check_start').length;
  check('chip "affected" runs the same flow as btn-check (a new check_start, verdict shown)', after === before + 1 && (await visible(page, 'verdict')), `${before} -> ${after}`);

  await clickChip(page, 'source');
  await waitView(page, 'satellite').catch(() => {});
  check('chip "source" opens the satellite view (__app.view === "satellite")', (await page.evaluate(() => window.__app.view)) === 'satellite');

  const chipEvents = (await page.evaluate(() => window.__app.events())).filter((e) => e.type === 'chip').map((e) => e.data?.id);
  check('every chip press is logged as chip { id }', ['when', 'prepare', 'windlevel', 'radius', 'where', 'affected', 'source'].every((id) => chipEvents.includes(id)), chipEvents.join(','));
  await ctx.close();
});

// SPEC 6.4: chip "when" answers from the current verdict. For an unaffected place the verdict has no time inside,
// so the answer gives no time window ("{first} - {last}"), and any time or km it gives is the verdict's closest approach.
await scenario('chip "when" for an unaffected place (1440x900)', async () => {
  const ctx = await context({ geo: HCM });
  const page = await open(ctx);
  await skipOnboarding(page);
  await clickChip(page, 'when');
  await waitVisible(page, 'verdict', 15000).catch(() => {});
  await page.waitForTimeout(800);
  await clickChip(page, 'when');
  await page.waitForTimeout(500);
  const a = await answer(page);
  const v = await page.evaluate(() => window.__app.verdict);
  check('(unaffected) the verdict is unaffected', v?.affected === false, JSON.stringify(v));
  check('(unaffected) chip "when" shows assistant-answer text', a.length > 0, a);
  const times = [...a.matchAll(new RegExp(TIME_IN.source, 'g'))].map((m) => m[0]);
  check('(unaffected) chip "when" gives no time window (at most one time)', times.length <= 1, a);
  check('(unaffected) any time in the answer is the closest approach time (closest.time, Vietnam time)', !!v?.closest && times.every((t) => t === vnTime(v.closest.time)), `${times.join(', ')} / want ${v?.closest ? vnTime(v.closest.time) : '-'}`);
  const kms = [...a.matchAll(/(\d[\d.,\s]*?)\s*km/g)].map((m) => parseKm(m[1]));
  check('(unaffected) any km figure in the answer is the closest distance (within 1 % or 1 km)', !!v?.closest && kms.every((k) => Math.abs(k - v.closest.distanceKm) <= Math.max(1, v.closest.distanceKm * 0.01)), `${kms.join(', ')} / want ${v?.closest?.distanceKm}`);
  check('(unaffected) chip "when" answer speaks as "mình" to "bạn", at most two sentences, no emoji', voiceOk(a) && sentences(a) <= 2 && !EMOJI.test(a), a);
  await ctx.close();
});

// SPEC 6.4: chip "affected" runs the same flow as btn-check, so with location refused the province picker shows.
await scenario('chip "affected" with location refused shows the province picker', async () => {
  const ctx = await context({ geo: false });
  const page = await open(ctx);
  await skipOnboarding(page);
  await clickChip(page, 'affected');
  await waitVisible(page, 'province-picker', 3000).catch(() => {});
  check('chip "affected" with location refused shows the province picker within 3 s', await visible(page, 'province-picker'));
  await ctx.close();
});

// SPEC 6.4: "where" answers for the selected time. In full mode that is the slider's time, not now.
await scenario('chip "where" follows the time slider in full mode (1440x900)', async () => {
  const ctx = await context();
  const page = await open(ctx, url({ mode: 'full' }));
  await skipOnboarding(page);
  const slider = T(page, 'time-slider').first();
  const input = (await slider.evaluate((e) => e.tagName).catch(() => '')) === 'INPUT' ? slider : slider.locator('input[type=range]').first();
  const { min } = await input.evaluate((e) => ({ min: +e.min }));
  const step = +((await input.getAttribute('step')) ?? 1) || 1;
  await input.fill(String(min + 20 * step)); // first point + 60 h = 2024-09-02 00:00 UTC
  await page.waitForTimeout(500);
  const readout = await text(page, 'time-readout');
  await clickChip(page, 'where');
  await page.waitForTimeout(800);
  const a = await answer(page);
  const wm = a.match(/Lúc (\d{2}:\d{2}, \d{2}\/\d{2}), tâm bão ở khoảng (\d+(?:[.,]\d+)?)° Bắc, (\d+(?:[.,]\d+)?)° Đông, sức gió cấp (\d+) \(ước tính\)\./);
  const num = (x) => Number(String(x).replace(',', '.'));
  const p = TRACK?.points.find((x) => Date.parse(x.t) === Date.parse('2024-09-02T00:00:00Z'));
  check('(full) chip "where" follows the SPEC 10.5 sentence', !!wm, a);
  check('(full) chip "where" time equals time-readout after moving the slider', !!wm && readout.endsWith(wm[1]) && wm[1] === vnTime('2024-09-02T00:00:00Z'), `${wm?.[1]} / readout ${readout}`);
  check('(full) chip "where" position is the yagi.json point at that time (within 0.1°)', !!wm && !!p && Math.abs(num(wm[2]) - p.lat) <= 0.1 && Math.abs(num(wm[3]) - p.lon) <= 0.1, `${a} / want ${p?.lat}, ${p?.lon}`);
  check('(full) chip "where" wind level is windLevel of that point', !!wm && !!p && wm[4] === String(refWindLevel(p.windKt)), `${wm?.[4]} / want ${p ? refWindLevel(p.windKt) : '-'}`);
  await ctx.close();
});

await finish();
