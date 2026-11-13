// UAT, SPEC 2 + 4 + 6: layout at phone and desktop width, light and dark; target sizes; no horizontal scroll;
// focus ring; no web font; no English on screen; demo label; phone/desktop split; reduced motion; no camera move after a verdict.
// UAT_URL=http://localhost:5195/?test=1 node tests/uat/layout.mjs
import { DEMO_LABEL, browser, DRAW_COUNTER, SAME_PX, canvasShot, pixelDiff, HAI_PHONG, SHOTS, T, check, context, finish, noHScroll, onTop, open, ready, scenario, skipOnboarding, text, url, visible, waitView, waitVisible } from './lib.mjs';

const DEMO = DEMO_LABEL;
// Same word list as tests/unit/i18n.test.ts; proper names (Yagi, GK-2A, GPS) are not on it.
const ENGLISH = ['button', 'click', 'settings', 'loading', 'error', 'close', 'next', 'back', 'skip', 'export', 'source', 'done', 'mode', 'theme', 'menu', 'open', 'cancel', 'ok', 'help', 'home', 'info'];
const ENGLISH_RE = new RegExp(`(^|[^A-Za-z])(${ENGLISH.join('|')})(?![A-Za-z])`, 'i');

/** Visible interactive targets smaller than 44x44. A radio or checkbox is measured by its label when it has one. */
const smallTargets = (page) =>
  page.evaluate(() => {
    const shown = (e) => {
      const r = e.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      for (let a = e; a; a = a.parentElement) {
        const cs = getComputedStyle(a);
        if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      }
      return true;
    };
    const bad = [];
    const q = 'button, input, select, a[href], summary, [role=button], [data-test^="chip"], [data-test="timeline-row"]';
    for (const e of document.querySelectorAll(q)) {
      if (!shown(e) && !(e.labels?.[0] && shown(e.labels[0]))) continue;
      let target = e;
      if (e.matches('input[type=radio], input[type=checkbox]')) target = e.labels?.[0] ?? e.closest('label') ?? e;
      const r = target.getBoundingClientRect();
      if (r.width < 44 || r.height < 44) bad.push(`${e.getAttribute('data-test') ?? e.tagName.toLowerCase()} ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    return bad;
  });

/** Tab through the page; every focused control (or its label) must show an outline or a box-shadow. */
async function missingFocusRings(page, max = 80) {
  await page.evaluate(() => {
    document.querySelectorAll('[data-uat-f]').forEach((e) => e.removeAttribute('data-uat-f'));
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
  });
  const bad = [];
  let focused = 0;
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab');
    const r = await page.evaluate(() => {
      const e = document.activeElement;
      if (!e || e === document.body || e === document.documentElement) return null;
      if (e.hasAttribute('data-uat-f')) return { cycled: true };
      e.setAttribute('data-uat-f', '1');
      const ring = (x) => {
        if (!x) return false;
        const cs = getComputedStyle(x);
        return (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || (cs.boxShadow && cs.boxShadow !== 'none');
      };
      const ok = ring(e) || ring(e.labels?.[0]) || ring(e.closest('label'));
      return { cycled: false, ok, name: e.getAttribute('data-test') ?? `${e.tagName.toLowerCase()}${e.type ? `[${e.type}]` : ''}` };
    });
    if (!r) continue;
    if (r.cycled) break;
    focused++;
    if (!r.ok) bad.push(r.name);
  }
  return { focused, bad };
}

const englishOnScreen = async (page) => {
  const t = await page.evaluate(() => document.body.innerText);
  const hits = t.split(/\n+/).filter((line) => ENGLISH_RE.test(line));
  return hits;
};

const box = (page, id) => T(page, id).first().boundingBox();

for (const phone of [true, false]) {
  for (const scheme of ['light', 'dark']) {
    const tag = `(${phone ? '375x812' : '1440x900'} ${scheme})`;
    await scenario(`layout ${tag}`, async () => {
      const errs = [];
      const fontReqs = [];
      const ctx = await context({ phone, colorScheme: scheme, geo: HAI_PHONG });
      ctx.on('request', (r) => r.resourceType() === 'font' && fontReqs.push(r.url()));
      const page = await open(ctx, undefined, errs);

      // First run: the onboarding is open.
      if (await visible(page, 'onboarding')) {
        let bad = await smallTargets(page);
        check(`${tag} with the onboarding open, every control is at least 44x44 px`, bad.length === 0, bad.slice(0, 6).join(', '));
        check(`${tag} no horizontal scroll with the onboarding open`, await noHScroll(page));
      } else check(`${tag} a fresh visit opens the onboarding`, false);
      await skipOnboarding(page);

      check(`${tag} title reads "Bản đồ bão"`, (await text(page, 'title')) === 'Bản đồ bão', await text(page, 'title'));
      check(`${tag} globe is visible and holds a canvas`, (await visible(page, 'globe')) && (await T(page, 'globe').first().locator('canvas').count()) > 0);
      check(`${tag} demo-label is visible and not covered`, (await visible(page, 'demo-label')) && (await onTop(page, 'demo-label')));
      const label = await text(page, 'demo-label');
      check(`${tag} demo-label reads the SPEC section 4 line`, label === DEMO, label);
      check(`${tag} no horizontal scroll on load`, await noHScroll(page));
      const fonts = await page.evaluate(() => ({ faces: document.fonts.size, family: getComputedStyle(document.body).fontFamily }));
      check(`${tag} no web font: no @font-face loaded and no font request`, fonts.faces === 0 && fontReqs.length === 0, `${fonts.faces} faces; ${fontReqs.slice(0, 2).join(' | ')}`);
      check(`${tag} body font is Arial or the system sans`, /arial|sans-serif|system-ui/i.test(fonts.family), fonts.family);
      let eng = await englishOnScreen(page);
      check(`${tag} no English UI words on screen on load`, eng.length === 0, eng.slice(0, 3).join(' | '));
      const rings = await missingFocusRings(page);
      check(`${tag} Tab reaches controls and each shows a visible focus ring`, rings.focused > 0 && rings.bad.length === 0, `${rings.focused} focused; no ring: ${rings.bad.slice(0, 6).join(', ')}`);

      // Phone: top bar, globe in the top ~55 %, panel below. Desktop: globe left, 420 px panel right.
      const g = await box(page, 'globe');
      const tb = await box(page, 'title');
      const bc = await box(page, 'btn-check');
      if (phone) {
        check(`${tag} the globe takes about 55 % of the height (446 px ± 10 %)`, !!g && Math.abs(g.height - 0.55 * 812) <= 0.1 * 0.55 * 812, JSON.stringify(g));
        check(`${tag} the globe sits below the top bar`, !!g && !!tb && g.y >= tb.y + tb.height - 1, `${JSON.stringify(tb)} / ${JSON.stringify(g)}`);
        check(`${tag} the main panel (btn-check) sits below the globe`, !!g && !!bc && bc.y >= g.y + g.height - 1, `${JSON.stringify(g)} / ${JSON.stringify(bc)}`);
      } else {
        check(`${tag} the globe ends 420 px from the right edge (x = 1020 ± 2)`, !!g && Math.abs(g.x + g.width - 1020) <= 2, JSON.stringify(g));
        check(`${tag} the main panel (btn-check) sits in the right 420 px`, !!bc && bc.x >= 1018, JSON.stringify(bc));
      }

      await T(page, 'btn-check').first().click();
      await waitVisible(page, 'verdict', 15000);
      await page.waitForTimeout(1500);
      check(`${tag} no horizontal scroll with the verdict open`, await noHScroll(page));
      check(`${tag} demo-label stays visible and not covered with the verdict open`, (await visible(page, 'demo-label')) && (await onTop(page, 'demo-label')));
      let bad = await smallTargets(page);
      check(`${tag} with the verdict open, every control is at least 44x44 px`, bad.length === 0, bad.slice(0, 6).join(', '));
      eng = await englishOnScreen(page);
      check(`${tag} no English UI words on screen with the verdict open`, eng.length === 0, eng.slice(0, 3).join(' | '));
      await page.screenshot({ path: `${SHOTS}layout-${phone ? 375 : 1440}-${scheme}.png` });

      await page.keyboard.press('Escape');
      await T(page, 'assistant-avatar').first().click();
      await waitVisible(page, 'assistant-sheet');
      bad = await smallTargets(page);
      check(`${tag} with the assistant sheet open, every chip and control is at least 44x44 px`, bad.length === 0, bad.slice(0, 6).join(', '));
      check(`${tag} no horizontal scroll with the assistant sheet open`, await noHScroll(page));
      await page.keyboard.press('Escape');

      await T(page, 'btn-settings').first().click();
      await waitVisible(page, 'settings');
      bad = await smallTargets(page);
      check(`${tag} with settings open, every control is at least 44x44 px`, bad.length === 0, bad.slice(0, 6).join(', '));
      check(`${tag} no horizontal scroll with settings open`, await noHScroll(page));
      const srings = await missingFocusRings(page, 40);
      check(`${tag} with settings open, each focused control shows a focus ring`, srings.focused > 0 && srings.bad.length === 0, `${srings.focused} focused; no ring: ${srings.bad.slice(0, 6).join(', ')}`);
      eng = await englishOnScreen(page);
      check(`${tag} no English UI words on screen with settings open`, eng.length === 0, eng.slice(0, 3).join(' | '));
      await page.screenshot({ path: `${SHOTS}layout-${phone ? 375 : 1440}-${scheme}-settings.png` });
      await page.keyboard.press('Escape');

      // Satellite view.
      await T(page, 'btn-source').first().click();
      await waitView(page, 'satellite', 3000);
      await page.waitForTimeout(1500); // the flight takes 0.8-1.2 s
      bad = await smallTargets(page);
      check(`${tag} in the satellite view, every control (btn-back) is at least 44x44 px`, bad.length === 0, bad.slice(0, 6).join(', '));
      check(`${tag} no horizontal scroll in the satellite view`, await noHScroll(page));
      eng = await englishOnScreen(page);
      check(`${tag} no English UI words on screen in the satellite view`, eng.length === 0, eng.slice(0, 3).join(' | '));
      await T(page, 'btn-back').first().click();
      await waitView(page, 'map', 3000);
      await page.waitForTimeout(1500);

      // Full mode: slider and timeline rows.
      await page.goto(url({ mode: 'full' }));
      await ready(page);
      await waitVisible(page, 'timeline', 5000).catch(() => {});
      bad = await smallTargets(page);
      check(`${tag} in full mode, every control (slider, timeline rows) is at least 44x44 px`, bad.length === 0, bad.slice(0, 6).join(', '));
      check(`${tag} no horizontal scroll in full mode`, await noHScroll(page));
      check(`${tag} demo-label is visible and not covered in full mode`, (await visible(page, 'demo-label')) && (await onTop(page, 'demo-label')));

      check(`${tag} no page errors`, errs.length === 0, errs.slice(0, 3).join(' | '));
      await ctx.close();
    });
  }
}

await scenario('reduced motion: no running animation with panels open (1440x900)', async () => {
  const ctx = await context({ reducedMotion: 'reduce', geo: HAI_PHONG });
  const page = await open(ctx);
  await skipOnboarding(page);
  const running = () => page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length);
  // SPEC 2: reduced motion removes all animation, including any the globe runs by itself (requestAnimationFrame),
  // which CSS animation counts cannot see. With nothing touched, the globe image 1 s apart is the same.
  await page.mouse.move(5, 5);
  await page.waitForTimeout(1000);
  const i0 = await canvasShot(page);
  await page.waitForTimeout(1000);
  const i1 = await canvasShot(page);
  const idle = await pixelDiff(page, i0, i1);
  check('(reduce) with nothing touched, the globe does not move by itself (same image 1 s apart)', idle <= SAME_PX, `${(idle * 100).toFixed(2)} % of pixels changed`);
  const m0 = await T(page, 'storm-marker').first().boundingBox().catch(() => null);
  await T(page, 'btn-check').first().click();
  await waitVisible(page, 'verdict', 15000);
  await page.waitForTimeout(50);
  check('(reduce) no running animation as the verdict opens', (await running()) === 0, `${await running()}`);
  // SPEC 6.3 step 4: no camera move after the verdict (the map view is fixed): the storm marker keeps its place.
  await page.mouse.move(5, 5);
  await page.waitForTimeout(1500);
  const m1 = await T(page, 'storm-marker').first().boundingBox().catch(() => null);
  check('(reduce) no camera move after the verdict: storm-marker keeps its place (within 1 px)', !!m0 && !!m1 && Math.abs(m0.x - m1.x) <= 1 && Math.abs(m0.y - m1.y) <= 1, `${JSON.stringify(m0)} -> ${JSON.stringify(m1)}`);
  await page.keyboard.press('Escape');
  await T(page, 'assistant-avatar').first().click();
  await waitVisible(page, 'assistant-sheet');
  await page.waitForTimeout(50);
  check('(reduce) no running animation as the assistant sheet opens', (await running()) === 0, `${await running()}`);
  await page.keyboard.press('Escape');
  await T(page, 'btn-settings').first().click();
  await waitVisible(page, 'settings');
  await page.waitForTimeout(50);
  check('(reduce) no running animation as settings open', (await running()) === 0, `${await running()}`);
  await page.keyboard.press('Escape');
  await ctx.close();
});


// SPEC 2: nothing is drawn while the tab is hidden. The test hides the tab by setting document.hidden and
// visibilityState and sending visibilitychange, then counts WebGL draw calls for 1 s.
await scenario('nothing is drawn while the tab is hidden (1440x900)', async () => {
  const ctx = await context({ init: DRAW_COUNTER });
  const page = await open(ctx);
  await skipOnboarding(page);
  await page.waitForTimeout(500);
  const drawnAtAll = await page.evaluate(() => window.__uatDraws);
  check('(visible) the globe has drawn with WebGL (the draw counter works)', drawnAtAll > 0, `${drawnAtAll} draw calls`);
  await page.evaluate(() => window.__uatHide());
  await page.waitForTimeout(200); // a frame already queued may still finish
  const d0 = await page.evaluate(() => window.__uatDraws);
  await page.waitForTimeout(1000);
  const d1 = await page.evaluate(() => window.__uatDraws);
  check('(hidden) no WebGL draw call in 1 s while the tab is hidden', d1 === d0, `${d1 - d0} draw calls`);
  await ctx.close();
});

// SPEC 6: phone layout below 900 px, desktop layout (420 px panel on the right) from 900 px.
for (const width of [899, 900]) {
  await scenario(`layout breakpoint at ${width} px wide`, async () => {
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, permissions: [] });
    ctx.setDefaultTimeout(5000);
    const page = await open(ctx);
    await skipOnboarding(page);
    const g = await box(page, 'globe');
    const bc = await box(page, 'btn-check');
    if (width < 900) {
      check(`(${width}) phone layout: the main panel (btn-check) sits below the globe`, !!g && !!bc && bc.y >= g.y + g.height - 1, `${JSON.stringify(g)} / ${JSON.stringify(bc)}`);
    } else {
      check(`(${width}) desktop layout: the globe ends 420 px from the right edge (x = ${width - 420} ± 2)`, !!g && Math.abs(g.x + g.width - (width - 420)) <= 2, JSON.stringify(g));
      check(`(${width}) desktop layout: btn-check sits in the right 420 px`, !!bc && bc.x >= width - 422, JSON.stringify(bc));
    }
    await ctx.close();
  });
}

await finish();
