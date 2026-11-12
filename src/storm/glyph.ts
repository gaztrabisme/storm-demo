// The storm-track glyph (DESIGN 2): one dot per 6-hour track point, dot AREA proportional to the wind level.
// Shared by the chart on the globe (scene/chart.ts) and the specimen legend (ui/key.ts), so both draw the
// same sizes. Pure functions, no DOM.
import { windLevel, type LatLon, type Radii, type Step, type Track, type TrackPoint } from './verdict';

/** Radius (px) of a level-1 dot; a level-n dot has radius K * sqrt(n), so its area is proportional to n. */
export const GLYPH_K = 1.7;
/** Radius (px) of the hollow ring drawn where the data has no wind (never a zero-size dot). */
export const GLYPH_MISSING_R = 3;

/** Smallest drawn dot radius (px), so a dot never shrinks to a speck when the map is far out. */
export const GLYPH_MIN_R = 1.6;

/**
 * Dot radius in px for a wind level (null: no wind in the data). `scale` (0..1) shrinks every dot by the same
 * factor when the map is far out, so area stays proportional to the level; the chart and the key share it.
 */
export function glyphRadius(level: number | null, scale = 1): number {
  if (level === null) return Math.max(GLYPH_MIN_R, GLYPH_MISSING_R * scale);
  return Math.max(GLYPH_MIN_R, GLYPH_K * Math.sqrt(Math.max(level, 0.5)) * scale);
}

/**
 * Dot scale for a map: the level-17 dot may take at most half of the typical gap between neighbouring
 * 6-hour points on screen (`gapPx`), and never grows past its full size.
 */
export function glyphScale(gapPx: number): number {
  if (!(gapPx > 0)) return 1;
  return Math.max(0.35, Math.min(1, (gapPx * 0.5) / (GLYPH_K * Math.sqrt(17))));
}

const RAD = Math.PI / 180;
const EARTH_KM = 6371;
const NM_KM = 1.852;
const QUADS: Array<keyof Radii> = ['ne', 'se', 'sw', 'nw'];

/** Point at distance dKm and bearing brg (deg) from (lat, lon), on a great circle. */
export function destination(lat: number, lon: number, brg: number, dKm: number): LatLon {
  const d = dKm / EARTH_KM;
  const p1 = lat * RAD;
  const l1 = lon * RAD;
  const b = brg * RAD;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return { lat: p2 / RAD, lon: l2 / RAD };
}

/**
 * Outline of the area with wind of level 8 or more around a track position: four quarter arcs from the
 * quadrant radii (the notches between them are the data). Null when the data has no radius.
 */
export function windRing(s: Step): LatLon[] | null {
  const out: LatLon[] = [];
  let any = false;
  for (let q = 0; q < 4; q++) {
    const r = (s.r34nm[QUADS[q]] ?? 0) * NM_KM;
    if (r > 0) any = true;
    for (let i = 0; i <= 18; i++) out.push(destination(s.lat, s.lon, q * 90 + i * 5, r));
  }
  return any ? out : null;
}

/** Circle of radius rKm around (lat, lon), every 5 degrees of bearing. */
export function circleRing(lat: number, lon: number, rKm: number): LatLon[] {
  const out: LatLon[] = [];
  for (let b = 0; b <= 360; b += 5) out.push(destination(lat, lon, b, rKm));
  return out;
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
