// SPEC section 5: verdict rule. Pure functions, no DOM.

export type Quad = 'ne' | 'se' | 'sw' | 'nw';
export type Radii = Record<Quad, number | null>;

export interface TrackPoint {
  t: string;
  lat: number;
  lon: number;
  windKt: number | null;
  r34nm: Radii;
}

export interface Track {
  name: string;
  season: number;
  source: string;
  points: TrackPoint[];
}

export interface LatLon {
  lat: number;
  lon: number;
}

export interface Verdict {
  affected: boolean;
  /** ISO time of the first 30-minute step inside, or null. */
  firstInside: string | null;
  lastInside: string | null;
  closest: { time: string; distanceKm: number };
  peakWindKt: number | null;
}

export interface Step extends LatLon {
  ms: number;
  windKt: number | null;
  r34nm: Radii;
}

export const EARTH_R_KM = 6371;
export const NM_KM = 1.852;
export const STEP_MS = 30 * 60 * 1000;
export const KT_TO_MS = 0.514444;
const RAD = Math.PI / 180;
const QUADS: readonly Quad[] = ['ne', 'se', 'sw', 'nw'];

/** Lower bounds (m/s) of wind levels 0..17, Decision 18/2021 Appendix III (SOURCES.md, Beaufort table). */
export const BEAUFORT_LOWER_MS: readonly number[] = [0, 0.3, 1.6, 3.4, 5.5, 8.0, 10.8, 13.9, 17.2, 20.8, 24.5, 28.5, 32.7, 37.0, 41.5, 46.2, 51.0, 56.1];

const toMs = (t: Date | string | number): number => (t instanceof Date ? t.getTime() : typeof t === 'number' ? t : Date.parse(String(t)));
const iso = (ms: number): string => new Date(ms).toISOString();
const lerp = (a: number | null, b: number | null, f: number): number | null => (a === null || b === null ? null : a + (b - a) * f);

/** Great-circle distance in km. */
export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * RAD;
  const dLon = (lon2 - lon1) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_R_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing in degrees [0, 360) from point 1 to point 2. */
export function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const p1 = lat1 * RAD;
  const p2 = lat2 * RAD;
  const dl = (lon2 - lon1) * RAD;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (((Math.atan2(y, x) / RAD) % 360) + 360) % 360;
}

export function quadrantOf(bearing: number): Quad {
  return bearing < 90 ? 'ne' : bearing < 180 ? 'se' : bearing < 270 ? 'sw' : 'nw';
}

/** Track state at time ms, linear between points (SPEC 5.1). Null outside the track. */
export function trackAt(track: Track, ms: number): Step | null {
  const pts = track.points;
  if (pts.length === 0) return null;
  const first = Date.parse(pts[0].t);
  const last = Date.parse(pts[pts.length - 1].t);
  if (ms < first || ms > last) return null;
  let i = 0;
  while (i < pts.length && Date.parse(pts[i].t) < ms) i++;
  const b = pts[i];
  const a = i > 0 ? pts[i - 1] : b;
  const ta = Date.parse(a.t);
  const tb = Date.parse(b.t);
  const f = tb === ta ? 0 : (ms - ta) / (tb - ta);
  const r34nm = {} as Radii;
  for (const q of QUADS) r34nm[q] = lerp(a.r34nm[q], b.r34nm[q], f);
  return { ms, lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f, windKt: lerp(a.windKt, b.windKt, f), r34nm };
}

/** 30-minute steps from now to the last point (SPEC 5.1). */
export function steps(track: Track, now: Date | string | number): Step[] {
  const start = toMs(now);
  const pts = track.points;
  if (pts.length === 0) return [];
  const end = Date.parse(pts[pts.length - 1].t);
  const out: Step[] = [];
  for (let t = start; t <= end; t += STEP_MS) {
    const s = trackAt(track, t);
    if (s) out.push(s);
  }
  return out;
}

/** SPEC 5.4. */
export function verdict(place: LatLon, track: Track, now: Date | string | number): Verdict {
  let first: number | null = null;
  let last: number | null = null;
  let peak: number | null = null;
  let closest: { ms: number; d: number } | null = null;
  for (const s of steps(track, now)) {
    const d = distanceKm(place.lat, place.lon, s.lat, s.lon);
    if (!closest || d < closest.d) closest = { ms: s.ms, d };
    const r = s.r34nm[quadrantOf(bearingDeg(s.lat, s.lon, place.lat, place.lon))];
    if (r !== null && d <= r * NM_KM) {
      if (first === null) first = s.ms;
      last = s.ms;
      if (s.windKt !== null && (peak === null || s.windKt > peak)) peak = s.windKt;
    }
  }
  const c = closest ?? { ms: toMs(now), d: NaN };
  return {
    affected: first !== null,
    firstInside: first === null ? null : iso(first),
    lastInside: last === null ? null : iso(last),
    closest: { time: iso(c.ms), distanceKm: c.d },
    peakWindKt: peak,
  };
}

export interface Province extends LatLon {
  id: string;
  name: string;
}

export interface TimelineRow {
  id: string;
  province: Province;
  verdict: Verdict;
}

/** Every province: affected first by firstInside, then unaffected by closest distance (SPEC 5). */
export function timeline(provinces: readonly Province[], track: Track, now: Date | string | number): TimelineRow[] {
  const rows = provinces.map((p) => ({ id: p.id, province: p, verdict: verdict(p, track, now) }));
  return rows.sort((x, y) => {
    const a = x.verdict;
    const b = y.verdict;
    if (a.affected !== b.affected) return a.affected ? -1 : 1;
    if (a.affected && b.affected) return Date.parse(a.firstInside!) - Date.parse(b.firstInside!);
    return a.closest.distanceKm - b.closest.distanceKm;
  });
}

/** Vietnamese wind level 0-17 from knots (SPEC 5.5). */
export function windLevel(kt: number | null | undefined): number | null {
  if (kt === null || kt === undefined || !Number.isFinite(kt)) return null;
  const ms = kt * KT_TO_MS;
  let level = 0;
  for (let n = 0; n < BEAUFORT_LOWER_MS.length; n++) if (ms >= BEAUFORT_LOWER_MS[n]) level = n;
  return level;
}

export const CONE_RADII: ReadonlyArray<{ hours: number; radiusKm: number }> = [
  { hours: 24, radiusKm: 86 },
  { hours: 48, radiusKm: 148 },
  { hours: 72, radiusKm: 217 },
];

export interface ConeCircle {
  hours: number;
  lat: number;
  lon: number;
  radiusKm: number;
}

/** Track uncertainty circles at now + 24/48/72 h (SPEC 6.2). */
export function cone(track: Track, now: Date | string | number): ConeCircle[] {
  const t0 = toMs(now);
  const out: ConeCircle[] = [];
  for (const c of CONE_RADII) {
    const s = trackAt(track, t0 + c.hours * 3600 * 1000);
    if (s) out.push({ hours: c.hours, lat: s.lat, lon: s.lon, radiusKm: c.radiusKm });
  }
  return out;
}
