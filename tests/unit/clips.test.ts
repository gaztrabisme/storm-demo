// Locked acceptance tests: SPEC 6.8, the Usui-chan clip library in src/assistant/clips/.
// Each clip is a pure function of time (seconds) that returns bone rotations (keys J_Bip_*) and face weights (keys Fcl_*).
//
// How the tests find a clip: every .ts/.js file in src/assistant/clips/ is imported; a clip is a named export with the
// clip's name, a default export of a file named after the clip, or a property with the clip's name on an exported object.
// A clip may be a function (t, param?) or an object with one of the methods sample / at / evaluate / pose.
// How the tests read a result: any key starting with J_Bip_ is a bone rotation (an Euler [x, y, z] / {x, y, z} in radians,
// or a quaternion [x, y, z, w] / {x, y, z, w}); any key starting with Fcl_ is a face weight (a number). Keys nest freely
// ({ bones: {...}, face: {...} } or flat); a Map counts as an object.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { CLIP_NAMES } from '../content.mjs';

// CLIPS_DIR and MODEL_GLB are only for checking these tests against a stand-in library and model; the run uses
// src/assistant/clips/ and the usui-chan.glb copied into web/.
const DIR = process.env.CLIPS_DIR ?? fileURLToPath(new URL('../../src/assistant/clips/', import.meta.url));
const WEB = fileURLToPath(new URL('../../', import.meta.url));

/** Path of the usui-chan .glb in web/ (public/ and src/ first; node_modules, dist, .git and tests skipped), or null. */
function findModel(): string | null {
  if (process.env.MODEL_GLB) return process.env.MODEL_GLB;
  const skip = new Set(['node_modules', 'dist', '.git', 'tests']);
  const roots = ['public', 'src', ''].map((r) => join(WEB, r)).filter((r) => existsSync(r));
  for (const root of roots) {
    const stack: Array<[string, number]> = [[root, 0]];
    while (stack.length) {
      const [dir, depth] = stack.pop()!;
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        let st;
        try {
          st = statSync(p);
        } catch {
          continue;
        }
        if (st.isDirectory()) {
          if (!skip.has(f) && !f.startsWith('.') && depth < 6) stack.push([p, depth + 1]);
        } else if (/^usui-chan[^/]*\.glb$/.test(f)) return p;
      }
    }
  }
  return null;
}
/** Every J_Bip_* and Fcl_* name in the glTF JSON chunk of a .glb (node names, morph-target names, wherever they sit). */
function modelNames(file: string): Set<string> {
  const b = readFileSync(file);
  if (b.readUInt32LE(0) !== 0x46546c67) throw new Error(`${file} is not a binary glTF (.glb)`);
  const len = b.readUInt32LE(12);
  if (b.readUInt32LE(16) !== 0x4e4f534a) throw new Error(`${file}: first chunk is not JSON`);
  const json = JSON.parse(b.subarray(20, 20 + len).toString('utf8'));
  const out = new Set<string>();
  const walk = (v: any) => {
    if (typeof v === 'string') {
      if (/^(J_Bip_|Fcl_)/.test(v)) out.add(v);
    } else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        if (/^(J_Bip_|Fcl_)/.test(k)) out.add(k);
        walk(x);
      }
    }
  };
  walk(json);
  return out;
}
type Pose = { bones: Record<string, number[]>; face: Record<string, number> };
type Fn = (t: number, param?: unknown) => unknown;

const clips: Record<string, Fn> = {};
let loadError = '';

function asFn(v: any): Fn | null {
  if (typeof v === 'function') return v as Fn;
  if (v && typeof v === 'object') {
    for (const m of ['sample', 'at', 'evaluate', 'pose']) if (typeof v[m] === 'function') return (t, p) => v[m](t, p);
  }
  return null;
}

beforeAll(async () => {
  if (!existsSync(DIR)) {
    loadError = 'src/assistant/clips/ does not exist';
    return;
  }
  for (const f of readdirSync(DIR)) {
    if (!/\.(ts|js|mjs)$/.test(f) || /\.(test|spec)\.|\.d\.ts$/.test(f)) continue;
    const base = f.replace(/\.(ts|js|mjs)$/, '');
    let mod: Record<string, any>;
    try {
      mod = await import(/* @vite-ignore */ `${DIR}${f}`);
    } catch (e) {
      loadError += `${f}: ${String(e).split('\n')[0]}; `;
      continue;
    }
    for (const [k, v] of Object.entries(mod)) {
      if (CLIP_NAMES.includes(k) && !clips[k] && asFn(v)) clips[k] = asFn(v)!;
      else if (k === 'default' && CLIP_NAMES.includes(base) && !clips[base] && asFn(v)) clips[base] = asFn(v)!;
      else if (v && typeof v === 'object') for (const n of CLIP_NAMES) if (!clips[n] && asFn((v as any)[n])) clips[n] = asFn((v as any)[n])!;
    }
  }
});

const nums = (v: any): number[] => {
  if (Array.isArray(v)) return v.map(Number);
  if (v && typeof v === 'object') {
    for (const ks of [['x', 'y', 'z', 'w'], ['_x', '_y', '_z', '_w']]) {
      if (ks[0] in v) return ks.filter((k) => k in v).map((k) => Number(v[k]));
    }
  }
  return [NaN];
};
/** The bones and face weights in one clip result, however it is nested. */
function read(r: any): Pose {
  const out: Pose = { bones: {}, face: {} };
  const walk = (node: any, depth: number) => {
    if (depth > 6 || node === null || typeof node !== 'object') return;
    const entries = node instanceof Map ? [...node.entries()] : Object.entries(node);
    for (const [k, v] of entries) {
      if (typeof k === 'string' && k.startsWith('J_Bip_')) out.bones[k] = nums(v);
      else if (typeof k === 'string' && k.startsWith('Fcl_')) out.face[k] = typeof v === 'number' ? v : NaN;
      else walk(v, depth + 1);
    }
  };
  walk(r, 0);
  return out;
}
/** Rotation angle in radians: from a quaternion, or the largest Euler component. */
function angle(v: number[]): number {
  if (v.length === 4) {
    const n = Math.hypot(...v) || 1;
    return 2 * Math.acos(Math.min(1, Math.abs(v[3]) / n));
  }
  return Math.max(...v.map(Math.abs));
}
/** Angle in radians between two rotations of the same bone: quaternion angle, or the largest Euler component difference. */
function between(a: number[] | undefined, b: number[] | undefined): number {
  const id = (v: number[] | undefined, n: number) => v ?? (n === 4 ? [0, 0, 0, 1] : [0, 0, 0]);
  const n = (a ?? b ?? []).length;
  const x = id(a, n);
  const y = id(b, n);
  if (n === 4) {
    const dot = Math.abs(x[0] * y[0] + x[1] * y[1] + x[2] * y[2] + x[3] * y[3]) / ((Math.hypot(...x) || 1) * (Math.hypot(...y) || 1));
    return 2 * Math.acos(Math.min(1, dot));
  }
  return Math.max(0, ...x.map((v, i) => Math.abs(v - (y[i] ?? 0))));
}
const flat = (p: Pose): Record<string, number> => {
  const o: Record<string, number> = {};
  for (const [k, v] of Object.entries(p.bones)) v.forEach((x, i) => (o[`${k}.${i}`] = x));
  for (const [k, v] of Object.entries(p.face)) o[k] = v;
  return o;
};
/** Largest difference of any one value between two poses (a key missing on one side counts as 0 there). */
function maxDiff(a: Pose, b: Pose): number {
  const fa = flat(a);
  const fb = flat(b);
  let m = 0;
  for (const k of new Set([...Object.keys(fa), ...Object.keys(fb)])) m = Math.max(m, Math.abs((fa[k] ?? 0) - (fb[k] ?? 0)));
  return m;
}
const times = (from: number, to: number, step: number) => Array.from({ length: Math.round((to - from) / step) + 1 }, (_, i) => from + i * step);
const RIGHT_ARM = /^J_Bip_R_(Shoulder|UpperArm|LowerArm|Hand|Thumb|Index|Middle|Ring|Little)/;
const rightArm = (p: Pose) => Object.fromEntries(Object.entries(p.bones).filter(([k]) => RIGHT_ARM.test(k)));
const DEG = Math.PI / 180;
/**
 * What is off neutral in pose p ("neutral" is the rest pose or the clip's own t = 0 pose `start`): bones more than 3°
 * from both, face weights more than 0.05 from both 0 and their t = 0 value. Empty when p is near neutral.
 */
function offNeutral(_name: string, p: Pose, start: Pose): string[] {
  const off = Object.entries(p.bones).filter(([k, v]) => angle(v) > 3 * DEG && between(v, start.bones[k]) > 3 * DEG).map(([k, v]) => `${k} ${(angle(v) / DEG).toFixed(1)}°`);
  const face = Object.entries(p.face).filter(([k, v]) => v > 0.05 && Math.abs(v - (start.face[k] ?? 0)) > 0.05).map(([k, v]) => `${k} ${v}`);
  return [...off, ...face];
}

// The direction parameter of `point` (SPEC: "a screen direction given as a parameter"). SPEC does not fix its form;
// these are tried in order and the first one the clip answers to (different right-arm pose for opposite directions) is used.
const DIRS = { right: { x: 1, y: 0 }, left: { x: -1, y: 0 }, up: { x: 0, y: 1 }, down: { x: 0, y: -1 } };
const CONVENTIONS: Array<[string, (d: { x: number; y: number }) => unknown]> = [
  ['{ x, y }', (d) => ({ x: d.x, y: d.y })],
  ['[x, y]', (d) => [d.x, d.y]],
  ['angle in radians', (d) => Math.atan2(d.y, d.x)],
  ['{ direction: { x, y } }', (d) => ({ direction: { x: d.x, y: d.y } })],
  ['{ dir: { x, y } }', (d) => ({ dir: { x: d.x, y: d.y } })],
];
const callPose = (name: string, t: number, param?: unknown): Pose => read(clips[name](t, param));
/** The parameter `point` is called with in the generic checks: pointing right, in the first convention it answers to. */
const defaultParam = (name: string) => (name === 'point' ? (pointConvention().conv ?? CONVENTIONS[0][1])(DIRS.right) : undefined);

/** The first direction convention `point` answers to; the arm has reached its aim by t = 2 s (our threshold). */
function pointConvention(): { conv: ((d: { x: number; y: number }) => unknown) | null; detail: string } {
  let detail = '';
  for (const [label, conv] of CONVENTIONS) {
    try {
      const arm = (d: { x: number; y: number }) => ({ bones: rightArm(callPose('point', 2, conv(d))), face: {} });
      const lr = maxDiff(arm(DIRS.right), arm(DIRS.left));
      const ud = maxDiff(arm(DIRS.up), arm(DIRS.down));
      const same = maxDiff(arm(DIRS.right), arm({ ...DIRS.right }));
      detail += `${label}: left/right ${(lr / DEG).toFixed(1)}°, up/down ${(ud / DEG).toFixed(1)}°; `;
      // Our threshold: opposite directions differ by at least 10° in some right-arm rotation value.
      if (lr >= 10 * DEG && ud >= 10 * DEG && same === 0) return { conv, detail: `${detail}used ${label}` };
    } catch (e) {
      detail += `${label}: threw ${String(e).split('\n')[0]}; `;
    }
  }
  return { conv: null, detail };
}

describe('SPEC 6.8 clip library (src/assistant/clips/)', () => {
  it('the clips folder loads', () => {
    expect(loadError, loadError).toBe('');
  });

  it.each(CLIP_NAMES)('exports the clip "%s"', (name) => {
    expect(typeof clips[name], `clip ${name}`).toBe('function');
  });

  it.each(CLIP_NAMES)('"%s" returns finite bone rotations and face weights in [0, 1] for t in [0, 10] s', (name) => {
    expect(typeof clips[name]).toBe('function');
    const bad: string[] = [];
    let keys = 0;
    for (const t of times(0, 10, 0.1)) {
      const p = callPose(name, t, defaultParam(name));
      keys += Object.keys(p.bones).length + Object.keys(p.face).length;
      for (const [k, v] of Object.entries(p.bones)) if (!(v.length === 3 || v.length === 4) || !v.every(Number.isFinite)) bad.push(`t=${t.toFixed(1)} ${k}=${JSON.stringify(v)}`);
      for (const [k, v] of Object.entries(p.face)) if (!Number.isFinite(v) || v < 0 || v > 1) bad.push(`t=${t.toFixed(1)} ${k}=${v}`);
    }
    expect(keys, 'J_Bip_* or Fcl_* entries returned').toBeGreaterThan(0);
    expect(bad.slice(0, 5)).toEqual([]);
  });

  it.each(CLIP_NAMES)('"%s" is a pure function of time: the same t gives the same result', (name) => {
    expect(typeof clips[name]).toBe('function');
    for (const t of [0, 0.37, 1.5, 4.2, 9.9]) {
      const a = callPose(name, t, defaultParam(name));
      const b = callPose(name, t, defaultParam(name));
      expect(maxDiff(a, b), `t=${t}`).toBe(0);
    }
  });

  // A clip that keeps state between calls (time since the last call, a running phase) gives a different pose for the
  // same t when the calls come in another order. Samples t = 0-10 s forward, then backward, then shuffled with calls to
  // the other clips in between; every pass must give the same pose for each t.
  it.each(CLIP_NAMES)('"%s" gives the same pose for each t whatever order the times are asked in', (name) => {
    expect(typeof clips[name]).toBe('function');
    const ts = times(0, 10, 0.25);
    const forward = new Map(ts.map((t) => [t, callPose(name, t, defaultParam(name))]));
    const backward = new Map([...ts].reverse().map((t) => [t, callPose(name, t, defaultParam(name))]));
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const shuffled = [...ts].sort(() => rnd() - 0.5);
    const mixed = new Map<number, Pose>();
    for (const t of shuffled) {
      for (const other of CLIP_NAMES) if (other !== name && clips[other]) callPose(other, rnd() * 10, defaultParam(other));
      mixed.set(t, callPose(name, t, defaultParam(name)));
    }
    const bad = ts.filter((t) => maxDiff(forward.get(t)!, backward.get(t)!) !== 0 || maxDiff(forward.get(t)!, mixed.get(t)!) !== 0);
    expect(bad.map((t) => `t=${t}`)).toEqual([]);
  });

  // SPEC 6.8: clips are built "on the model's humanoid bones (J_Bip_*) and face shapes (Fcl_*)". Every key a clip
  // returns must be a bone or face-shape name that exists in usui-chan.glb.
  it('the model usui-chan.glb is in web/ and names J_Bip_* bones and Fcl_* face shapes', () => {
    const file = findModel();
    expect(file, 'usui-chan .glb under web/ (public/, src/ or elsewhere outside node_modules, dist, tests)').not.toBeNull();
    const names = modelNames(file!);
    expect([...names].some((n) => n.startsWith('J_Bip_')), 'J_Bip_* names in the model').toBe(true);
    expect([...names].some((n) => n.startsWith('Fcl_')), 'Fcl_* names in the model').toBe(true);
  });

  it.each(CLIP_NAMES)('"%s" uses only bone and face-shape names that exist in usui-chan.glb', (name) => {
    expect(typeof clips[name]).toBe('function');
    const file = findModel();
    expect(file, 'usui-chan .glb under web/').not.toBeNull();
    const names = modelNames(file!);
    const params = name === 'point' ? Object.values(DIRS).map((d) => (pointConvention().conv ?? CONVENTIONS[0][1])(d)) : [undefined];
    const unknown = new Set<string>();
    for (const p of params) {
      for (const t of times(0, 10, 0.5)) {
        const r = callPose(name, t, p);
        for (const k of [...Object.keys(r.bones), ...Object.keys(r.face)]) if (!names.has(k)) unknown.add(k);
      }
    }
    expect([...unknown]).toEqual([]);
  });

  // "moves" alone lets five clips be copies of one. Our threshold: for every two clips, at some t in [0, 10] s, one
  // bone differs by at least 5° or one face weight by at least 0.2.
  it('every two clips are different motions (at some t, a bone differs by 5° or more or a face weight by 0.2 or more)', () => {
    const names = CLIP_NAMES.filter((n) => typeof clips[n] === 'function');
    expect(names).toEqual(CLIP_NAMES);
    const same: string[] = [];
    const ts = times(0, 10, 0.1);
    const poses = Object.fromEntries(names.map((n) => [n, ts.map((t) => callPose(n, t, defaultParam(n)))]));
    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        let bone = 0;
        let face = 0;
        ts.forEach((_, k) => {
          const a = poses[names[i]][k];
          const b = poses[names[j]][k];
          for (const key of new Set([...Object.keys(a.bones), ...Object.keys(b.bones)])) bone = Math.max(bone, between(a.bones[key], b.bones[key]));
          for (const key of new Set([...Object.keys(a.face), ...Object.keys(b.face)])) face = Math.max(face, Math.abs((a.face[key] ?? 0) - (b.face[key] ?? 0)));
        });
        if (bone < 5 * DEG && face < 0.2) same.push(`${names[i]} ~ ${names[j]} (bones ${(bone / DEG).toFixed(1)}°, face ${face.toFixed(2)})`);
      }
    }
    expect(same).toEqual([]);
  });

  // One check per clip from the SPEC 6.8 table "What it does". Face-shape names follow the model's own prefixes
  // (Fcl_MTH_ mouth, Fcl_EYE_ eyes, Fcl_BRW_ brows); a bone's turn is measured from the clip's own t = 0 pose, as for
  // "hello" and "nod" below.
  const turn = (name: string, part: RegExp, from = 0, to = 10) => {
    const p0 = callPose(name, 0);
    let m = 0;
    for (const t of times(from, to, 0.05)) for (const [k, v] of Object.entries(callPose(name, t).bones)) if (part.test(k)) m = Math.max(m, between(v, p0.bones[k]));
    return m / DEG;
  };
  const faceMax = (name: string, part: RegExp, from = 0, to = 10) => {
    let m = 0;
    for (const t of times(from, to, 0.02)) for (const [k, v] of Object.entries(callPose(name, t).face)) if (part.test(k)) m = Math.max(m, v);
    return m;
  };
  /** How many times a weight rises above 0.3 and then falls below 0.1. */
  const cycles = (vs: number[]) => {
    let n = 0;
    let up = false;
    for (const v of vs) {
      if (!up && v > 0.3) up = true;
      else if (up && v < 0.1) {
        up = false;
        n++;
      }
    }
    return n;
  };

  it('"talk": a mouth shape (Fcl_MTH_*) rises above 0.3 and falls below 0.1 at least twice in 3 s (our threshold)', () => {
    expect(typeof clips.talk).toBe('function');
    const ps = times(0, 3, 0.02).map((t) => callPose('talk', t));
    const keys = [...new Set(ps.flatMap((p) => Object.keys(p.face)))].filter((k) => /^Fcl_MTH_/.test(k));
    const per = keys.map((k) => [k, cycles(ps.map((p) => p.face[k] ?? 0))] as const);
    const any = cycles(ps.map((p) => Math.max(0, ...keys.map((k) => p.face[k] ?? 0))));
    expect(Math.max(any, ...per.map(([, n]) => n)), JSON.stringify(per)).toBeGreaterThanOrEqual(2);
  });
  it('"idle": an eye-close shape (Fcl_EYE_Close*) goes above 0.5 at least once in 10 s (a blink)', () => {
    expect(typeof clips.idle).toBe('function');
    expect(faceMax('idle', /^Fcl_EYE_Close/)).toBeGreaterThan(0.5);
  });
  it('"hello": a smile shape (Fcl_*Joy*, *Fun* or *Smile*) goes above 0.2', () => {
    expect(typeof clips.hello).toBe('function');
    expect(faceMax('hello', /^Fcl_.*(Joy|Fun|Smile)/i)).toBeGreaterThan(0.2);
  });
  it('"alert": a brow shape (Fcl_BRW_*) goes above 0.3 (worried brows)', () => {
    expect(typeof clips.alert).toBe('function');
    expect(faceMax('alert', /^Fcl_BRW_/)).toBeGreaterThan(0.3);
  });
  it('"relief": a joy shape (Fcl_*Joy*) goes above 0.3 (joyful eyes and smile)', () => {
    expect(typeof clips.relief).toBe('function');
    expect(faceMax('relief', /^Fcl_.*Joy/)).toBeGreaterThan(0.3);
  });
  it('"think": the head (J_Bip_C_Head) tilts at least 5° and a hand or lower arm turns at least 20° (hand toward chin)', () => {
    expect(typeof clips.think).toBe('function');
    expect(turn('think', /^J_Bip_C_Head$/), 'head').toBeGreaterThanOrEqual(5);
    expect(turn('think', /^J_Bip_[LR]_(LowerArm|Hand)$/), 'hand or lower arm').toBeGreaterThanOrEqual(20);
  });
  it('"lookUp": the head (J_Bip_C_Head) turns at least 5°', () => {
    expect(typeof clips.lookUp).toBe('function');
    expect(turn('lookUp', /^J_Bip_C_Head$/)).toBeGreaterThanOrEqual(5);
  });

  it.each(CLIP_NAMES)('"%s" moves: its pose is not the same at every t in [0, 10] s', (name) => {
    expect(typeof clips[name]).toBe('function');
    const p0 = callPose(name, 0, defaultParam(name));
    const most = Math.max(...times(0, 10, 0.1).map((t) => maxDiff(p0, callPose(name, t, defaultParam(name)))));
    expect(most).toBeGreaterThan(1e-3);
  });

  it('"idle" loops: it still moves long after the start, with about the same range as in its first 10 s', () => {
    expect(typeof clips.idle).toBe('function');
    const range = (from: number) => {
      const ps = times(from, from + 10, 0.05).map((t) => flat(callPose('idle', t)));
      const keys = new Set(ps.flatMap((p) => Object.keys(p)));
      let sum = 0;
      for (const k of keys) {
        const vs = ps.map((p) => p[k] ?? 0);
        sum += Math.max(...vs) - Math.min(...vs);
      }
      return sum;
    };
    const early = range(0);
    const late = range(600);
    expect(early, 'range of idle in [0, 10] s').toBeGreaterThan(1e-3);
    // Our threshold: the range 10 minutes in is between half and twice the range at the start.
    expect(late / early, `range at 600-610 s ${late} vs 0-10 s ${early}`).toBeGreaterThanOrEqual(0.5);
    expect(late / early).toBeLessThanOrEqual(2);
  });

  // SPEC does not say whether a clip's rotations are offsets from the rest pose or the whole pose, so "neutral" is the
  // rest pose or the clip's own pose at t = 0 (where a clip starts from neutral). Our thresholds: "near neutral" at
  // t = 10 s is every bone within 3° of one of them and every face weight within 0.05 of 0 or of its t = 0 value.
  for (const [name, part, minDeg] of [
    ['hello', /^J_Bip_R_(Shoulder|UpperArm|LowerArm|Hand)/, 20],
    ['nod', /^J_Bip_C_(Head|Neck)/, 5],
  ] as const) {
    it(`"${name}" plays once and ends near neutral (t = 10 s: bones within 3°, face weights within 0.05)`, () => {
      expect(typeof clips[name]).toBe('function');
      expect(offNeutral(name, callPose(name, 10), callPose(name, 0))).toEqual([]);
    });
    // "One wave" / "one nod": a clip that repeats every few seconds can still be near neutral at t = 10 s. Our
    // threshold: every sample from 5 s to 10 s is near neutral.
    it(`"${name}" plays once: every sample from t = 5 s to 10 s is near neutral (no second ${name === 'hello' ? 'wave' : 'nod'})`, () => {
      expect(typeof clips[name]).toBe('function');
      const start = callPose(name, 0);
      const bad = times(5, 10, 0.05).flatMap((t) => offNeutral(name, callPose(name, t), start).map((x) => `t=${t.toFixed(2)} ${x}`));
      expect(bad.slice(0, 5)).toEqual([]);
    });
    it(`"${name}" does its move: a ${name === 'hello' ? 'right-arm' : 'head or neck'} bone turns at least ${minDeg}° from its t = 0 pose within the first 4 s`, () => {
      expect(typeof clips[name]).toBe('function');
      const start = callPose(name, 0);
      const peak = Math.max(0, ...times(0, 4, 0.05).flatMap((t) => Object.entries(callPose(name, t).bones).filter(([k]) => part.test(k)).map(([k, v]) => between(v, start.bones[k]))));
      expect(peak / DEG).toBeGreaterThanOrEqual(minDeg);
    });
  }

  it('"point" aims toward its direction parameter: opposite directions give different right-arm poses, the same direction the same pose', () => {
    expect(typeof clips.point).toBe('function');
    const { conv, detail } = pointConvention();
    expect(conv, detail).not.toBeNull();
  });

  // The arm reaches its aim by t = 2 s and holds it. Our threshold: from 2 s to 5 s every right-arm bone stays within
  // 3° of its t = 2 s pose, for each of the four directions. (Whether it points to the right side of the screen, not
  // the mirror side, needs the rig's kinematics; see tests/README.md, "Not checked automatically".)
  it('"point" holds its aim: from t = 2 s to 5 s the right arm stays within 3° of its t = 2 s pose', () => {
    expect(typeof clips.point).toBe('function');
    const { conv, detail } = pointConvention();
    expect(conv, detail).not.toBeNull();
    const bad: string[] = [];
    for (const [dname, d] of Object.entries(DIRS)) {
      const at2 = rightArm(callPose('point', 2, conv!(d)));
      for (const t of times(2, 5, 0.05)) {
        const now = rightArm(callPose('point', t, conv!(d)));
        for (const k of Object.keys(at2)) if (between(now[k], at2[k]) > 3 * DEG) bad.push(`${dname} t=${t.toFixed(2)} ${k} ${(between(now[k], at2[k]) / DEG).toFixed(1)}°`);
      }
    }
    expect(bad.slice(0, 5)).toEqual([]);
  });
});
