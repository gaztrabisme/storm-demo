// Shared types and helpers for Usui-chan's clips (SPEC 6.8).
//
// A pose is a set of bone rotations and face-shape weights:
//  - bones: Euler angles [x, y, z] in radians (order XYZ), as an offset from the figure's rest pose (arms down).
//    The axes are the model's own: +Y up, +Z toward the viewer (she faces the camera), +X her left hand side.
//    An offset turns the bone in its parent's rest frame, so it follows the parent when the parent turns.
//      head: +x nods down, -x looks up, +y turns to her left, +z tilts the top of the head to her right.
//      arms hanging down: -x swings an arm forward; the right arm lifts out sideways with -z, the left with +z.
//  - face: weights in [0, 1] for the model's Fcl_* morph targets.
// Every clip is a pure function of time: the same t (and parameter) always gives the same pose.

export type Euler = [number, number, number];

export interface Pose {
  bones: Record<string, Euler>;
  face: Record<string, number>;
}

export const empty = (): Pose => ({ bones: {}, face: {} });

export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/** 0 before a, 1 after b, smooth in between. */
export function smooth(a: number, b: number, t: number): number {
  const x = clamp01((t - a) / (b - a));
  return x * x * (3 - 2 * x);
}

/** 0 → 1 over [a, b], held, then 1 → 0 over [c, d]. */
export const bump = (a: number, b: number, c: number, d: number, t: number): number => smooth(a, b, t) * (1 - smooth(c, d, t));

/** A deterministic value in [0, 1) for an integer (used for blink times and syllables). */
export function hash01(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

const TAU = Math.PI * 2;
/** sin with a period in seconds. */
export const wave = (t: number, period: number, phase = 0): number => Math.sin((TAU * t) / period + phase);

/** Adds `k` × the rotation `e` onto the bone `name` of `p`. */
export function addBone(p: Pose, name: string, e: Euler, k = 1): void {
  const b = p.bones[name] ?? [0, 0, 0];
  p.bones[name] = [b[0] + e[0] * k, b[1] + e[1] * k, b[2] + e[2] * k];
}

/** Adds `k` × `w` onto the face weight `name` of `p` (clamped to [0, 1]). */
export function addFace(p: Pose, name: string, w: number, k = 1): void {
  p.face[name] = clamp01((p.face[name] ?? 0) + w * k);
}

/**
 * The blender: a weighted sum of poses. Bone offsets add (they are small turns from one rest pose), face weights add
 * and are clamped to [0, 1], Weights are usually cross-fade weights in [0, 1].
 */
export function blend(layers: ReadonlyArray<{ pose: Pose; weight: number }>): Pose {
  const out = empty();
  for (const { pose, weight } of layers) {
    if (!(weight > 0)) continue;
    for (const [k, e] of Object.entries(pose.bones)) addBone(out, k, e, weight);
    for (const [k, w] of Object.entries(pose.face)) addFace(out, k, w, weight);
  }
  return out;
}

export type Quat = [number, number, number, number];

/** Quaternion [x, y, z, w] of the shortest turn that takes unit vector u onto unit vector v. */
export function quatBetween(u: readonly [number, number, number], v: readonly [number, number, number]): Quat {
  let x = u[1] * v[2] - u[2] * v[1];
  let y = u[2] * v[0] - u[0] * v[2];
  let z = u[0] * v[1] - u[1] * v[0];
  let w = 1 + u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  if (w < 1e-6) {
    // Opposite vectors: any axis at right angles to u.
    [x, y, z, w] = Math.abs(u[0]) > Math.abs(u[2]) ? [-u[1], u[0], 0, 0] : [0, -u[2], u[1], 0];
  }
  const n = Math.hypot(x, y, z, w);
  return [x / n, y / n, z / n, w / n];
}

/** The vector v turned by the inverse of the unit quaternion q. */
export function unturn(q: Quat, v: readonly [number, number, number]): [number, number, number] {
  const [qx, qy, qz, qw] = [-q[0], -q[1], -q[2], q[3]];
  // v' = v + 2w(q × v) + 2 q × (q × v)
  const cx = qy * v[2] - qz * v[1];
  const cy = qz * v[0] - qx * v[2];
  const cz = qx * v[1] - qy * v[0];
  return [
    v[0] + 2 * (qw * cx + qy * cz - qz * cy),
    v[1] + 2 * (qw * cy + qz * cx - qx * cz),
    v[2] + 2 * (qw * cz + qx * cy - qy * cx),
  ];
}

/** Euler XYZ (radians) of a unit quaternion, as three.js Euler.setFromRotationMatrix. */
export function eulerOf([x, y, z, w]: Quat): Euler {
  const m11 = 1 - 2 * (y * y + z * z);
  const m12 = 2 * (x * y - z * w);
  const m13 = 2 * (x * z + y * w);
  const m22 = 1 - 2 * (x * x + z * z);
  const m23 = 2 * (y * z - x * w);
  const m32 = 2 * (y * z + x * w);
  const m33 = 1 - 2 * (x * x + y * y);
  const ey = Math.asin(Math.max(-1, Math.min(1, m13)));
  if (Math.abs(m13) < 0.9999999) return [Math.atan2(-m23, m33), ey, Math.atan2(-m12, m11)];
  return [Math.atan2(m32, m22), ey, 0];
}

/** Euler XYZ (radians) of the shortest turn that takes unit vector u onto unit vector v. */
export function turnBetween(u: readonly [number, number, number], v: readonly [number, number, number]): Euler {
  return eulerOf(quatBetween(u, v));
}
