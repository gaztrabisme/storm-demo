// The clip library (SPEC 6.8) and its blender.
import { alert, hello, idle, lookUp, nod, point, relief, talk, think } from './library';
import type { Pose } from './pose';

export { alert, hello, idle, lookUp, nod, point, relief, talk, think } from './library';
export type { PointDir } from './library';
export { blend, type Euler, type Pose } from './pose';

export const CLIPS = { idle, hello, talk, alert, point, nod, relief, think, lookUp } as const satisfies Record<string, (t: number, param?: never) => Pose>;
export type ClipName = keyof typeof CLIPS;
