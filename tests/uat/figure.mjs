// UAT, SPEC 6.8: the animated Usui-chan figure [assistant-figure], its data-clip per context, reduced motion,
// the usui-pose.webp fallback, and no drawing while it is off screen or the tab is hidden.
// UAT_URL=http://localhost:5195/?test=1 node tests/uat/figure.mjs
import {
  CLEAR_ONCE, CLIP_WATCH, DRAW_COUNTER, HAI_PHONG, HCM, SAME_PX, T, check, clipSummary, clipsSince, context, finish, open,
  otherDraws, pageNow, pixelDiff, runCheck, scenario, skipOnboarding, visible, waitClips, waitView, waitVisible,
} from './lib.mjs';

const FIG = '[data-test="assistant-figure"]';
const shownFigure = (page) => page.locator(FIG).filter({ visible: true }).first();
const figureShown = (page) => shownFigure(page).isVisible().catch(() => false);
const tokensOf = (seen) => new Set(seen.flatMap((e) => e.tokens));
// Our thresholds: a context's clip shows within 3 s of the action, and the figure is back to idle within 10 s.
const CLIP_MS = 3000;
const IDLE_MS = 10000;

/** Checks that the figure plays `main` (and `talk` when `withTalk`) after page time `since`. */
async function clipCheck(page, since, tag, main, withTalk) {
  const seen = await waitClips(page, since, withTalk ? [main, 'talk'] : [main], CLIP_MS);
  const all = tokensOf(seen);
  check(`${tag}: a visible assistant-figure plays "${main}" (data-clip)`, all.has(main), clipSummary(seen));
  if (withTalk) check(`${tag}: it plays "talk" with it`, all.has('talk'), clipSummary(seen));
  return seen;
}
async function idleCheck(page, since, tag) {
  const seen = await waitClips(page, since, ['idle'], IDLE_MS);
  check(`${tag}: then the figure goes back to "idle" (within 10 s, our threshold)`, tokensOf(seen).has('idle'), clipSummary(seen));
}
/** Wait (up to 8 s) for the figure to be idle, so the next context's clip shows as a change of data-clip. */
const settle = (page, since) => waitClips(page, since, ['idle'], 8000);

async function openSheet(page) {
  if (!(await visible(page, 'assistant-sheet'))) {
    await T(page, 'assistant-avatar').first().click();
    await waitVisible(page, 'assistant-sheet');
  }
}
async function chip(page, id) {
  await openSheet(page);
  const since = await pageNow(page);
  await page.locator(`[data-test="assistant-sheet"] [data-test="chip"][data-chip="${id}"]`).first().click();
  return since;
}
async function heightCheck(page, tag, want) {
  const b = await shownFigure(page).boundingBox().catch(() => null);
  // SPEC: about 120 px tall on phone and 160 px on desktop. Our threshold: within 25 %.
  check(`${tag} assistant-figure is about ${want} px tall (within 25 %, our threshold)`, !!b && Math.abs(b.height - want) <= want * 0.25, JSON.stringify(b));
}

await scenario('onboarding step 1: hello, then idle (1440x900)', async () => {
  const ctx = await context({ init: [CLEAR_ONCE, CLIP_WATCH] });
  const page = await open(ctx);
  const since = 0;
  check('(onboarding) the onboarding is open on a first visit', await visible(page, 'onboarding'));
  await page.waitForTimeout(500);
  check('(onboarding) a figure is shown on step 1', await figureShown(page));
  await heightCheck(page, '(onboarding step 1, 1440)', 160);
  await clipCheck(page, since, '(onboarding step 1)', 'hello', false);
  await idleCheck(page, since, '(onboarding step 1)');
  await ctx.close();
});

await scenario('question sheet and chips (1440x900)', async () => {
  const ctx = await context({ geo: HAI_PHONG, init: CLIP_WATCH });
  // SPEC 6.8: the figure is drawn from the club's model usui-chan.glb, so the page fetches that file.
  const requests = [];
  ctx.on('request', (r) => requests.push(r.url()));
  const page = await open(ctx);
  await skipOnboarding(page);
  // SPEC 6.8: the 56 px corner button stays the static usui-avatar.webp portrait.
  const av = await T(page, 'assistant-avatar').first().evaluate((e) => {
    const im = e.matches('img') ? e : e.querySelector('img');
    return { src: im ? im.currentSrc || im.src : getComputedStyle(e).backgroundImage, canvas: !!e.querySelector('canvas') || e.matches('canvas') };
  }).catch(() => null);
  check('(sheet) assistant-avatar is still the static usui-avatar.webp portrait (no canvas in it)', !!av && /usui-avatar/.test(av.src) && !av.canvas, JSON.stringify(av));

  let since = await pageNow(page);
  await openSheet(page);
  await page.waitForTimeout(300);
  check('(sheet) a figure is shown in the open sheet', await figureShown(page));
  await heightCheck(page, '(sheet 1440)', 160);
  await clipCheck(page, since, '(sheet, first open in the session)', 'hello', false);
  const glb = requests.filter((u) => /usui-chan[^/?#]*\.glb(\?|#|$)/.test(u));
  check('(sheet) the page has fetched the model usui-chan.glb by the time the figure shows', glb.length > 0, glb.slice(0, 2).join(' ') || `${requests.length} requests, none for usui-chan .glb`);
  // With motion allowed the figure is animated, not a still picture: its image changes over 1 s. Our threshold: more
  // than SAME_PX (0.5 %) of its pixels change in at least one of four 1 s windows after its canvas shows.
  await page.waitForFunction((sel) => [...document.querySelectorAll(sel)].some((f) => [f, ...f.querySelectorAll('canvas')].some((c) => c.tagName === 'CANVAS' && c.getClientRects().length > 0)), FIG, { timeout: 8000 }).catch(() => {});
  let moved = 0;
  for (let k = 0; k < 4 && moved <= SAME_PX; k++) {
    const a = await shownFigure(page).screenshot().catch(() => null);
    await page.waitForTimeout(1000);
    const b = await shownFigure(page).screenshot().catch(() => null);
    moved = Math.max(moved, a && b ? await pixelDiff(page, a, b) : 0);
  }
  check('(sheet, motion allowed) the figure image changes over 1 s (it is animated)', moved > SAME_PX, `${(moved * 100).toFixed(2)} % of pixels changed at most`);
  await idleCheck(page, since, '(sheet, first open)');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  since = await pageNow(page);
  await openSheet(page);
  await clipCheck(page, since, '(sheet, opened again)', 'nod', false);
  await idleCheck(page, since, '(sheet, opened again)');

  // Each chip after the figure is idle again, so its clip is a change of data-clip.
  since = await chip(page, 'prepare');
  await clipCheck(page, since, '(chip prepare)', 'nod', true);
  await settle(page, since);

  const m0 = await T(page, 'storm-marker').first().boundingBox().catch(() => null);
  since = await chip(page, 'where');
  await clipCheck(page, since, '(chip where)', 'point', true);
  await page.waitForTimeout(800);
  const m1 = await T(page, 'storm-marker').first().boundingBox().catch(() => null);
  // SPEC 6.4: "where" highlights the marker with no camera move.
  check('(chip where) no camera move: storm-marker stays where it was (within 1 px)', !!m0 && !!m1 && Math.abs(m0.x - m1.x) <= 1 && Math.abs(m0.y - m1.y) <= 1, `${JSON.stringify(m0)} -> ${JSON.stringify(m1)}`);
  await settle(page, since);

  since = await chip(page, 'windlevel');
  await clipCheck(page, since, '(chip windlevel)', 'nod', true);
  await settle(page, since);

  since = await chip(page, 'affected');
  await waitVisible(page, 'verdict', 15000).catch(() => {});
  await clipCheck(page, since, '(chip affected, affected answer)', 'alert', true);
  await settle(page, since);

  since = await chip(page, 'radius');
  await clipCheck(page, since, '(chip radius)', 'nod', true);
  await settle(page, since);

  since = await chip(page, 'when');
  await clipCheck(page, since, '(chip when, affected answer)', 'alert', true);
  await settle(page, since);

  since = await chip(page, 'source');
  await waitView(page, 'satellite', 3000).catch(() => {});
  await page.waitForTimeout(1300);
  check('(chip source) the satellite view opens with a figure shown (first visit)', await figureShown(page));
  await clipCheck(page, since, '(chip source / satellite first visit)', 'lookUp', true);
  await ctx.close();
});

await scenario('unaffected answer: relief + talk (1440x900)', async () => {
  const ctx = await context({ geo: HCM, init: CLIP_WATCH });
  const page = await open(ctx);
  await skipOnboarding(page);
  const t0 = await pageNow(page);
  await openSheet(page);
  await settle(page, t0);
  let since = await chip(page, 'affected');
  await waitVisible(page, 'verdict', 15000).catch(() => {});
  await clipCheck(page, since, '(chip affected, unaffected answer)', 'relief', true);
  await settle(page, since);
  since = await chip(page, 'when');
  await clipCheck(page, since, '(chip when, unaffected answer)', 'relief', true);
  await ctx.close();
});

await scenario('satellite view first visit from btn-source: lookUp (1440x900)', async () => {
  const ctx = await context({ init: CLIP_WATCH });
  const page = await open(ctx);
  await skipOnboarding(page);
  const since = await pageNow(page);
  await T(page, 'btn-source').first().click();
  await waitView(page, 'satellite', 3000).catch(() => {});
  await page.waitForTimeout(1300);
  check('(satellite) a figure is shown on the first visit', await figureShown(page));
  await clipCheck(page, since, '(satellite first visit)', 'lookUp', true);
  // SPEC 6.8: Usui-chan speaks on the satellite view's first visit only. On a second visit no lookUp plays.
  await page.keyboard.press('Escape');
  await waitView(page, 'map', 3000).catch(() => {});
  await page.waitForTimeout(1500);
  const again = await pageNow(page);
  await T(page, 'btn-source').first().click();
  await waitView(page, 'satellite', 3000).catch(() => {});
  await page.waitForTimeout(CLIP_MS + 1300);
  const seen2 = await clipsSince(page, again);
  check('(satellite second visit) no "lookUp" plays again', !tokensOf(seen2).has('lookUp'), clipSummary(seen2));
  await ctx.close();
});

await scenario('waiting for location: think (1440x900)', async () => {
  const ctx = await context({
    init: [
      CLIP_WATCH,
      () => {
        Object.defineProperty(navigator.geolocation, 'getCurrentPosition', { value: () => {}, configurable: true });
        Object.defineProperty(navigator.geolocation, 'watchPosition', { value: () => 1, configurable: true });
      },
    ],
  });
  const page = await open(ctx);
  await skipOnboarding(page);
  const t0 = await pageNow(page);
  await openSheet(page);
  await settle(page, t0);
  const since = await chip(page, 'affected');
  await clipCheck(page, since, '(waiting for location)', 'think', false);
  await ctx.close();
});

await scenario('reduced motion: the figure holds still (375x812)', async () => {
  const ctx = await context({ phone: true, reducedMotion: 'reduce', init: CLIP_WATCH });
  const page = await open(ctx);
  await skipOnboarding(page);
  await openSheet(page);
  await page.waitForTimeout(800);
  check('(reduce) a figure is shown in the open sheet', await figureShown(page));
  await heightCheck(page, '(sheet 375)', 120);
  const fig = shownFigure(page);
  const since = await pageNow(page);
  const a = await fig.screenshot().catch(() => null);
  await page.waitForTimeout(1000);
  const b = await fig.screenshot().catch(() => null);
  await page.waitForTimeout(1000);
  const d = a && b ? await pixelDiff(page, a, b) : 1;
  check('(reduce) the figure image does not change over 1 s', !!a && !!b && d <= SAME_PX, `${(d * 100).toFixed(2)} % of pixels changed`);
  const seen = await clipsSince(page, since);
  check('(reduce) data-clip does not change over 2 s (no loop)', seen.length === 0, clipSummary(seen));
  await ctx.close();
});

/** What a shown figure displays: the usui-pose image (img or background) and whether a canvas in it is visible. */
const figureLook = (page) =>
  page.evaluate(async () => {
    const figs = [...document.querySelectorAll('[data-test="assistant-figure"]')].filter((e) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden');
    const shown = (e) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden' && Number(getComputedStyle(e).opacity) > 0.05;
    for (const f of figs) {
      const canvas = [f, ...f.querySelectorAll('canvas')].some((c) => c.tagName === 'CANVAS' && shown(c));
      const im = f.matches('img') ? f : [...f.querySelectorAll('img')].find(shown);
      if (im) {
        if (!im.complete) await new Promise((r) => { im.onload = im.onerror = r; setTimeout(r, 3000); });
        return { src: im.currentSrc || im.src, ok: im.naturalWidth > 0, canvas };
      }
      const bg = getComputedStyle(f).backgroundImage;
      if (bg && bg !== 'none') return { src: bg, ok: true, canvas };
      return { src: null, ok: false, canvas };
    }
    return { src: null, ok: false, canvas: false, figures: figs.length };
  });

await scenario('fallback: usui-pose.webp shows when the model cannot load (1440x900)', async () => {
  const ctx = await context();
  await ctx.route(/\.glb(\?|$)/, (r) => r.abort());
  const page = await open(ctx);
  await skipOnboarding(page);
  await openSheet(page);
  await page.waitForTimeout(1500);
  const fb = await figureLook(page);
  check('(no model) the figure shows the usui-pose.webp image instead', fb.ok && /usui-pose/.test(fb.src ?? ''), JSON.stringify(fb));
  await ctx.close();
});

// SPEC 6.8: "Until it loads ... the usui-pose.webp image shows instead". The .glb is held back until the test lets
// it through: meanwhile the figure shows the image; once the model has loaded, a canvas replaces the image.
await scenario('fallback: usui-pose.webp shows until the model loads, then the canvas replaces it (1440x900)', async () => {
  const ctx = await context();
  let release;
  const gate = new Promise((r) => (release = r));
  await ctx.route(/\.glb(\?|$)/, async (r) => {
    await gate;
    await r.continue().catch(() => {});
  });
  const page = await open(ctx);
  await skipOnboarding(page);
  await openSheet(page);
  await page.waitForTimeout(800);
  const during = await figureLook(page);
  check('(model loading) the figure shows the usui-pose.webp image while the model has not loaded', during.ok && /usui-pose/.test(during.src ?? '') && !during.canvas, JSON.stringify(during));
  release();
  let later = during;
  for (const t0 = Date.now(); Date.now() - t0 < 8000 && !(later.canvas && !/usui-pose/.test(later.src ?? '')); await page.waitForTimeout(250)) later = await figureLook(page);
  check('(model loaded) a canvas shows in the figure and the usui-pose image is gone (within 8 s)', later.canvas && !/usui-pose/.test(later.src ?? ''), JSON.stringify(later));
  await ctx.close();
});

await scenario('nothing is drawn while the figure is off screen or the tab is hidden (1440x900)', async () => {
  const ctx = await context({ init: DRAW_COUNTER });
  const page = await open(ctx);
  await skipOnboarding(page);
  await openSheet(page);
  await page.waitForTimeout(1500);
  const o0 = await otherDraws(page);
  await page.waitForTimeout(1000);
  const o1 = await otherDraws(page);
  check('(sheet open) the figure is drawn with WebGL on its own canvas (draw calls outside the globe in 1 s)', o1 > o0, `${o1 - o0} draw calls`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1000);
  const c0 = await otherDraws(page);
  await page.waitForTimeout(1000);
  const c1 = await otherDraws(page);
  check('(sheet closed) no figure is on screen, so nothing outside the globe is drawn in 1 s', c1 === c0, `${c1 - c0} draw calls`);
  await openSheet(page);
  await page.waitForTimeout(1000);
  await page.evaluate(() => window.__uatHide());
  await page.waitForTimeout(200);
  const h0 = await page.evaluate(() => window.__uatDraws);
  await page.waitForTimeout(1000);
  const h1 = await page.evaluate(() => window.__uatDraws);
  check('(tab hidden, sheet open) no WebGL draw call at all in 1 s', h1 === h0, `${h1 - h0} draw calls`);
  await ctx.close();
});

await finish();
