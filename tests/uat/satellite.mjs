// UAT, SPEC 6.7 + 10.4 + 10.6: satellite close-up (GK-2A), turning and zooming the model, HUD, back to the map, reduced motion.
// UAT_URL=http://localhost:5195/?test=1 node tests/uat/satellite.mjs
import {
  FLIGHT_PROBE, HUD_HEADER, HUD_LABELS, HUD_PART_LABELS, MOVING_PX, SAME_PX, SAT_FACTS, SAT_HEADING, SAT_SOURCE, T,
  canvasShot, check, context, finish, hudLabels, hudLines, leadersOf, norm, open, pinch, pixelDiff, satState, scenario,
  skipOnboarding, text, timeFlight, touchPath, viewBox, visible, waitView,
} from './lib.mjs';

const view = (page) => page.evaluate(() => window.__app.view);
const pct = (x) => `${(x * 100).toFixed(2)} %`;
const box = (page, id) => T(page, id).first().boundingBox().catch(() => null);
const finite = (s) => !!s && ['yaw', 'pitch', 'zoom'].every((k) => typeof s[k] === 'number' && Number.isFinite(s[k]));
const inside = (p, b, m = 8) => !!b && p.x >= b.x - m && p.x <= b.x + b.width + m && p.y >= b.y - m && p.y <= b.y + b.height + m;
// Timing a flight of 0.8-1.2 s (SPEC 6.7). Time zero is the click, stamped inside the page (see timeFlight in lib.mjs).
// Our thresholds: the camera is still flying (over MOVING_PX of a 160 x 120 copy of the view changes between two copies,
// taken every 100 ms, or up to about 500 ms apart while the flight renders in software here) in some stretch that starts
// 300-800 ms after the click (a flight of 0.8 s or more is still moving then; a cut, or a flight of about 0.3 s or
// less, has stopped; the window is 500 ms wide so that at least one copy starts in it when copies are 500 ms apart),
// and is not flying in any stretch that starts at 1300 ms or later, up to 2.5 s (a flight of 1.2 s has ended; the slow
// automatic turn changes far fewer pixels than the flight).
const FLY_FROM = 300;
const FLY_TO = 800;
const STILL_FROM = 1300;
async function flightChecks(page, tag, target, start) {
  const f = await timeFlight(page, target, start, 2500);
  const prof = f.steps.map((s) => `${s.from}-${s.t}:${(s.diff * 100).toFixed(1)}`).join(' ');
  const early = f.steps.filter((s) => s.from >= FLY_FROM && s.from <= FLY_TO);
  const late = f.steps.filter((s) => s.from >= STILL_FROM);
  check(`${tag} the page saw the click (time zero for the flight checks)`, f.clicked);
  check(`${tag} __app.view becomes "${target}" within 1.25 s of the click`, f.viewMs !== null && f.viewMs <= 1250, `${f.viewMs === null ? 'never' : `${Math.round(f.viewMs)} ms`}`);
  check(`${tag} the camera is still flying in a stretch starting ${FLY_FROM}-${FLY_TO} ms after the click (not a cut; the flight lasts about 0.8 s or more)`, early.some((s) => s.diff > MOVING_PX), `ms:% changed ${prof}`);
  check(`${tag} the flight has ended by ${STILL_FROM} ms (no flying from 1.3 s to 2.5 s; it lasts about 1.2 s or less)`, late.length > 0 && late.every((s) => s.diff <= MOVING_PX), `ms:% changed ${prof}`);
}

async function hudChecks(page, tag) {
  check(`${tag} satellite-hud is visible`, await visible(page, 'satellite-hud'));
  const hud = norm(await T(page, 'satellite-hud').first().textContent().catch(() => ''));
  check(`${tag} the HUD shows the SPEC 10.6 header "${HUD_HEADER}"`, hud.includes(HUD_HEADER), hud.slice(0, 200));
  const all = await page.locator('[data-test="hud-label"]').evaluateAll((ls) => ls.map((l) => l.textContent.replace(/\s+/g, ' ').trim()));
  const texts = all.filter((t) => t !== HUD_HEADER);
  // The header may or may not be a hud-label; every other hud-label is one 10.6 string, each once.
  check(`${tag} the hud-labels are exactly the ${HUD_LABELS.length} SPEC 10.6 callouts (header aside), each once`, texts.length === HUD_LABELS.length && HUD_LABELS.every((l) => texts.filter((t) => t === l).length === 1), JSON.stringify(all));
  check(`${tag} no hud-label outside SPEC 10.6`, all.every((t) => t === HUD_HEADER || HUD_LABELS.includes(t)), JSON.stringify(all.filter((t) => t !== HUD_HEADER && !HUD_LABELS.includes(t))));
  // SPEC 6.7 "Labels are the strings of 10.6 only": the HUD's whole text is the header and the 10.6 labels, nothing else.
  let rest = hud;
  for (const s of [HUD_HEADER, ...HUD_LABELS]) rest = rest.replace(s, ' ');
  check(`${tag} the HUD holds no text besides the 10.6 header and labels`, hud.length > 0 && norm(rest) === '', JSON.stringify(norm(rest).slice(0, 160)));
  // SPEC 6.7: numbers in the HUD use the monospace system stack. Every run of digits (with its . , – separators),
  // except the "2" of the name GK-2A, sits in an element set in that stack: the element holding its text.
  const fonts = await page.evaluate(() => {
    const hud = document.querySelector('[data-test="satellite-hud"]');
    if (!hud) return null;
    const out = [];
    const w = document.createTreeWalker(hud, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const s = n.textContent;
      for (const m of s.matchAll(/\d[\d.,–]*/g)) {
        if (/GK-$/.test(s.slice(0, m.index)) && /^2A/.test(s.slice(m.index))) continue;
        out.push({ number: m[0], text: s.trim().slice(0, 60), font: getComputedStyle(n.parentElement).fontFamily });
      }
    }
    return out;
  });
  const badFont = (fonts ?? []).filter((x) => !/^\s*ui-monospace\b/.test(x.font) || !/monospace\s*$/.test(x.font));
  check(`${tag} every HUD number (GK-2A aside) is in the monospace stack (ui-monospace, ..., monospace)`, !!fonts && fonts.length > 0 && badFont.length === 0, JSON.stringify(badFont.slice(0, 3)));
}

/** The 10.6 labels on model parts, by part. */
const PARTS = { AMI: HUD_PART_LABELS[0], KSEM: HUD_PART_LABELS[1], wing: HUD_PART_LABELS[2], dish: HUD_PART_LABELS[3] };
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
/** Unwrapped yaw change from a to b (radians), for yaw that may wrap at ±π or 2π. */
const dYaw = (a, b) => {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
};
/** One anchor per part label: { label: {x, y} } (the first leader found for that label). */
const anchorMap = (leaders) => {
  const m = {};
  for (const l of leaders) if (!m[l.label]) m[l.label] = l.anchor;
  return m;
};
/** Mouse drag of (dx, dy) px from (cx, cy), in 4 moves. */
async function dragBy(page, cx, cy, dx, dy = 0) {
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let k = 1; k <= 4; k++) await page.mouse.move(cx + (dx * k) / 4, cy + (dy * k) / 4);
  await page.mouse.up();
  await page.mouse.move(5, 5);
  await page.waitForTimeout(150);
}
/** Press Tab (up to 40 times) until focus is on the 3D view: [satellite] itself or an element in it that is not a control. */
async function tabToView(page) {
  await page.evaluate(() => document.activeElement?.blur?.());
  for (let k = 0; k < 40; k++) {
    await page.keyboard.press('Tab');
    const ok = await page.evaluate(() => {
      const a = document.activeElement;
      if (!a || a === document.body) return false;
      const sat = a.closest('[data-test="satellite"]');
      return !!sat && !a.matches('button, a, input, select, textarea, [role=button]');
    });
    if (ok) return true;
  }
  return false;
}

/** Leaders of the labels on model parts, and the model's box. */
async function partLeaders(page) {
  const labels = (await hudLabels(page)).filter((l) => HUD_PART_LABELS.includes(l.text));
  return { leaders: leadersOf(await hudLines(page), labels, 12, await viewBox(page)), model: await box(page, 'satellite-model') };
}

await scenario('fly to the satellite and back (1440x900, motion allowed)', async () => {
  const ctx = await context({ reducedMotion: 'no-preference', init: FLIGHT_PROBE });
  const page = await open(ctx);
  await skipOnboarding(page);
  await page.mouse.move(5, 5);
  check('__app.view starts as "map"', (await view(page)) === 'map', await view(page));
  check('btn-source reads "Nguồn dữ liệu"', (await text(page, 'btn-source')) === 'Nguồn dữ liệu', await text(page, 'btn-source'));
  await flightChecks(page, '(out)', 'satellite', () => T(page, 'btn-source').first().click());
  await page.mouse.move(5, 5);
  check('btn-source -> __app.view "satellite"', (await view(page)) === 'satellite', await view(page));
  check('satellite-model is visible', await visible(page, 'satellite-model'));
  check('satellite-info is visible', await visible(page, 'satellite-info'));

  // SPEC 6.7: the model fills about half of the view's shorter side. Our threshold: its larger side is 35-70 % of it.
  const m = await box(page, 'satellite-model');
  const vb = await viewBox(page);
  const fill = m && vb ? Math.max(m.width, m.height) / Math.min(vb.width, vb.height) : 0;
  check('the model fills about half of the view\'s shorter side (35-70 %, our threshold)', fill >= 0.35 && fill <= 0.7, `${pct(fill)}; model ${JSON.stringify(m)} in ${JSON.stringify(vb)}`);
  const s0 = await satState(page);
  check('__app.satellite has finite yaw, pitch and zoom', finite(s0), JSON.stringify(s0));
  check('__app.satellite.zoom is 1 on arrival (the arrival distance)', !!s0 && Math.abs(s0.zoom - 1) <= 0.01, JSON.stringify(s0));
  // SPEC 6.7: a slow automatic turn runs while the user is not touching the model.
  await page.waitForTimeout(2000);
  const s1 = await satState(page);
  check('with motion allowed and no input, the model turns by itself (__app.satellite.yaw changes in 2 s)', finite(s0) && finite(s1) && Math.abs(s1.yaw - s0.yaw) > 1e-4, `${s0?.yaw} -> ${s1?.yaw}`);

  // SPEC 6.7: the automatic turn runs "while the user is not touching it". Holding the mouse button down on the view
  // without moving stops it (measured from 300 ms after the press, so a short ease-out is allowed).
  {
    const v = await viewBox(page);
    await page.mouse.move(v ? v.x + v.width / 2 : 500, v ? v.y + v.height / 2 : 450);
    await page.mouse.down();
    await page.waitForTimeout(300);
    const h0 = await satState(page);
    await page.waitForTimeout(1000);
    const h1 = await satState(page);
    await page.mouse.up();
    await page.mouse.move(5, 5);
    check('with motion allowed, holding the mouse down on the view (no move) for 1 s stops the automatic turn (yaw unchanged)', finite(h0) && finite(h1) && Math.abs(dYaw(h0.yaw, h1.yaw)) <= 1e-3, `${h0?.yaw} -> ${h1?.yaw}`);
    await page.waitForTimeout(1000);
  }

  await hudChecks(page, '(motion)');
  const { leaders, model } = await partLeaders(page);
  check('at least one part label (AMI, KSEM, wing, dish) has a leader line in the HUD', leaders.length > 0, `${leaders.length} leaders`);
  const out = leaders.filter((l) => !inside(l.anchor, model));
  check('every part-label leader ends inside the model\'s box on screen (8 px margin, our threshold)', leaders.length > 0 && out.length === 0, JSON.stringify(out.slice(0, 3)));
  // SPEC 6.7: the leaders follow the parts as the model turns, also under the automatic turn (not only after input).
  // Wait (up to 15 s) until the automatic turn has moved yaw by 10° or more, then compare the anchors.
  {
    const y0 = (await satState(page))?.yaw;
    const a0 = anchorMap(leaders);
    let turned = 0;
    for (const t0 = Date.now(); Date.now() - t0 < 15000 && Math.abs(turned) < (10 * Math.PI) / 180; await page.waitForTimeout(250)) turned = dYaw(y0, (await satState(page))?.yaw ?? y0);
    const later = await partLeaders(page);
    const a1 = anchorMap(later.leaders);
    const both = Object.keys(a0).filter((k) => a1[k]);
    const movedAny = both.some((k) => dist(a0[k], a1[k]) > 2);
    check('under the automatic turn (yaw 10° on), a part-label leader end has moved more than 2 px with its part', Math.abs(turned) >= (10 * Math.PI) / 180 && movedAny, `yaw turned ${((turned * 180) / Math.PI).toFixed(1)}°; ${JSON.stringify(a0)} -> ${JSON.stringify(a1)}`);
    const out1 = later.leaders.filter((l) => !inside(l.anchor, later.model));
    check('under the automatic turn, every part-label leader still ends inside the model\'s box (8 px margin)', later.leaders.length > 0 && out1.length === 0, JSON.stringify(out1.slice(0, 3)));
  }

  const info = await text(page, 'satellite-info');
  check('satellite-info names GK-2A', info.includes('GK-2A'), info.slice(0, 160));
  // SPEC 10.4: heading, the approved facts word for word in order, then the source line.
  check(`satellite-info has the heading "${SAT_HEADING}"`, info.includes(SAT_HEADING));
  const missing = SAT_FACTS.filter((f) => !info.includes(norm(f)));
  check('satellite-info has every SPEC 10.4 fact word for word', missing.length === 0, missing.map((x) => x.slice(0, 50)).join(' | '));
  const idx = SAT_FACTS.map((f) => info.indexOf(norm(f)));
  check('satellite-info facts are in SPEC 10.4 order, after the heading', idx.every((x, i) => x > info.indexOf(SAT_HEADING) && (i === 0 || x > idx[i - 1])), idx.join(','));
  const srcAt = info.indexOf(SAT_SOURCE);
  check('satellite-info ends its facts with the SPEC 10.4 source line', srcAt >= 0 && srcAt > Math.max(...idx), `${srcAt}`);
  const srcCount = info.split('Nguồn:').length - 1;
  check('satellite-info has exactly one source line (one "Nguồn:")', srcCount === 1 && info.split(SAT_SOURCE).length === 2, `${srcCount}`);
  check('btn-back reads "Quay lại bản đồ"', (await text(page, 'btn-back')) === 'Quay lại bản đồ', await text(page, 'btn-back'));
  // SPEC 6.7 "the facts of section 10.4 only": with the heading, the facts, the source line and btn-back taken out,
  // nothing is left in satellite-info.
  let rest = info;
  for (const s of [SAT_HEADING, ...SAT_FACTS.map(norm), SAT_SOURCE, await text(page, 'btn-back')]) if (s) rest = rest.replace(s, ' ');
  check('satellite-info holds nothing besides the 10.4 heading, facts, source line and btn-back', norm(rest) === '', JSON.stringify(norm(rest).slice(0, 160)));
  // SPEC 10: each block ends with its source line, shown in small text (font size below the root font size).
  const srcFs = await page.evaluate((src) => {
    const info = document.querySelector('[data-test="satellite-info"]');
    const norm = (s) => (s ?? '').replace(/\s+/g, ' ').trim();
    const els = info ? [...info.querySelectorAll('*')].filter((e) => norm(e.textContent) === src) : [];
    const e = els[els.length - 1];
    return e ? { src: parseFloat(getComputedStyle(e).fontSize), root: parseFloat(getComputedStyle(document.documentElement).fontSize) } : null;
  }, SAT_SOURCE);
  check('the satellite-info source line is in small text (font size below the root font size)', !!srcFs && srcFs.src < srcFs.root, JSON.stringify(srcFs));

  await flightChecks(page, '(back)', 'map', () => T(page, 'btn-back').first().click());
  check('btn-back -> __app.view "map"', (await view(page)) === 'map', await view(page));
  check('satellite-info is hidden back on the map', !(await visible(page, 'satellite-info')));
  check('satellite-hud is hidden back on the map', !(await visible(page, 'satellite-hud')));

  await T(page, 'btn-source').first().click();
  await waitView(page, 'satellite', 3000).catch(() => {});
  await page.waitForTimeout(1500);
  await page.keyboard.press('Escape');
  await waitView(page, 'map', 3000).catch(() => {});
  check('Esc in the satellite view -> __app.view "map"', (await view(page)) === 'map', await view(page));
  await ctx.close();
});

await scenario('turn and zoom the model with mouse and keys (1440x900, reduced motion)', async () => {
  // Reduced motion: no automatic turn, so only the input changes __app.satellite and the picture.
  const ctx = await context({ reducedMotion: 'reduce' });
  const page = await open(ctx);
  await skipOnboarding(page);
  await T(page, 'btn-source').first().click();
  await waitView(page, 'satellite', 1000).catch(() => {});
  await page.mouse.move(5, 5);
  await page.waitForTimeout(500);
  const vb = await viewBox(page);
  const cx = vb ? vb.x + vb.width / 2 : 500;
  const cy = vb ? vb.y + vb.height / 2 : 450;

  const s0 = await satState(page);
  const i0 = await canvasShot(page);
  await page.waitForTimeout(1500);
  const s1 = await satState(page);
  const i1 = await canvasShot(page);
  const still = await pixelDiff(page, i0, i1);
  check('(reduce) the automatic turn is off: __app.satellite.yaw is unchanged after 1.5 s', finite(s0) && finite(s1) && s1.yaw === s0.yaw && s1.pitch === s0.pitch, `${JSON.stringify(s0)} -> ${JSON.stringify(s1)}`);
  check('(reduce) the close-up picture is still with no input', still <= SAME_PX, pct(still));
  const before = await partLeaders(page);

  // Horizontal drag: yaw.
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let k = 1; k <= 10; k++) await page.mouse.move(cx + k * 15, cy);
  await page.mouse.up();
  await page.mouse.move(5, 5);
  await page.waitForTimeout(400);
  const s2 = await satState(page);
  const i2 = await canvasShot(page);
  const dragDiff = await pixelDiff(page, i1, i2);
  check('dragging sideways changes __app.satellite.yaw', finite(s1) && finite(s2) && Math.abs(s2.yaw - s1.yaw) > 1e-3, `${s1?.yaw} -> ${s2?.yaw}`);
  check('dragging sideways turns the picture', dragDiff > SAME_PX, pct(dragDiff));
  // Keep dragging sideways (up to 10 more drags) until yaw has turned 30° or more from s1.
  let s2b = s2;
  for (let k = 0; k < 10 && finite(s1) && finite(s2b) && Math.abs(dYaw(s1.yaw, s2b.yaw)) < Math.PI / 6; k++) {
    await dragBy(page, cx, cy, 150);
    s2b = await satState(page);
  }
  const after = await partLeaders(page);
  const out = after.leaders.filter((l) => !inside(l.anchor, after.model));
  check('after the turn, every part-label leader still ends inside the model\'s box (8 px margin)', after.leaders.length > 0 && out.length === 0, JSON.stringify(out.slice(0, 3)));

  // Vertical drag: pitch.
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let k = 1; k <= 10; k++) await page.mouse.move(cx, cy + k * 10);
  await page.mouse.up();
  await page.mouse.move(5, 5);
  await page.waitForTimeout(400);
  const s3 = await satState(page);
  check('dragging up or down changes __app.satellite.pitch', finite(s2b) && finite(s3) && Math.abs(s3.pitch - s2b.pitch) > 1e-3, `${s2b?.pitch} -> ${s3?.pitch}`);
  // SPEC 6.7: the leaders follow the parts as the model turns. After a yaw turn of 30° or more and a pitch turn, every
  // part anchor shown both before and after has moved more than 2 px (a part on the yaw axis still moves with pitch).
  {
    const a0 = anchorMap(before.leaders);
    const a1 = anchorMap((await partLeaders(page)).leaders);
    const both = Object.keys(a0).filter((k) => a1[k]);
    const still = both.filter((k) => dist(a0[k], a1[k]) <= 2);
    const yawTurn = finite(s1) && finite(s2b) ? Math.abs(dYaw(s1.yaw, s2b.yaw)) : 0;
    check('after a yaw turn of 30° or more and a pitch turn, every part-label leader end shown before and after has moved more than 2 px', yawTurn >= Math.PI / 6 && both.length >= 2 && still.length === 0, `yaw turned ${((yawTurn * 180) / Math.PI).toFixed(1)}°; compared ${both.length}; did not move: ${still.join(', ')}; ${JSON.stringify(a0)} -> ${JSON.stringify(a1)}`);
  }

  // Scroll zoom, clamped to 0.6x-2x of the arrival distance. SPEC does not say whether __app.satellite.zoom is the
  // distance factor (0.6..2) or the magnification (0.5..1/0.6); both are accepted. On screen, the model's size at the
  // two limits differs by about 2 / 0.6 = 3.3x (our threshold: 2.6x-4.2x).
  const sizeOf = async () => {
    const b = await box(page, 'satellite-model');
    return b ? Math.max(b.width, b.height) : 0;
  };
  await page.mouse.move(cx, cy);
  for (let k = 0; k < 20; k++) await page.mouse.wheel(0, -300);
  await page.waitForTimeout(600);
  const zIn = (await satState(page))?.zoom;
  const bigIn = await sizeOf();
  for (let k = 0; k < 40; k++) await page.mouse.wheel(0, 300);
  await page.waitForTimeout(600);
  const zOut = (await satState(page))?.zoom;
  const bigOut = await sizeOf();
  await page.mouse.move(5, 5);
  const ends = [zIn, zOut].map(Number).sort((a, b) => a - b);
  const limitsOk = [[0.6, 2], [0.5, 1 / 0.6]].some(([lo, hi]) => Math.abs(ends[0] - lo) <= 0.02 && Math.abs(ends[1] - hi) <= 0.02);
  check('scrolling far in and far out stops at the zoom limits (0.6x and 2x of the arrival distance)', limitsOk, `zoom after scrolling in ${zIn}, out ${zOut}`);
  const ratio = Math.max(bigIn, bigOut) / Math.max(1, Math.min(bigIn, bigOut));
  check('the model on screen at one zoom limit is about 3.3x its size at the other (2.6x-4.2x, our threshold)', ratio >= 2.6 && ratio <= 4.2, `${Math.round(bigIn)} px vs ${Math.round(bigOut)} px (${ratio.toFixed(2)}x)`);

  // Keyboard (SPEC 6.7): arrow keys turn the model "when the view has focus". The view must be reachable with Tab
  // (focus on [satellite] or a non-control element inside it, such as its canvas). If Tab cannot reach it, the check
  // fails and [satellite] is focused by script so the checks after it still run.
  const focused = await tabToView(page);
  check('Tab reaches the 3D view (focus on [satellite] or a non-control element in it)', focused, await page.evaluate(() => document.activeElement?.outerHTML?.slice(0, 120) ?? ''));
  if (!focused) await T(page, 'satellite').first().focus().catch(() => {});
  const startK = await satState(page);
  const anchorsK = anchorMap((await partLeaders(page)).leaders);
  for (let k = 0; k < 5; k++) await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(400);
  const sK = await satState(page);
  check('ArrowRight (view focused) changes __app.satellite.yaw', finite(startK) && finite(sK) && Math.abs(dYaw(startK.yaw, sK.yaw)) > 1e-3, `${startK?.yaw} -> ${sK?.yaw}${focused ? '' : ' (focus set on [satellite] by script)'}`);
  // The anchors are tied to the parts: turning there and back puts every anchor back where it was. Our threshold:
  // yaw back within 0.001 and each anchor within 2 px.
  for (let k = 0; k < 5; k++) await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(400);
  const sBack = await satState(page);
  const anchorsBack = anchorMap((await partLeaders(page)).leaders);
  const keysK = Object.keys(anchorsK);
  const off = keysK.filter((k) => !anchorsBack[k] || dist(anchorsK[k], anchorsBack[k]) > 2);
  check('5 x ArrowRight then 5 x ArrowLeft brings yaw back (within 0.001)', finite(startK) && finite(sBack) && Math.abs(dYaw(startK.yaw, sBack.yaw)) <= 1e-3, `${startK?.yaw} -> ${sK?.yaw} -> ${sBack?.yaw}`);
  check('... and every part-label leader end is back where it was (within 2 px)', keysK.length > 0 && off.length === 0, `${JSON.stringify(anchorsK)} -> ${JSON.stringify(anchorsBack)}`);
  for (let k = 0; k < 5; k++) await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(400);
  const sU = await satState(page);
  check('ArrowUp (view focused) turns the model (yaw or pitch changes)', finite(sU) && finite(sK) && (Math.abs(sU.pitch - sK.pitch) > 1e-3 || Math.abs(sU.yaw - sK.yaw) > 1e-3), `${JSON.stringify(sK)} -> ${JSON.stringify(sU)}`);
  check('Esc still goes back to the map after using the arrow keys', await page.keyboard.press('Escape').then(() => waitView(page, 'map', 1000)).then(() => true, () => false));
  await ctx.close();
});

// SPEC 6.7 / 10.6: the four part labels (AMI box, KSEM box, wing, dish) have leaders to their parts, the leaders
// follow the parts, and a label whose part faces away hides its leader. One full turn of yaw with small sideways drags
// (40 px each, up to 150), under reduced motion so only the drags turn the model.
await scenario('part leaders over a full turn (1440x900, reduced motion)', async () => {
  const ctx = await context({ reducedMotion: 'reduce' });
  const page = await open(ctx);
  await skipOnboarding(page);
  await T(page, 'btn-source').first().click();
  await waitView(page, 'satellite', 1000).catch(() => {});
  await page.mouse.move(5, 5);
  await page.waitForTimeout(500);
  const vb = await viewBox(page);
  const cx = vb ? vb.x + vb.width / 2 : 500;
  const cy = vb ? vb.y + vb.height / 2 : 450;

  // On arrival: the anchors shown are at different points (pairwise more than 10 px apart, our threshold).
  const first = anchorMap((await partLeaders(page)).leaders);
  const names = Object.keys(first);
  const close = [];
  for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) if (dist(first[names[i]], first[names[j]]) <= 10) close.push(`${names[i]} / ${names[j]}`);
  check('on arrival, at least two part-label leaders are shown and their ends are pairwise more than 10 px apart', names.length >= 2 && close.length === 0, `${names.length} shown; too close: ${close.join(', ')}; ${JSON.stringify(first)}`);

  const samples = [];
  let s = await satState(page);
  let total = 0;
  for (let k = 0; k < 150 && finite(s) && Math.abs(total) < 2 * Math.PI; k++) {
    const pl = await partLeaders(page);
    samples.push({ yaw: total, anchors: anchorMap(pl.leaders), outside: pl.leaders.filter((l) => !inside(l.anchor, pl.model)).length });
    await dragBy(page, cx, cy, 40);
    const s2 = await satState(page);
    if (!finite(s2)) break;
    total += dYaw(s.yaw, s2.yaw);
    s = s2;
  }
  check('sideways drags turn the model a full 360° of yaw', Math.abs(total) >= 2 * Math.PI, `${((total * 180) / Math.PI).toFixed(0)}° in ${samples.length} drags`);
  for (const [part, label] of Object.entries(PARTS)) {
    const n = samples.filter((x) => x.anchors[label]).length;
    check(`over the full turn, the ${part} label "${label}" has a leader at some yaw`, n > 0, `${n}/${samples.length} samples`);
  }
  // A part that faces away hides its leader. The AMI imager and the dish face one way (Earth), so over a full yaw turn
  // each faces away at some yaw and toward the viewer at another.
  for (const part of ['AMI', 'dish']) {
    const label = PARTS[part];
    const shown = samples.filter((x) => x.anchors[label]).length;
    check(`over the full turn, the ${part} leader is hidden at some yaw and shown at another (it hides when the part faces away)`, shown > 0 && shown < samples.length, `shown in ${shown}/${samples.length} samples`);
  }
  const outside = samples.filter((x) => x.outside > 0).length;
  check('at every yaw of the full turn, every part-label leader ends inside the model\'s box (8 px margin)', samples.length > 0 && outside === 0, `${outside}/${samples.length} samples with an end outside`);
  await ctx.close();
});

await scenario('turn with one finger and pinch to zoom (375x812 touch, reduced motion)', async () => {
  const ctx = await context({ phone: true, reducedMotion: 'reduce' });
  const page = await open(ctx);
  await skipOnboarding(page);
  await T(page, 'btn-source').first().click();
  await waitView(page, 'satellite', 1000).catch(() => {});
  await page.waitForTimeout(500);
  const vb = await viewBox(page);
  const cx = vb ? vb.x + vb.width / 2 : 187;
  const cy = vb ? vb.y + vb.height / 2 : 250;
  const s0 = await satState(page);
  await touchPath(page, Array.from({ length: 11 }, (_, k) => [[cx - 60 + k * 12, cy]]));
  await page.waitForTimeout(400);
  const s1 = await satState(page);
  check('(375) a one-finger drag changes __app.satellite.yaw', finite(s0) && finite(s1) && Math.abs(s1.yaw - s0.yaw) > 1e-3, `${s0?.yaw} -> ${s1?.yaw}`);
  await pinch(page, cx, cy, 40, 200);
  await page.waitForTimeout(400);
  const s2 = await satState(page);
  check('(375) a pinch changes __app.satellite.zoom', finite(s1) && finite(s2) && Math.abs(s2.zoom - s1.zoom) > 1e-3, `${s1?.zoom} -> ${s2?.zoom}`);
  const seen = [s2?.zoom];
  for (let k = 0; k < 5; k++) {
    await pinch(page, cx, cy, 40, 220);
    seen.push((await satState(page))?.zoom);
  }
  for (let k = 0; k < 10; k++) {
    await pinch(page, cx, cy, 220, 40);
    seen.push((await satState(page))?.zoom);
  }
  await page.waitForTimeout(300);
  seen.push((await satState(page))?.zoom);
  const ok = seen.every((z) => typeof z === 'number' && z >= 0.5 - 0.02 && z <= 2 + 0.02);
  check('(375) repeated pinches keep __app.satellite.zoom within the 0.6x-2x limits', ok, seen.map((z) => (typeof z === 'number' ? z.toFixed(3) : String(z))).join(','));
  await ctx.close();
});

await scenario('reduced motion: the view switches as a cut (375x812)', async () => {
  const ctx = await context({ reducedMotion: 'reduce', phone: true });
  const page = await open(ctx);
  await skipOnboarding(page);
  await page.mouse.move(5, 5);
  await page.waitForTimeout(500);
  const before = await canvasShot(page);
  // Time from the click as the page sees it (a capturing click listener) to the change of __app.view, measured in the
  // page, so the time Playwright spends before the click lands is not counted (same clock as the flight timing).
  const cutTimer = (view) =>
    page.evaluate((view) => {
      window.__uatCut = null;
      const onClick = () => {
        window.removeEventListener('click', onClick, true);
        const t0 = performance.now();
        const tick = () => {
          const dt = performance.now() - t0;
          if (window.__app.view === view) window.__uatCut = dt;
          else if (dt < 3000) requestAnimationFrame(tick);
          else window.__uatCut = Infinity;
        };
        tick();
        queueMicrotask(tick);
      };
      window.addEventListener('click', onClick, true);
    }, view);
  const cutMs = async () => {
    await page.waitForFunction(() => window.__uatCut !== null, null, { timeout: 4000 }).catch(() => {});
    return page.evaluate(() => window.__uatCut);
  };
  await cutTimer('satellite');
  await T(page, 'btn-source').first().click();
  const dt = await cutMs();
  check('(reduce) __app.view is "satellite" within 500 ms of the click', typeof dt === 'number' && dt <= 500, `${dt === null ? 'never' : Math.round(dt)} ms`);
  const shown = await T(page, 'satellite-info').first().waitFor({ state: 'visible', timeout: 500 }).then(() => true, () => false);
  check('(reduce) satellite-info is visible within 500 ms', shown);
  await cutTimer('map');
  await T(page, 'btn-back').first().click();
  const db = await cutMs();
  check('(reduce) btn-back returns to "map" within 500 ms of the click', typeof db === 'number' && db <= 500, `${db === null ? 'never' : Math.round(db)} ms`);
  // SPEC 6.7: btn-back flies back to the map, and the map view is fixed (6.2): the globe looks as it did before.
  await page.mouse.move(5, 5);
  await page.waitForTimeout(1000);
  const after = await canvasShot(page);
  const d = await pixelDiff(page, before, after);
  check('(reduce) after btn-back the map shows the same view as before the satellite view', d <= SAME_PX, `${pct(d)} of pixels changed`);
  const anims = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length);
  check('(reduce) no running CSS animations or transitions', anims === 0, `${anims}`);
  await ctx.close();
});

await finish();
