// UAT, SPEC 6.5 + 8 against a production build: the window.__app hooks and the export button
// exist only with ?test=1. Builds into a temp folder and serves it with `vite preview` itself.
// node tests/uat/prod.mjs   (PROD_PORT sets the preview port, default 4179)
import { spawn, spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { T, check, context, errors, finish, guardNetwork, scenario, skipOnboarding, visible, waitVisible } from './lib.mjs';

const WEB = fileURLToPath(new URL('../../', import.meta.url));
const PORT = Number(process.env.PROD_PORT ?? 4179);
const out = fileURLToPath(new URL('./.prod-build/', import.meta.url)); // removed at the end of the run
const BASE_PROD = `http://127.0.0.1:${PORT}/`;

const b = spawnSync('npx', ['vite', 'build', '--outDir', out, '--emptyOutDir'], { cwd: WEB, encoding: 'utf8' });
check('production build (vite build) succeeds', b.status === 0, (b.stderr || b.stdout || '').split('\n').slice(-3).join(' '));

let server = null;
if (b.status === 0) {
  server = spawn('npx', ['vite', 'preview', '--outDir', out, '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: WEB, stdio: 'ignore', detached: true });
  const t0 = Date.now();
  let up = false;
  while (!up && Date.now() - t0 < 20000) {
    up = await fetch(BASE_PROD).then((r) => r.ok, () => false);
    if (!up) await new Promise((r) => setTimeout(r, 300));
  }
  check(`vite preview serves the build on port ${PORT}`, up);

  const load = async (ctx, target) => {
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    guardNetwork(page, target);
    await page.goto(target);
    await T(page, 'btn-settings').first().waitFor({ state: 'visible', timeout: 20000 });
    return page;
  };

  await scenario('production build without ?test=1', async () => {
    const ctx = await context();
    const page = await load(ctx, BASE_PROD);
    await page.waitForTimeout(1500);
    check('(prod) window.__app is undefined without ?test=1', await page.evaluate(() => window.__app === undefined));
    await skipOnboarding(page);
    await T(page, 'btn-settings').first().click();
    await waitVisible(page, 'settings');
    check('(prod) btn-export is absent without ?test=1', !(await visible(page, 'btn-export')));
    await ctx.close();
  });

  await scenario('production build with ?test=1', async () => {
    const ctx = await context();
    const page = await load(ctx, `${BASE_PROD}?test=1`);
    const ok = await page.waitForFunction(() => !!window.__app && !!window.__app.ready, null, { timeout: 20000 }).then(() => true, () => false);
    check('(prod) window.__app exists with ?test=1', ok);
    if (ok) await page.evaluate(() => window.__app.ready);
    await skipOnboarding(page);
    await T(page, 'btn-settings').first().click();
    await waitVisible(page, 'settings');
    check('(prod) btn-export is visible with ?test=1', await visible(page, 'btn-export'));
    await ctx.close();
  });
}

try {
  if (server) process.kill(-server.pid);
} catch {}
rmSync(out, { recursive: true, force: true });
await finish();
