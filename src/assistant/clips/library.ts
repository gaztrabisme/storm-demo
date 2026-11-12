// Usui-chan's clip library (SPEC 6.8): nine procedural clips on the model's J_Bip_* bones and Fcl_* face shapes.
// Each clip is a pure function of time t (seconds since the clip started) and returns a Pose (see pose.ts for axes).
// Every clip starts from the rest pose at t = 0, so a clip can start at any moment and be cross-faded in.
import { addBone, addFace, bump, empty, eulerOf, hash01, quatBetween, smooth, unturn, wave, type Euler, type Pose } from './pose';

const HEAD = 'J_Bip_C_Head';
const NECK = 'J_Bip_C_Neck';
const SPINE = 'J_Bip_C_Spine';
const CHEST = 'J_Bip_C_Chest';
const UPPER_CHEST = 'J_Bip_C_UpperChest';
const R_SHOULDER = 'J_Bip_R_Shoulder';
const L_SHOULDER = 'J_Bip_L_Shoulder';
const R_UPPER = 'J_Bip_R_UpperArm';
const L_UPPER = 'J_Bip_L_UpperArm';
const R_LOWER = 'J_Bip_R_LowerArm';
const L_LOWER = 'J_Bip_L_LowerArm';
const R_HAND = 'J_Bip_R_Hand';

/** One blink: the lids close and open again over 0.16 s, peaking at `at`. */
const blinkAt = (t: number, at: number): number => Math.max(0, 1 - Math.abs(t - at) / 0.08);

/** idle: breathing, a small sway, a blink every few seconds. Loops for ever with the same range. */
export function idle(t: number): Pose {
  const p = empty();
  const breathe = wave(t, 4.2);
  const sway = wave(t, 6.4, 0.6);
  // Fade in over the first 0.6 s, so idle starts from the rest pose.
  const k = smooth(0, 0.6, t);
  addBone(p, SPINE, [0.012 * breathe, 0, 0.018 * sway], k);
  addBone(p, CHEST, [0.012 * breathe, 0.012 * sway, 0], k);
  addBone(p, R_SHOULDER, [0, 0, 0.02 * breathe], k);
  addBone(p, L_SHOULDER, [0, 0, -0.02 * breathe], k);
  addBone(p, HEAD, [0.02 * wave(t, 5.3, 1.1), 0.05 * wave(t, 7.7, 0.3), -0.025 * sway], k);
  addBone(p, R_LOWER, [-0.04 * (1 + breathe) * 0.5, 0, 0], k);
  addBone(p, L_LOWER, [-0.04 * (1 + breathe) * 0.5, 0, 0], k);
  // One blink in every 4 s slot, at a time picked from the slot number (1.0-3.4 s into the slot).
  const slot = Math.floor(t / 4);
  const at = slot * 4 + 1 + hash01(slot) * 2.4;
  p.face.Fcl_EYE_Close = blinkAt(t, at);
  return p;
}

/** hello: one wave with the right hand and a smile; back at rest by 4 s. */
export function hello(t: number): Pose {
  const p = empty();
  const up = bump(0, 0.6, 2.9, 3.7, t);
  // Upper arm out to the side and a little forward; the forearm bends up from the elbow.
  addBone(p, R_SHOULDER, [0, 0, -0.1], up);
  addBone(p, R_UPPER, [-0.55, 0, -0.2], up);
  // The wave: the forearm and hand swing side to side three times from 0.7 s to 2.8 s.
  const swing = Math.sin(((t - 0.7) / 2.1) * Math.PI * 6) * bump(0.6, 0.9, 2.5, 2.8, t);
  addBone(p, R_LOWER, [-0.2, 0, -2.25 + 0.25 * swing], up);
  addBone(p, R_HAND, [0, 0, 0.25 * swing], up);
  // A friendly head tilt toward the waving hand.
  addBone(p, HEAD, [0, -0.06, 0.08], up);
  addBone(p, SPINE, [0, 0, 0.03], up);
  addFace(p, 'Fcl_ALL_Fun', 0.7 * bump(0, 0.4, 3.3, 4.2, t));
  return p;
}

/** The vowel shapes the talk clip cycles through. */
const VOWELS = ['Fcl_MTH_A', 'Fcl_MTH_I', 'Fcl_MTH_U', 'Fcl_MTH_E', 'Fcl_MTH_O'] as const;

/** talk: mouth shapes cycling (about 5 syllables a second, a short pause now and then), small head motion. */
export function talk(t: number): Pose {
  const p = empty();
  const rate = 5;
  const s = Math.max(0, t) * rate;
  const n = Math.floor(s);
  const f = s - n;
  // Every 7th syllable is a pause.
  const open = n % 7 === 6 ? 0 : Math.sin(Math.PI * f) * (0.45 + 0.2 * hash01(n + 17));
  const vowel = VOWELS[Math.floor(hash01(n) * VOWELS.length)];
  p.face[vowel] = open * smooth(0, 0.1, t);
  const k = smooth(0, 0.4, t);
  addBone(p, HEAD, [0.03 * wave(t, 1.3), 0.04 * wave(t, 2.1, 0.7), 0.02 * wave(t, 1.7, 1.9)], k);
  addBone(p, NECK, [0.015 * wave(t, 1.1, 0.4), 0, 0], k);
  return p;
}

/** alert: worried brows, hands drawn in toward the chest, a slight lean forward. Holds while it plays. */
export function alert(t: number): Pose {
  const p = empty();
  const k = smooth(0, 0.5, t);
  addBone(p, SPINE, [0.07, 0, 0], k);
  addBone(p, CHEST, [0.04, 0, 0], k);
  addBone(p, HEAD, [0.06 + 0.015 * wave(t, 2.3), 0, 0], k);
  // Upper arms a little forward and in, elbows bent so the hands come up in front of the chest.
  addBone(p, R_UPPER, [-0.35, 0, 0.18], k);
  addBone(p, L_UPPER, [-0.35, 0, -0.18], k);
  addBone(p, R_LOWER, [-1.55, 0, 0.35], k);
  addBone(p, L_LOWER, [-1.55, 0, -0.35], k);
  addBone(p, R_SHOULDER, [0, 0, 0.06], k);
  addBone(p, L_SHOULDER, [0, 0, -0.06], k);
  addFace(p, 'Fcl_BRW_Sorrow', 0.75 * k);
  addFace(p, 'Fcl_EYE_Surprised', 0.25 * k);
  addFace(p, 'Fcl_MTH_Sorrow', 0.25 * k);
  return p;
}

/** A screen direction: x to the right of the screen, y up. */
export type PointDir = { x: number; y: number } | [number, number] | number | { direction: { x: number; y: number } } | { dir: { x: number; y: number } };

function dirOf(d: PointDir | undefined): { x: number; y: number } {
  if (d === undefined || d === null) return { x: -1, y: 0 };
  if (typeof d === 'number') return { x: Math.cos(d), y: Math.sin(d) };
  if (Array.isArray(d)) return { x: Number(d[0]) || 0, y: Number(d[1]) || 0 };
  if ('direction' in d) return d.direction;
  if ('dir' in d) return d.dir;
  return d;
}

const norm3 = (v: [number, number, number]): [number, number, number] => {
  const n = Math.hypot(...v) || 1;
  return [v[0] / n, v[1] / n, v[2] / n];
};
const DEG = Math.PI / 180;
/** The right arm's rest directions in model axes (figure3d.ts, ARMS_DOWN), so the aim is measured from where the arm hangs. */
const REST_R_UPPER = norm3([-0.2, -1, -0.02]);
const REST_R_LOWER = norm3([-0.1, -1, 0.14]);

/**
 * point: the right arm points toward a screen direction (the parameter: {x, y}, x to the right of the screen, y up).
 * She faces the viewer, so the right of the screen is her left (+x in model axes). The upper arm stays below the
 * shoulder (about 35 degrees down for a level aim) and the elbow bends so the forearm carries the aim, which keeps the
 * hand inside her frame. The arm never reaches across her face: toward the right of the screen it points forward and
 * across her chest, and the aim never lifts more than 45 degrees above level. Reaches its aim by 0.8 s and holds it.
 */
export function point(t: number, dir?: PointDir): Pose {
  const p = empty();
  const d = dirOf(dir);
  const len = Math.hypot(d.x, d.y) || 1;
  const sx = d.x / len;
  const sy = d.y / len;
  // The aim's height above level, capped.
  // Toward the right of the screen the forearm runs across her chest, so it stays level or below, under her face.
  const elev = Math.max(-50 * DEG, Math.min(sx > -0.3 ? 10 * DEG : 45 * DEG, Math.atan2(sy, Math.abs(sx) + 1e-6)));
  // Sideways: out to her right for the left of the screen; little across her body for the right of the screen.
  const side = sx < 0 ? 0.6 * sx : 0.25 * sx;
  const upperElev = (sx < 0 ? -50 : -40) * DEG + 0.45 * elev;
  const upper = norm3([side * Math.cos(upperElev), Math.sin(upperElev), 0.75 + 0.35 * Math.max(0, sx)]);
  // Toward the left of the screen the forearm also reaches toward the viewer, so the hand stays inside her frame.
  const fore = norm3([(sx < 0 ? 0.6 * sx : 0.55 * sx) * Math.cos(elev), Math.sin(elev) + (sx < 0 ? -0.05 : 0.12), sx < 0 ? 0.95 : 0.55 + 0.25 * sx]);
  const qu = quatBetween(REST_R_UPPER, upper);
  const k = smooth(0, 0.8, t);
  addBone(p, R_UPPER, eulerOf(qu), k);
  addBone(p, R_LOWER, eulerOf(quatBetween(REST_R_LOWER, norm3(unturn(qu, fore)))), k);
  addBone(p, R_HAND, [0, 0, 0], k);
  // She turns her head toward where she points (the body stays still so the aim holds).
  addBone(p, HEAD, [-0.08 * sy, 0.18 * sx, 0], k);
  addBone(p, UPPER_CHEST, [0, 0.06 * sx, 0], k);
  return p;
}

/** nod: one nod of the head; back at rest by 1.3 s. */
export function nod(t: number): Pose {
  const p = empty();
  const down = bump(0.05, 0.4, 0.5, 1.2, t);
  addBone(p, HEAD, [0.26, 0, 0], down);
  addBone(p, NECK, [0.08, 0, 0], down);
  return p;
}

/**
 * relief: joyful eyes and a smile, a small bounce of the shoulders and head, the right hand laid on her chest and the
 * head tilted. (The club model has no face shapes, so the body carries the look; a model with them gets the face too.)
 */
export function relief(t: number): Pose {
  const p = empty();
  const k = smooth(0, 0.4, t);
  // Two small bounces in the first 1.4 s.
  const bounce = Math.abs(Math.sin(Math.PI * smooth(0.1, 1.4, t) * 2)) * (1 - smooth(1.2, 1.6, t));
  addBone(p, SPINE, [-0.05 * bounce - 0.03 * k, 0, 0], 1);
  addBone(p, R_SHOULDER, [0, 0, 0.08 * bounce], 1);
  addBone(p, L_SHOULDER, [0, 0, -0.08 * bounce], 1);
  addBone(p, HEAD, [-0.06 * bounce - 0.05 * k, 0.08 * k, -0.2 * k], 1);
  addBone(p, NECK, [0, 0, -0.05], k);
  // Right hand on the chest; the left arm a little out from her side.
  addBone(p, R_UPPER, [-0.45, 0, 0.3], k);
  addBone(p, R_LOWER, [-1.45, 0.2, 0.5], k);
  addBone(p, L_UPPER, [-0.1, 0, 0.12], k);
  addBone(p, L_LOWER, [-0.3, 0, 0], k);
  addFace(p, 'Fcl_ALL_Joy', 0.8 * k);
  return p;
}

/** think: head tilt, the right hand up toward the chin. Holds (with a slow sway) while it plays. */
export function think(t: number): Pose {
  const p = empty();
  const k = smooth(0, 0.7, t);
  const s = wave(t, 3.6);
  addBone(p, HEAD, [0.03, -0.08, 0.16 + 0.03 * s], k);
  addBone(p, NECK, [0, 0, 0.04], k);
  // Upper arm forward and in across the body, elbow bent hard so the hand comes up under the chin.
  addBone(p, R_UPPER, [-0.55, 0, 0.32], k);
  addBone(p, R_LOWER, [-1.6, 0.3, 0.3], k);
  addBone(p, R_HAND, [-0.5, 0, 0.2], k);
  // The other arm across the waist, holding the elbow.
  addBone(p, L_UPPER, [-0.25, 0, -0.15], k);
  addBone(p, L_LOWER, [-1.3, 0, -0.5], k);
  addFace(p, 'Fcl_MTH_Small', 0.3 * k);
  return p;
}

/**
 * lookUp: head up and to the side (toward her right: the left of the screen, where the satellite is). The model's eyes cannot turn without the iris slipping out of
 * sight (its eye bones do not sit at the eyeball centre), so the head carries the look.
 */
export function lookUp(t: number): Pose {
  const p = empty();
  const k = smooth(0, 0.8, t);
  const e: Euler = [-0.38, -0.2, 0.06];
  addBone(p, HEAD, [e[0] + 0.015 * wave(t, 3.1), e[1], e[2]], k);
  addBone(p, NECK, [-0.16, -0.06, 0], k);
  addBone(p, UPPER_CHEST, [-0.06, -0.03, 0], k);
  addFace(p, 'Fcl_EYE_Surprised', 0.2 * k);
  return p;
}
