// Locked acceptance tests: SPEC section 5, timeline(provinces, track, now).
// Order: affected provinces by firstInside (earliest first), then unaffected ones by closest.distanceKm.
import { describe, expect, it } from 'vitest';
import { timeline } from '../../src/storm/verdict';
import { HOUR, NOW, ms, pt, track } from './ref';

const T0 = NOW.getTime();
// Storm moving north along 110 E, 2 degrees per 3 h, 100 nm (185.2 km) in every quadrant.
const tr = track([
  pt(0, 14, 110, 120, 100),
  pt(3, 16, 110, 80, 100),
  pt(6, 18, 110, 100, 100),
  pt(9, 20, 110, 90, 100),
  pt(12, 22, 110, 70, 100),
]);
const provinces = [
  { id: 'far', name: 'Xa', lat: 18, lon: 115 }, // ~530 km from the track, unaffected
  { id: 'late', name: 'Muộn', lat: 21, lon: 110.5 }, // inside from about now + 8.5 h
  { id: 'near', name: 'Gần', lat: 18, lon: 112.5 }, // ~265 km, unaffected
  { id: 'early', name: 'Sớm', lat: 16, lon: 110.5 }, // inside from about now + 1 h
];

// Rows may be { id, ...verdict }, { province, verdict } or { place, verdict }.
const idOf = (r: any): string => r.id ?? r.province?.id ?? r.place?.id;
const vOf = (r: any): any => r.verdict ?? r;

describe('timeline', () => {
  const rows = (timeline as any)(provinces, tr, NOW) as any[];

  it('returns every province once', () => {
    expect(rows.length).toBe(4);
    expect(new Set(rows.map(idOf))).toEqual(new Set(['far', 'late', 'near', 'early']));
  });

  it('affected first by firstInside, then unaffected by closest distance', () => {
    expect(rows.map(idOf)).toEqual(['early', 'late', 'near', 'far']);
  });

  it('each row carries its verdict', () => {
    const byId = Object.fromEntries(rows.map((r) => [idOf(r), vOf(r)]));
    expect(byId.early.affected).toBe(true);
    expect(byId.late.affected).toBe(true);
    expect(byId.near.affected).toBe(false);
    expect(byId.far.affected).toBe(false);
    expect(ms(byId.early.firstInside)).toBe(T0 + 1 * HOUR);
    expect(ms(byId.late.firstInside)).toBe(T0 + 8.5 * HOUR);
    expect(byId.near.closest.distanceKm).toBeLessThan(byId.far.closest.distanceKm);
  });
});
