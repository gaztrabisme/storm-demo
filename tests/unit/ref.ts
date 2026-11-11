// Reference geometry and helpers for the locked unit tests (SPEC section 5).
// Independent of the app: the tests compute their expected values with these.

export const R_KM = 6371; // mean Earth radius; tests keep margins of >= 1 % so any common radius passes
const RAD = Math.PI / 180;
export const NM_KM = 1.852;
export const HOUR = 3600 * 1000;
export const STEP = 30 * 60 * 1000;
export const NOW = new Date('2024-09-05T00:00:00Z');

export type Quad = 'ne' | 'se' | 'sw' | 'nw';
export type Radii = Record<Quad, number | null>;
export interface Pt {
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
  points: Pt[];
}

/** Great-circle distance in km (haversine). */
export function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * RAD;
  const dLon = (lon2 - lon1) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing in degrees [0, 360) from point 1 to point 2. */
export function bearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const p1 = lat1 * RAD;
  const p2 = lat2 * RAD;
  const dl = (lon2 - lon1) * RAD;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return ((Math.atan2(y, x) / RAD) % 360 + 360) % 360;
}

/** Point at distance dKm and bearing brg from (lat, lon). */
export function destination(lat: number, lon: number, brg: number, dKm: number): { lat: number; lon: number } {
  const d = dKm / R_KM;
  const p1 = lat * RAD;
  const l1 = lon * RAD;
  const b = brg * RAD;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return { lat: p2 / RAD, lon: l2 / RAD };
}

/** Milliseconds from whatever time shape the app returns (Date, ISO string, or ms number). */
export function ms(x: unknown): number {
  if (x instanceof Date) return x.getTime();
  if (typeof x === 'number') return x;
  if (typeof x === 'string') return Date.parse(x);
  throw new Error(`not a time: ${String(x)}`);
}

export const iso = (msValue: number) => new Date(msValue).toISOString().replace('.000Z', 'Z');

export function radii(r: number | null | Partial<Radii>): Radii {
  if (r === null || typeof r === 'number') return { ne: r, se: r, sw: r, nw: r };
  return { ne: null, se: null, sw: null, nw: null, ...r };
}

/** A track point `h` hours after NOW. */
export function pt(h: number, lat: number, lon: number, windKt: number | null, r: number | null | Partial<Radii>): Pt {
  return { t: iso(NOW.getTime() + h * HOUR), lat, lon, windKt, r34nm: radii(r) };
}

export const track = (points: Pt[]): Track => ({ name: 'Test', season: 2024, source: 'test', points });

/** Steps returned by interpolateTrack may be an array or { points: [...] }. */
export function stepsOf(r: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(r)) return r;
  if (r && typeof r === 'object' && Array.isArray((r as { points?: unknown }).points)) return (r as { points: Array<Record<string, unknown>> }).points;
  throw new Error('interpolateTrack returned neither an array nor { points }');
}
