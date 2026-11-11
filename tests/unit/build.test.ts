// Locked acceptance tests: SPEC section 2 build rules. Builds the app into a scratch folder with the
// project's own vite.config.ts, then reads the Vite manifest:
//   base './'  ->  every src/href in index.html is relative ("./...")
//   the JS loaded at start (entry chunk plus its static imports) is <= 90 kB gzip (92160 bytes)
//   three.js sits in its own chunk that is only reached through a dynamic import
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const WEB = fileURLToPath(new URL('../../', import.meta.url));
const OUT = fileURLToPath(new URL('./.build-out/', import.meta.url)); // removed after the run
const LIMIT = 90 * 1024;

type Chunk = { file: string; name?: string; src?: string; isEntry?: boolean; isDynamicEntry?: boolean; imports?: string[]; dynamicImports?: string[] };
let manifest: Record<string, Chunk> = {};
let built = false;
let buildLog = '';

beforeAll(() => {
  rmSync(OUT, { recursive: true, force: true });
  try {
    buildLog = execFileSync('npx', ['vite', 'build', '--outDir', OUT, '--emptyOutDir', '--logLevel', 'error'], { cwd: WEB, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    built = existsSync(`${OUT}.vite/manifest.json`);
    if (built) manifest = JSON.parse(readFileSync(`${OUT}.vite/manifest.json`, 'utf8'));
  } catch (e) {
    buildLog = String((e as { stderr?: string }).stderr ?? e);
  }
}, 180000);
afterAll(() => rmSync(OUT, { recursive: true, force: true }));

const read = (file: string) => readFileSync(`${OUT}${file}`, 'utf8');
// three.js code keeps its "THREE." warning prefixes after minification; the manifest also names node_modules/three sources.
const isThree = (key: string, c: Chunk) => /node_modules[\\/]three[\\/]/.test(key) || /node_modules[\\/]three[\\/]/.test(c.src ?? '') || c.name === 'three' || /THREE\.WebGLRenderer/.test(read(c.file));
/** Keys reachable from `start` through static imports only. */
function staticClosure(start: string): Set<string> {
  const seen = new Set<string>();
  const walk = (k: string) => {
    if (seen.has(k) || !manifest[k]) return;
    seen.add(k);
    for (const i of manifest[k].imports ?? []) walk(i);
  };
  walk(start);
  return seen;
}

/** Every file under the build output, as a path relative to it. */
function filesUnder(dir: string, base = dir): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? filesUnder(`${dir}${e.name}/`, base) : [`${dir}${e.name}`.slice(base.length)]));
}

describe('vite build (SPEC 2)', () => {
  it('builds and writes a manifest', () => {
    expect(built, buildLog.slice(-400)).toBe(true);
  });

  it('every src and href in dist/index.html is relative ("./")', () => {
    const html = read('index.html');
    const refs = [...html.matchAll(/\s(?:src|href)=["']([^"']+)["']/g)].map((m) => m[1]);
    expect(refs.length).toBeGreaterThan(0);
    expect(refs.filter((r) => !r.startsWith('./'))).toEqual([]);
  });

  it('the JS loaded at start (entry and its static imports) is <= 90 kB gzip', () => {
    const entries = Object.keys(manifest).filter((k) => manifest[k].isEntry);
    expect(entries.length).toBe(1);
    const files = [...staticClosure(entries[0])].map((k) => manifest[k].file).filter((f) => f.endsWith('.js'));
    const gz = files.reduce((n, f) => n + gzipSync(readFileSync(`${OUT}${f}`)).length, 0);
    expect(gz, files.join(', ')).toBeLessThanOrEqual(LIMIT);
  });

  it('the build ships both Usui-chan images from AstroSphere (SPEC 6.4): usui-avatar and usui-pose as .webp', () => {
    const files = filesUnder(OUT);
    expect(files.filter((f) => /usui-avatar[^/]*\.webp$/.test(f)), 'usui-avatar .webp').not.toEqual([]);
    expect(files.filter((f) => /usui-pose[^/]*\.webp$/.test(f)), 'usui-pose .webp').not.toEqual([]);
  });

  it('three.js is in its own chunk, reached only through a dynamic import', () => {
    const entry = Object.keys(manifest).find((k) => manifest[k].isEntry)!;
    const eager = staticClosure(entry);
    const three = Object.keys(manifest).filter((k) => isThree(k, manifest[k]));
    expect(three.length, 'a chunk holding three.js').toBeGreaterThan(0);
    expect(three.filter((k) => eager.has(k)), 'three.js chunks loaded at start').toEqual([]);
    const lazy = new Set<string>();
    for (const k of eager) for (const d of manifest[k].dynamicImports ?? []) for (const x of staticClosure(d)) lazy.add(x);
    expect(three.some((k) => lazy.has(k)), 'three.js reached from a dynamic import of the entry').toBe(true);
    // Its own chunk: the three.js chunk is not the entry file.
    expect(three.map((k) => manifest[k].file)).not.toContain(manifest[entry].file);
  });
});
