// Runs every UAT area in order against UAT_URL (default http://localhost:5195/?test=1).
// Exits non-zero if any area fails. Start the dev server first: npm run dev
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AREAS = ['onboarding', 'check', 'modes', 'mapview', 'settings', 'assistant', 'satellite', 'figure', 'notwarning', 'log', 'layout', 'prod'];
const dir = fileURLToPath(new URL('.', import.meta.url));
const env = { ...process.env, UAT_URL: process.env.UAT_URL ?? 'http://localhost:5195/?test=1' };

const summary = [];
for (const area of AREAS) {
  console.log(`\n======== ${area} ========`);
  const r = spawnSync(process.execPath, [`${dir}${area}.mjs`], { stdio: 'inherit', env });
  summary.push([area, r.status]);
}
console.log('\n======== summary ========');
for (const [area, code] of summary) console.log(`${code === 0 ? 'PASS' : 'FAIL'}  ${area}${code === 0 ? '' : ` (exit ${code})`}`);
const failed = summary.filter(([, c]) => c !== 0).length;
console.log(`\n${summary.length - failed}/${summary.length} areas PASS`);
process.exit(failed ? 1 : 0);
