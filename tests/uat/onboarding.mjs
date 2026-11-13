// UAT, SPEC 6.6 first run [onboarding].
// UAT_URL=http://localhost:5195/?test=1 node tests/uat/onboarding.mjs
import { ONBOARDING_FULL_LINE, CLEAR_ONCE, SETTINGS_KEY, T, check, context, events, finish, open, pickOption, reload, rootFont, scenario, sel, visible } from './lib.mjs';

const STEP3 = 'Trang này có thể hỏi vị trí của bạn để biết bão có tới chỗ bạn không. Bạn có thể chọn tỉnh thay vì cho vị trí.';
const hasKey = (page) => page.evaluate((k) => localStorage.getItem(k) !== null, SETTINGS_KEY);
const norm = (s) => (s ?? '').replace(/\s+/g, ' ').trim();

await scenario('finish all three steps (1440x900)', async () => {
  const ctx = await context({ init: CLEAR_ONCE });
  const page = await open(ctx);
  const ob = T(page, 'onboarding').first();
  check('first visit shows the onboarding', await visible(page, 'onboarding'));
  check('step 1 has "Tiếp" and "Bỏ qua"', (await ob.getByRole('button', { name: 'Tiếp', exact: true }).count()) > 0 && (await ob.getByRole('button', { name: 'Bỏ qua', exact: true }).count()) > 0);

  const f0 = await rootFont(page);
  await pickOption(page, sel('onboarding'), 'Rất lớn');
  const f1 = await rootFont(page);
  check('step 1 text-size preview: "Rất lớn" sets the root font size to 24px at once', f1 === '24px', `${f0} -> ${f1}`);
  await pickOption(page, sel('onboarding'), 'Vừa');
  check('step 1 preview: "Vừa" sets it back to 16px', (await rootFont(page)) === '16px', await rootFont(page));
  await pickOption(page, sel('onboarding'), 'Lớn');
  check('step 1 preview: "Lớn" sets 20px', (await rootFont(page)) === '20px', await rootFont(page));

  await ob.getByRole('button', { name: 'Tiếp', exact: true }).first().click();
  const s2 = norm(await ob.textContent());
  check('step 2 offers the modes "Dễ dùng" and "Đầy đủ"', s2.includes('Dễ dùng') && s2.includes('Đầy đủ'), s2.slice(0, 120));
  check(`step 2 has the full-mode line "${ONBOARDING_FULL_LINE}" (SPEC 6.6)`, s2.includes(ONBOARDING_FULL_LINE), s2.slice(0, 200));
  check('step 2 still has "Bỏ qua"', (await ob.getByRole('button', { name: 'Bỏ qua', exact: true }).count()) > 0);
  await pickOption(page, sel('onboarding'), 'Đầy đủ');
  await ob.getByRole('button', { name: 'Tiếp', exact: true }).first().click();
  const s3 = norm(await ob.textContent());
  check('step 3 shows the location line from SPEC 6.6', s3.includes(STEP3), s3.slice(0, 160));
  // SPEC 6.6: step 3 has only "Bắt đầu".
  const btns = async (name) => ob.getByRole('button', { name, exact: true }).filter({ visible: true }).count();
  check('step 3 has a "Bắt đầu" button', (await btns('Bắt đầu')) === 1, `${await btns('Bắt đầu')}`);
  check('step 3 has no "Tiếp" and no "Bỏ qua"', (await btns('Tiếp')) === 0 && (await btns('Bỏ qua')) === 0, `Tiếp ${await btns('Tiếp')}, Bỏ qua ${await btns('Bỏ qua')}`);
  await ob.getByRole('button', { name: 'Bắt đầu', exact: true }).first().click();
  await ob.waitFor({ state: 'hidden' }).catch(() => {});
  check('"Bắt đầu" on step 3 closes the onboarding (3 steps)', !(await visible(page, 'onboarding')));
  check(`finishing saves ${SETTINGS_KEY}`, await hasKey(page));
  const ev = (await events(page)).map((e) => e.type);
  check('event onboarding_done is logged', ev.includes('onboarding_done'), ev.join(','));

  await reload(page);
  await page.waitForTimeout(800);
  check('after reload the onboarding never shows again', !(await visible(page, 'onboarding')));
  check('the text size chosen in onboarding ("Lớn") is kept: 20px', (await rootFont(page)) === '20px', await rootFont(page));
  check('the mode chosen in onboarding ("Đầy đủ") is kept: the time slider shows', await visible(page, 'time-slider'));
  await ctx.close();
});

await scenario('skip at step 1 (375x812 touch)', async () => {
  const ctx = await context({ phone: true, init: CLEAR_ONCE });
  const page = await open(ctx);
  const ob = T(page, 'onboarding').first();
  check('(375) first visit shows the onboarding', await visible(page, 'onboarding'));
  await ob.getByRole('button', { name: 'Bỏ qua', exact: true }).first().click();
  await ob.waitFor({ state: 'hidden' }).catch(() => {});
  check('(375) "Bỏ qua" closes the onboarding', !(await visible(page, 'onboarding')));
  check(`(375) skipping saves ${SETTINGS_KEY}`, await hasKey(page));
  const ev = (await events(page)).map((e) => e.type);
  check('(375) event onboarding_skip is logged', ev.includes('onboarding_skip'), ev.join(','));
  await reload(page);
  await page.waitForTimeout(800);
  check('(375) after reload the onboarding never shows again', !(await visible(page, 'onboarding')));
  await ctx.close();
});

await scenario('skip at step 2', async () => {
  const ctx = await context({ init: CLEAR_ONCE });
  const page = await open(ctx);
  const ob = T(page, 'onboarding').first();
  await pickOption(page, sel('onboarding'), 'Lớn');
  await ob.getByRole('button', { name: 'Tiếp', exact: true }).first().click();
  await ob.getByRole('button', { name: 'Bỏ qua', exact: true }).first().click();
  await ob.waitFor({ state: 'hidden' }).catch(() => {});
  check('"Bỏ qua" on step 2 closes the onboarding and saves settings', !(await visible(page, 'onboarding')) && (await hasKey(page)));
  await reload(page);
  await page.waitForTimeout(800);
  check('after reload it does not show again', !(await visible(page, 'onboarding')));
  // SPEC 6.6: skipping saves the settings, so the text size chosen on step 1 before skipping at step 2 is kept.
  check('the text size chosen on step 1 ("Lớn") before skipping at step 2 is kept after reload: 20px', (await rootFont(page)) === '20px', await rootFont(page));
  await ctx.close();
});

await finish();
