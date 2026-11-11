// UAT, SPEC 2 + 6.5: settings dialog (text size, theme), persistence, colour-scheme default, storage failure.
// UAT_URL=http://localhost:5195/?test=1 node tests/uat/settings.mjs
import { CREDITS, HAI_PHONG, SETTINGS_KEY, T, bodyBg, check, context, dataTheme, finish, inSettings, luminance, open, pickOption, reload, rootFont, runCheck, scenario, sel, skipOnboarding, visible } from './lib.mjs';

let darkValue = null;
let lightValue = null;

await scenario('text size and theme (1440x900, light scheme)', async () => {
  const ctx = await context({ colorScheme: 'light' });
  const page = await open(ctx);
  await skipOnboarding(page);
  await T(page, 'btn-settings').first().click();
  check('btn-settings opens the settings dialog', await T(page, 'settings').first().isVisible());
  // SPEC 6.4 + 3.2: the four credit lines, inside [credits] inside settings.
  const inSet = await page.locator('[data-test="settings"] [data-test="credits"]').count();
  check('settings holds the credits block [credits]', inSet > 0, `${inSet}`);
  const credits = ((await T(page, 'credits').first().textContent().catch(() => '')) ?? '').replace(/\s+/g, ' ');
  for (const line of CREDITS) check(`credits show "${line}"`, credits.includes(line), credits.slice(0, 200));
  const radios = await page.locator(`${sel('set-text')} input[type=radio]`).count();
  check('set-text is a group of 3 radios', radios === 3, `${radios}`);
  const appSettings = () => page.evaluate(() => JSON.stringify(window.__app.settings ?? null));
  const st0 = await appSettings();
  const sizes = [];
  const bySize = {};
  for (const [label, px] of [['Lớn', '20px'], ['Rất lớn', '24px'], ['Vừa', '16px']]) {
    await pickOption(page, sel('set-text'), label);
    const f = await rootFont(page);
    sizes.push(f);
    bySize[label] = await appSettings();
    check(`set-text "${label}" -> html font-size ${px}`, f === px, f);
  }
  // __app.settings follows the text size: "Lớn" differs from "Vừa", and choosing "Lớn" again gives the same settings as before.
  await pickOption(page, sel('set-text'), 'Lớn');
  const again = await appSettings();
  check('__app.settings under "Lớn" differs from "Vừa" and is the same each time "Lớn" is chosen', bySize['Lớn'] !== bySize['Vừa'] && again === bySize['Lớn'] && again !== 'null', `Vừa ${bySize['Vừa']} / Lớn ${bySize['Lớn']} / Lớn again ${again}`);
  await pickOption(page, sel('set-text'), 'Vừa');
  const t0 = await dataTheme(page);
  check('default theme under a light colour scheme is set on <html data-theme>', !!t0, String(t0));
  await pickOption(page, sel('set-theme'), 'Sáng');
  lightValue = await dataTheme(page);
  const bgLight = await bodyBg(page);
  await pickOption(page, sel('set-theme'), 'Tối');
  darkValue = await dataTheme(page);
  const bgDark = await bodyBg(page);
  check('set-theme "Tối" changes data-theme', !!darkValue && darkValue !== lightValue, `${lightValue} -> ${darkValue}`);
  check('light colour scheme defaults to the "Sáng" theme', t0 === lightValue, `${t0} vs ${lightValue}`);
  const st1 = await appSettings();
  check('__app.settings is set and changes with text size and theme', st0 !== 'null' && st1 !== 'null' && st1 !== st0, `${st0} -> ${st1}`);
  await pickOption(page, sel('set-theme'), 'Sáng');
  const st2 = await appSettings();
  check('__app.settings changes when only the theme changes', st2 !== st1, `${st1} -> ${st2}`);
  await pickOption(page, sel('set-theme'), 'Tối');
  check('the page background changes and is darker under "Tối"', bgLight !== bgDark && luminance(bgDark) < luminance(bgLight), `${bgLight} -> ${bgDark}`);
  await pickOption(page, sel('set-text'), 'Lớn');
  await page.keyboard.press('Escape');

  const stored = await page.evaluate((k) => localStorage.getItem(k), SETTINGS_KEY);
  check(`choices are saved in ${SETTINGS_KEY}`, !!stored, String(stored));
  await reload(page);
  check('after reload the text size "Lớn" (20px) is kept', (await rootFont(page)) === '20px', await rootFont(page));
  check('after reload the theme "Tối" is kept', (await dataTheme(page)) === darkValue, String(await dataTheme(page)));
  // SPEC 2: versioned keys with the prefix "stormdemo."; sessionStorage too, except the test runner's own __uat_cleared.
  const keys = await page.evaluate(() => [...Object.keys(localStorage), ...Object.keys(sessionStorage).filter((k) => k !== '__uat_cleared')]);
  check('every storage key is versioned with the prefix: stormdemo.<name>.v<N>', keys.length > 0 && keys.every((k) => /^stormdemo\.[\w-]+(\.[\w-]+)*\.v\d+$/.test(k)), keys.join(','));
  await ctx.close();
});

await scenario('prefers-color-scheme dark gives the dark theme by default', async () => {
  const ctx = await context({ colorScheme: 'dark', phone: true });
  const page = await open(ctx);
  await skipOnboarding(page);
  const t = await dataTheme(page);
  check('(375, dark scheme) data-theme is the "Tối" value on first visit', !!darkValue && t === darkValue, `${t} vs ${darkValue}`);
  await inSettings(page, () => pickOption(page, sel('set-theme'), 'Sáng'));
  check('(375) choosing "Sáng" overrides the dark scheme', (await dataTheme(page)) === lightValue, String(await dataTheme(page)));
  await reload(page);
  check('(375) the "Sáng" choice is kept after reload under a dark scheme', (await dataTheme(page)) === lightValue, String(await dataTheme(page)));
  await ctx.close();
});

await scenario('the page works when reading window.localStorage itself throws', async () => {
  const ctx = await context({
    geo: HAI_PHONG,
    init: () => {
      const boom = () => {
        throw new DOMException('blocked', 'SecurityError');
      };
      Object.defineProperty(window, 'localStorage', { get: boom, configurable: true });
      Object.defineProperty(window, 'sessionStorage', { get: boom, configurable: true });
    },
  });
  const page = await open(ctx);
  await skipOnboarding(page);
  await inSettings(page, () => pickOption(page, sel('set-text'), 'Lớn'));
  check('(localStorage getter throws) text size still applies', (await rootFont(page)) === '20px', await rootFont(page));
  await runCheck(page);
  check('(localStorage getter throws) the check still produces a verdict', await visible(page, 'verdict'));
  await ctx.close();
});

await scenario('the page works when storage methods throw', async () => {
  const ctx = await context({
    geo: HAI_PHONG,
    init: () => {
      const boom = () => {
        throw new DOMException('blocked', 'SecurityError');
      };
      Storage.prototype.getItem = boom;
      Storage.prototype.setItem = boom;
      Storage.prototype.removeItem = boom;
    },
  });
  const page = await open(ctx);
  await skipOnboarding(page);
  await inSettings(page, () => pickOption(page, sel('set-text'), 'Lớn'));
  check('(storage throws) text size still applies', (await rootFont(page)) === '20px', await rootFont(page));
  await runCheck(page);
  check('(storage throws) the check still produces a verdict', await visible(page, 'verdict'));
  await ctx.close();
});

await finish();
