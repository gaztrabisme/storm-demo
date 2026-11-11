// UAT, SPEC 7 + 8: event log, export, clear, and no network traffic off the origin.
// UAT_URL=http://localhost:5195/?test=1 node tests/uat/log.mjs
import { readFileSync } from 'node:fs';
import { HAI_PHONG, LOG_KEY, T, errors, guardNetwork, check, context, events, finish, inSettings, open, pickOption, scenario, sel, skipOnboarding, text, url, visible, waitView, waitVisible } from './lib.mjs';

const has = (evs, type) => evs.some((e) => e.type === type);

await scenario('a full session is logged, exported and cleared (1440x900)', async () => {
  const ctx = await context({ geo: HAI_PHONG, acceptDownloads: true });
  const origin = new URL(url()).origin;
  const offOrigin = [];
  ctx.on('request', (r) => {
    const u = r.url();
    if (u.startsWith('data:') || u.startsWith('blob:')) return;
    try {
      if (new URL(u).origin !== origin) offOrigin.push(u);
    } catch {
      offOrigin.push(u);
    }
  });
  const page = await open(ctx, url({ test: '1' }));
  await skipOnboarding(page);

  let ev = await events(page);
  const open0 = ev.find((e) => e.type === 'open');
  check('open is logged with { mode, textSize, theme, width }', !!open0 && ['mode', 'textSize', 'theme', 'width'].every((k) => k in (open0.data ?? {})), JSON.stringify(open0));
  check('open has mode "easy" (the default) and width 1440', open0?.data?.mode === 'easy' && open0?.data?.width === 1440, JSON.stringify(open0?.data));
  const lightTheme = await page.evaluate(() => ({ attr: document.documentElement.getAttribute('data-theme'), set: window.__app.settings?.theme }));
  check('open.theme is the current theme ("Sáng" under a light colour scheme): the <html data-theme> value or __app.settings.theme', !!open0 && open0.data?.theme !== undefined && open0.data?.theme !== null && [lightTheme.attr, lightTheme.set].includes(open0.data.theme), `${JSON.stringify(open0?.data)} / ${JSON.stringify(lightTheme)}`);
  check('every event has session, t (number) and type', ev.length > 0 && ev.every((e) => typeof e.session === 'string' && e.session && typeof e.t === 'number' && typeof e.type === 'string'), JSON.stringify(ev[0]));

  await T(page, 'btn-check').first().click();
  await waitVisible(page, 'verdict', 15000);
  await page.waitForTimeout(500);
  await page.keyboard.press('Escape');
  await T(page, 'assistant-avatar').first().click();
  await waitVisible(page, 'assistant-sheet');
  await page.locator('[data-test="assistant-sheet"] [data-test="chip"][data-chip="prepare"]').first().click();
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape');
  const settingCount = async () => (await events(page)).filter((e) => e.type === 'setting').length;
  const sc0 = await settingCount();
  await inSettings(page, () => pickOption(page, sel('set-text'), 'Lớn'));
  await page.waitForTimeout(300);
  const sc1 = await settingCount();
  check('picking text size "Lớn" logs exactly one new setting event', sc1 - sc0 === 1, `${sc0} -> ${sc1}`);
  await T(page, 'btn-source').first().click();
  await waitView(page, 'satellite');
  await page.waitForTimeout(5500);
  await T(page, 'btn-back').first().click();
  await waitView(page, 'map');
  await page.waitForTimeout(5500);

  ev = await events(page);
  const types = ev.map((e) => e.type);
  check('check_start logged', has(ev, 'check_start'), types.join(','));
  const geo = ev.find((e) => e.type === 'geo_result');
  check('geo_result logged with { granted: true }', geo?.data?.granted === true, JSON.stringify(geo));
  const vs = ev.find((e) => e.type === 'verdict_shown');
  check('verdict_shown logged with { affected, place, msSinceOpen }', !!vs && vs.data?.affected === true && 'place' in vs.data && typeof vs.data.msSinceOpen === 'number' && vs.data.msSinceOpen > 0, JSON.stringify(vs));
  // SPEC 7 names the field but not its shape: the label itself, or an object whose label is it.
  const vplace = vs?.data?.place;
  check('verdict_shown.place is the place label "Vị trí của bạn" (a string, or an object with that label)', vplace === 'Vị trí của bạn' || vplace?.label === 'Vị trí của bạn', JSON.stringify(vs?.data));
  const chip = ev.find((e) => e.type === 'chip');
  check('chip logged with { id: "prepare" }', chip?.data?.id === 'prepare', JSON.stringify(chip));
  check('assistant_open logged', has(ev, 'assistant_open'));
  const st = ev.find((e) => e.type === 'setting');
  check('setting logged with { name, value }, both set', !!st && typeof st.data?.name === 'string' && st.data.name.length > 0 && st.data.value !== undefined && st.data.value !== null && st.data.value !== '', JSON.stringify(st));
  check('satellite_open and satellite_close logged', has(ev, 'satellite_open') && has(ev, 'satellite_close'), types.join(','));
  const sessions = new Set(ev.map((e) => e.session));
  check('one session id for the page', sessions.size === 1, [...sessions].join(','));
  const ts = ev.map((e) => e.t);
  check('t never goes backwards', ts.every((t, i) => i === 0 || t >= ts[i - 1]), ts.join(','));
  const stored = await page.evaluate((k) => localStorage.getItem(k), LOG_KEY);
  check(`events are stored under ${LOG_KEY}`, !!stored && stored.includes('verdict_shown'));

  const session = ev[0]?.session;
  // A second page open gets its own random session id.
  const page2 = await open(ctx, url({ test: '1' }));
  const s2 = (await events(page2)).filter((e) => e.type === 'open').map((e) => e.session);
  check('a second page open logs open with a different session id', s2.length > 0 && s2.some((x) => x !== session) && !!session, `${session} / ${s2.join(',')}`);
  // SPEC 7 open { textSize }: the second open comes after "Lớn" was chosen, so its textSize differs from the first ("Vừa").
  const open2 = (await events(page2)).filter((e) => e.type === 'open').find((e) => e.session !== session);
  check('open.textSize follows the setting: the open after choosing "Lớn" differs from the first open ("Vừa")', !!open2 && open2.data?.textSize !== undefined && open2.data?.textSize !== open0?.data?.textSize, `${JSON.stringify(open0?.data?.textSize)} -> ${JSON.stringify(open2?.data?.textSize)}`);
  await page2.close();
  const before = await events(page);
  await T(page, 'btn-settings').first().click();
  await waitVisible(page, 'settings');
  check('with ?test=1 btn-export is visible and reads "Xuất dữ liệu thử nghiệm"', (await visible(page, 'btn-export')) && (await text(page, 'btn-export')) === 'Xuất dữ liệu thử nghiệm');
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 5000 }), T(page, 'btn-export').first().click()]);
  const name = dl.suggestedFilename();
  check('the download is named stormdemo-log-<session>.json', name === `stormdemo-log-${session}.json`, name);
  const json = JSON.parse(readFileSync(await dl.path(), 'utf8'));
  const exported = Array.isArray(json) ? json : json.events;
  const xt = (exported ?? []).map((e) => e.type);
  check('the exported JSON holds the events', ['open', 'check_start', 'geo_result', 'verdict_shown', 'chip', 'setting', 'satellite_open', 'satellite_close'].every((t) => xt.includes(t)), xt.join(','));
  const key = (e) => `${e.session}|${e.t}|${e.type}`;
  const xk = new Set((exported ?? []).map(key));
  const missing = before.filter((e) => !xk.has(key(e)));
  check('the export holds every stored event (all sessions)', (exported ?? []).length >= before.length && missing.length === 0, `${(exported ?? []).length} exported, ${before.length} stored, ${missing.length} missing`);

  // SPEC 7 does not say where btn-clear-log lives: look in the open settings first, then on the page with settings closed.
  if (!(await visible(page, 'btn-clear-log'))) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }
  check('btn-clear-log is visible (in settings or on the page)', await visible(page, 'btn-clear-log'));
  check('btn-clear-log reads "Xóa dữ liệu"', ((await T(page, 'btn-clear-log').first().textContent()) ?? '').trim() === 'Xóa dữ liệu');
  await T(page, 'btn-clear-log').first().click();
  await page.waitForTimeout(300);
  const left = await events(page);
  check('btn-clear-log empties the log', left.length === 0, left.map((e) => e.type).join(','));
  const raw = await page.evaluate((k) => localStorage.getItem(k), LOG_KEY);
  let rawEmpty = raw === null;
  try {
    const j = JSON.parse(raw);
    rawEmpty ||= (Array.isArray(j) && j.length === 0) || (Array.isArray(j?.events) && j.events.length === 0);
  } catch {}
  check(`btn-clear-log empties ${LOG_KEY} in storage`, rawEmpty, String(raw).slice(0, 120));
  await page.keyboard.press('Escape');

  check('no request leaves the origin during the session', offOrigin.length === 0, offOrigin.slice(0, 3).join(' | '));
  await ctx.close();
});

await scenario('without ?test=1 there is no export button', async () => {
  const ctx = await context();
  // No __app hooks are promised without ?test=1, so wait for the page itself.
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  guardNetwork(page, url({ test: null }));
  await page.goto(url({ test: null }));
  await T(page, 'btn-settings').first().waitFor({ state: 'visible', timeout: 20000 });
  await skipOnboarding(page);
  await T(page, 'btn-settings').first().click();
  await waitVisible(page, 'settings');
  check('btn-export is absent without ?test=1', !(await visible(page, 'btn-export')));
  await ctx.close();
});

await finish();
