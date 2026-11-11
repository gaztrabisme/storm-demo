// UAT, SPEC 6.7: satellite view (GK-2A), back to the map, reduced motion.
// UAT_URL=http://localhost:5195/?test=1 node tests/uat/satellite.mjs
import { SAME_PX, canvasShot, pixelDiff, SAT_FACTS, SAT_HEADING, SAT_SOURCE, T, norm, check, context, finish, open, scenario, skipOnboarding, text, visible, waitView } from './lib.mjs';

const view = (page) => page.evaluate(() => window.__app.view);

await scenario('open and close the satellite view (1440x900, motion allowed)', async () => {
  const ctx = await context({ reducedMotion: 'no-preference' });
  const page = await open(ctx);
  await skipOnboarding(page);
  check('__app.view starts as "map"', (await view(page)) === 'map', await view(page));
  check('btn-source reads "Nguồn dữ liệu"', (await text(page, 'btn-source')) === 'Nguồn dữ liệu', await text(page, 'btn-source'));
  const t0 = Date.now();
  await T(page, 'btn-source').first().click();
  // SPEC 6.7: the flight takes 3-5 s, so the picture is still changing between 2.0 s and 2.8 s after the click.
  // Only this lower bound is checked: SPEC does not say the scene is still once the flight ends.
  await page.waitForTimeout(Math.max(0, 2000 - (Date.now() - t0)));
  const f1 = await canvasShot(page).catch(() => null);
  await page.waitForTimeout(Math.max(0, 2800 - (Date.now() - t0)));
  const f2 = await canvasShot(page).catch(() => null);
  const moving = f1 && f2 ? await pixelDiff(page, f1, f2) : 0;
  check('the flight to the satellite is still moving 2.0-2.8 s after the click (it takes at least 3 s)', moving > SAME_PX, `${(moving * 100).toFixed(2)} % of pixels changed`);
  await waitView(page, 'satellite', 8000).catch(() => {});
  check('btn-source -> __app.view "satellite"', (await view(page)) === 'satellite', await view(page));
  await page.waitForTimeout(Math.max(0, 5500 - (Date.now() - t0))); // the flight takes 3-5 s
  check('satellite-model is visible', await visible(page, 'satellite-model'));
  check('satellite-info is visible', await visible(page, 'satellite-info'));
  const info = await text(page, 'satellite-info');
  check('satellite-info names GK-2A', info.includes('GK-2A'), info.slice(0, 160));
  // SPEC 10.4: heading, the approved facts word for word in order, then the source line.
  check(`satellite-info has the heading "${SAT_HEADING}"`, info.includes(SAT_HEADING));
  const missing = SAT_FACTS.filter((f) => !info.includes(norm(f)));
  check('satellite-info has every SPEC 10.4 fact word for word', missing.length === 0, missing.map((m) => m.slice(0, 50)).join(' | '));
  const idx = SAT_FACTS.map((f) => info.indexOf(norm(f)));
  check('satellite-info facts are in SPEC 10.4 order, after the heading', idx.every((x, i) => x > info.indexOf(SAT_HEADING) && (i === 0 || x > idx[i - 1])), idx.join(','));
  const srcAt = info.indexOf(SAT_SOURCE);
  check('satellite-info ends its facts with the SPEC 10.4 source line', srcAt >= 0 && srcAt > Math.max(...idx), `${srcAt}`);
  // SPEC 6.7: one source line only.
  const srcCount = info.split('Nguồn:').length - 1;
  check('satellite-info has exactly one source line (one "Nguồn:")', srcCount === 1 && info.split(SAT_SOURCE).length === 2, `${srcCount}`);
  check('btn-back reads "Quay lại bản đồ"', (await text(page, 'btn-back')) === 'Quay lại bản đồ', await text(page, 'btn-back'));
  await T(page, 'btn-back').first().click();
  await waitView(page, 'map', 8000).catch(() => {});
  check('btn-back -> __app.view "map"', (await view(page)) === 'map', await view(page));
  await page.waitForTimeout(5500);
  check('satellite-info is hidden back on the map', !(await visible(page, 'satellite-info')));

  await T(page, 'btn-source').first().click();
  await waitView(page, 'satellite', 8000).catch(() => {});
  await page.waitForTimeout(1000);
  await page.keyboard.press('Escape');
  await waitView(page, 'map', 8000).catch(() => {});
  check('Esc in the satellite view -> __app.view "map"', (await view(page)) === 'map', await view(page));
  await ctx.close();
});

await scenario('reduced motion: the view switches as a cut (375x812)', async () => {
  const ctx = await context({ reducedMotion: 'reduce', phone: true });
  const page = await open(ctx);
  await skipOnboarding(page);
  await page.mouse.move(5, 5);
  await page.waitForTimeout(500);
  const before = await canvasShot(page);
  const t0 = Date.now();
  await T(page, 'btn-source').first().click();
  const ok = await waitView(page, 'satellite', 500).then(() => true, () => false);
  const dt = Date.now() - t0;
  check('(reduce) __app.view is "satellite" within 500 ms', ok && dt <= 500, `${dt} ms`);
  const shown = await T(page, 'satellite-info').first().waitFor({ state: 'visible', timeout: 500 }).then(() => true, () => false);
  check('(reduce) satellite-info is visible within 500 ms', shown);
  const t1 = Date.now();
  await T(page, 'btn-back').first().click();
  const back = await waitView(page, 'map', 500).then(() => true, () => false);
  check('(reduce) btn-back returns to "map" within 500 ms', back && Date.now() - t1 <= 500, `${Date.now() - t1} ms`);
  // SPEC 6.7: btn-back goes back to the previous view: the globe looks as it did before the satellite view opened.
  await page.mouse.move(5, 5);
  await page.waitForTimeout(1000);
  const after = await canvasShot(page);
  const d = await pixelDiff(page, before, after);
  check('(reduce) after btn-back the globe shows the same view as before the satellite view', d <= SAME_PX, `${(d * 100).toFixed(2)} % of pixels changed`);
  const anims = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length);
  check('(reduce) no running CSS animations or transitions', anims === 0, `${anims}`);
  await ctx.close();
});

await finish();
