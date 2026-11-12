// The storm-track glyph (DESIGN 2): one dot per 6-hour track point, dot AREA proportional to the wind level.
// Shared by the chart on the globe (scene/chart.ts) and the specimen legend (ui/key.ts), so both draw the
// same sizes. Pure functions, no DOM.
import { windLevel, type Track, type TrackPoint } from './verdict';

/** Radius (px) of a level-1 dot; a level-n dot has radius K * sqrt(n), so its area is proportional to n. */
export const GLYPH_K = 1.7;
/** Radius (px) of the hollow ring drawn where the data has no wind (never a zero-size dot). */
export const GLYPH_MISSING_R = 3;

/** Dot radius in px for a wind level (null: no wind in the data). */
export function glyphRadius(level: number | null): number {
  if (level === null) return GLYPH_MISSING_R;
  return GLYPH_K * Math.sqrt(Math.max(level, 0.5));
}

const H6 = 6 * 3600 * 1000;
const H24 = 24 * 3600 * 1000;

/** The track points on the 6-hour grid of the data times (00, 06, 12, 18 UTC). */
export function glyphPoints(track: Track): TrackPoint[] {
  return track.points.filter((p) => Date.parse(p.t) % H6 === 0);
}

/** True for the points that carry a date label: one every 24 hours, at 00 UTC. */
export const isDatePoint = (p: TrackPoint): boolean => Date.parse(p.t) % H24 === 0;

/** Wind levels the data reaches, lowest and highest (nulls left out). */
export function levelRange(track: Track): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const p of track.points) {
    const l = windLevel(p.windKt);
    if (l === null) continue;
    min = Math.min(min, l);
    max = Math.max(max, l);
  }
  return { min, max };
}

/** Example levels for the size key: 6, 10, 14 and the highest level in the data, inside the data's range. */
export function keyLevels(track: Track): number[] {
  const { min, max } = levelRange(track);
  const out = [6, 10, 14].filter((l) => l >= min && l < max);
  out.push(max);
  return out;
}
