// Locked acceptance tests: SPEC section 5 (verdict rule), with synthetic tracks only.
// Calling convention assumed from SPEC: verdict(place {lat, lon}, track {points: [...]} shaped like yagi.json, now: Date).
import { describe, expect, it } from 'vitest';
import { verdict, windLevel } from '../../src/storm/verdict';
import { HOUR, NM_KM, NOW, R_KM, bearing, destination, haversine, ms, pt, track } from './ref';
import { BEAUFORT_LOWER_MS, KT_TO_MS, refWindLevel, sourcesBeaufortLower } from '../content.mjs';

const T0 = NOW.getTime();
const quads = ['ne', 'se', 'sw', 'nw'] as const;
type Q = (typeof quads)[number];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const V = (place: { lat: number; lon: number }, tr: unknown, now: Date = NOW): any => (verdict as any)(place, tr, now);

/** A storm parked at (lat, lon) from 3 h before now to 3 h after. */
const parked = (lat: number, lon: number, r: Parameters<typeof pt>[4], wind: number | null = 80) =>
  track([pt(-3, lat, lon, wind, r), pt(0, lat, lon, wind, r), pt(3, lat, lon, wind, r)]);

describe('reference geometry (self-check of the test helpers)', () => {
  it('haversine and bearing behave on the equator', () => {
    expect(haversine(0, 0, 0, 1)).toBeCloseTo((Math.PI / 180) * R_KM, 6);
    expect(bearing(0, 110, 0, 111)).toBe(90);
    expect(bearing(0, 110, 1, 110)).toBe(0);
    expect(bearing(0, 110, -1, 110)).toBe(180);
    expect(bearing(0, 110, 0, 109)).toBe(270);
  });
});

describe('inside test: d <= radius x 1.852 km', () => {
  it('a place exactly on the edge counts inside (radius 0, place at the centre: d = r = 0)', () => {
    const v = V({ lat: 0, lon: 120 }, parked(0, 120, 0));
    expect(v.affected).toBe(true);
    expect(ms(v.firstInside)).toBe(T0);
    expect(ms(v.lastInside)).toBe(T0 + 3 * HOUR);
  });

  it('just off a zero radius does not count inside', () => {
    const v = V({ lat: 0, lon: 120.01 }, parked(0, 120, 0));
    expect(v.affected).toBe(false);
    expect(v.firstInside).toBeNull();
    expect(v.lastInside).toBeNull();
  });

  it('1 % inside the radius counts, 1 % outside does not', () => {
    const rKm = 100 * NM_KM;
    const inside = destination(20, 110, 10, rKm * 0.99);
    const outside = destination(20, 110, 10, rKm * 1.01);
    expect(V(inside, parked(20, 110, 100)).affected).toBe(true);
    expect(V(outside, parked(20, 110, 100)).affected).toBe(false);
  });
});

describe('quadrant chosen by bearing from the centre to the place', () => {
  const c = { lat: 0, lon: 110 };
  const deg = (300 / R_KM) * (180 / Math.PI); // 300 km of arc in degrees
  // Exact boundary places on the equator so the bearing is exactly 0/90/180/270.
  const cases: Array<[string, { lat: number; lon: number }, Q]> = [
    ['bearing 0 (due north) -> NE', { lat: deg, lon: 110 }, 'ne'],
    ['bearing 90 (due east) -> SE', { lat: 0, lon: 110 + deg }, 'se'],
    ['bearing 180 (due south) -> SW', { lat: -deg, lon: 110 }, 'sw'],
    ['bearing 270 (due west) -> NW', { lat: 0, lon: 110 - deg }, 'nw'],
    ['bearing 45 -> NE', destination(0, 110, 45, 300), 'ne'],
    ['bearing 135 -> SE', destination(0, 110, 135, 300), 'se'],
    ['bearing 225 -> SW', destination(0, 110, 225, 300), 'sw'],
    ['bearing 315 -> NW', destination(0, 110, 315, 300), 'nw'],
    ['bearing 89.5 -> NE', destination(0, 110, 89.5, 300), 'ne'],
    ['bearing 179.5 -> SE', destination(0, 110, 179.5, 300), 'se'],
    ['bearing 269.5 -> SW', destination(0, 110, 269.5, 300), 'sw'],
    ['bearing 359.5 -> NW', destination(0, 110, 359.5, 300), 'nw'],
  ];
  for (const [name, place, want] of cases) {
    it(name, () => {
      // Only the expected quadrant has a radius (500 nm) larger than 300 km; the others are 0.
      for (const q of quads) {
        const r = { ne: 0, se: 0, sw: 0, nw: 0, [q]: 500 };
        const v = V(place, parked(c.lat, c.lon, r));
        expect(v.affected, `radius only in ${q}`).toBe(q === want);
      }
    });
  }
});

describe('null radius', () => {
  it('a null radius never counts inside, even at the centre', () => {
    const v = V({ lat: 20, lon: 110 }, parked(20, 110, null));
    expect(v.affected).toBe(false);
    expect(v.firstInside).toBeNull();
    expect(v.lastInside).toBeNull();
    expect(v.peakWindKt).toBeNull();
    expect(v.closest.distanceKm).toBeCloseTo(0, 3);
  });

  it('only the null quadrant is excluded', () => {
    const tr = parked(20, 110, { ne: null, se: 500, sw: 500, nw: 500 });
    expect(V(destination(20, 110, 45, 50), tr).affected).toBe(false);
    expect(V(destination(20, 110, 135, 50), tr).affected).toBe(true);
  });
});

// SPEC 5.1 interpolation, checked through verdict() only (SPEC names verdict, windLevel and timeline, not a
// separate interpolation function). A storm moves east along the equator at 1° of longitude per hour,
// from 120° E at now to 123° E at now + 3 h, so its centre is at 120 + t° E at t hours.
describe('30-minute steps from now to the last point, linear interpolation (SPEC 5.1, through verdict)', () => {
  const moving = (w0: number | null, w3: number | null, rNm: number) => track([pt(0, 0, 120, w0, rNm), pt(3, 0, 123, w3, rNm)]);

  it('position is linear and the steps are 30 min apart: a place reached only at now + 1.5 h is inside then and only then', () => {
    // 121.6° E, radius 10 nm (18.5 km): inside while |1.6 - t| <= 0.17 h, which holds only for the step at 1.5 h.
    const v = V({ lat: 0, lon: 121.6 }, moving(60, 60, 10));
    expect(v.affected).toBe(true);
    expect(ms(v.firstInside)).toBe(T0 + 1.5 * HOUR);
    expect(ms(v.lastInside)).toBe(T0 + 1.5 * HOUR);
    expect(ms(v.closest.time)).toBe(T0 + 1.5 * HOUR);
    const want = 0.1 * (Math.PI / 180) * R_KM; // 0.1° of the equator, about 11.1 km
    expect(Math.abs(v.closest.distanceKm - want) / want).toBeLessThan(0.01);
  });

  it('nothing between the 30-minute steps counts: a place inside only between 1.3 h and 1.45 h is not affected', () => {
    // 121.375° E, radius 4 nm (7.4 km): the nearest steps (1.0 h and 1.5 h) are 42 km and 14 km away.
    const v = V({ lat: 0, lon: 121.375 }, moving(60, 60, 4));
    expect(v.affected).toBe(false);
    expect(v.firstInside).toBeNull();
    expect(ms(v.closest.time)).toBe(T0 + 1.5 * HOUR);
  });

  it('when now falls between points, the steps start at now itself (now + 1.25 h -> steps at 1.25, 1.75, ...)', () => {
    // Steps at 1.25 h and 1.75 h: 0.35° and 0.15° from 121.6° E; only 1.75 h is within 18.5 km.
    const v = V({ lat: 0, lon: 121.6 }, moving(60, 60, 10), new Date(T0 + 1.25 * HOUR));
    expect(v.affected).toBe(true);
    expect(ms(v.firstInside)).toBe(T0 + 1.75 * HOUR);
    expect(ms(v.lastInside)).toBe(T0 + 1.75 * HOUR);
  });

  it('the steps reach the last point: a storm parked on the place has lastInside at the last point', () => {
    const v = V({ lat: 0, lon: 120 }, track([pt(0, 0, 120, 60, 50), pt(3, 0, 120, 60, 50)]));
    expect(ms(v.firstInside)).toBe(T0);
    expect(ms(v.lastInside)).toBe(T0 + 3 * HOUR);
  });

  it('wind is linear: inside only at now + 1.5 h, with 60 kt at now and 90 kt at now + 3 h, peakWindKt is 75', () => {
    const v = V({ lat: 0, lon: 121.6 }, moving(60, 90, 10));
    expect(v.peakWindKt).toBeCloseTo(75, 6);
  });

  it('a null wind at the end of a segment gives a null wind between the points', () => {
    const v = V({ lat: 0, lon: 121.6 }, moving(60, null, 10));
    expect(v.affected).toBe(true);
    expect(v.peakWindKt).toBeNull();
  });

  it('a null wind at the start of a segment gives a null wind between the points', () => {
    const v = V({ lat: 0, lon: 121.6 }, moving(null, 90, 10));
    expect(v.affected).toBe(true);
    expect(v.peakWindKt).toBeNull();
  });

  it('radius is linear: growing from 0 to 162 nm (300 km) over 3 h, a place 140 km away is first inside at 1.5 h', () => {
    // r(t) = 100 km per hour: 100 km at 1.0 h (outside), 150 km at 1.5 h (inside).
    const place = destination(0, 120, 90, 140);
    const v = V(place, track([pt(0, 0, 120, 60, 0), pt(3, 0, 120, 60, 162)]));
    expect(v.affected).toBe(true);
    expect(ms(v.firstInside)).toBe(T0 + 1.5 * HOUR);
    expect(ms(v.lastInside)).toBe(T0 + 3 * HOUR);
  });

  it('a null radius at the end of a segment gives a null radius between the points', () => {
    // 300 nm at now, null at now + 3 h: of the steps, only now itself has a radius.
    // The value at a track point that has its own radius is not asserted for the reverse case (SPEC leaves it open).
    const place = destination(0, 120, 90, 50);
    const v = V(place, track([pt(0, 0, 120, 60, 300), pt(3, 0, 120, 60, null)]));
    expect(ms(v.firstInside)).toBe(T0);
    expect(ms(v.lastInside)).toBe(T0);
  });
});

describe('only times >= now count', () => {
  it('a storm that passed over the place before now does not affect it', () => {
    const tr = track([
      pt(-6, 15, 115, 100, 200),
      pt(-3, 15, 115, 100, 200),
      pt(0, 25, 130, 100, 50),
      pt(3, 26, 131, 100, 50),
    ]);
    const place = { lat: 15, lon: 115 };
    const v = V(place, tr);
    expect(v.affected).toBe(false);
    expect(ms(v.closest.time)).toBe(T0);
    const want = haversine(25, 130, 15, 115);
    expect(Math.abs(v.closest.distanceKm - want) / want).toBeLessThan(0.01);
  });
});

describe('verdict fields on a storm moving north along 110 E', () => {
  // 2 degrees of latitude per 3 h; 100 nm (185.2 km) in every quadrant.
  const tr = track([
    pt(0, 14, 110, 120, 100),
    pt(3, 16, 110, 80, 100),
    pt(6, 18, 110, 100, 100),
    pt(9, 20, 110, 90, 100),
    pt(12, 22, 110, 70, 100),
  ]);
  const place = { lat: 18, lon: 110.5 };

  it('firstInside and lastInside are the first and last 30-minute steps inside', () => {
    const v = V(place, tr);
    expect(v.affected).toBe(true);
    expect(ms(v.firstInside)).toBe(T0 + 4 * HOUR);
    expect(ms(v.lastInside)).toBe(T0 + 8 * HOUR);
  });

  it('closest is the step with the smallest distance', () => {
    const v = V(place, tr);
    expect(ms(v.closest.time)).toBe(T0 + 6 * HOUR);
    const want = haversine(18, 110, 18, 110.5);
    expect(Math.abs(v.closest.distanceKm - want) / want).toBeLessThan(0.01);
  });

  it('peakWindKt is the largest wind while inside, not over the whole track', () => {
    const v = V(place, tr);
    expect(v.peakWindKt).toBeCloseTo(100, 6);
  });

  it('an unaffected place has null times and null peak wind but a closest point', () => {
    const v = V({ lat: 18, lon: 115 }, tr);
    expect(v.affected).toBe(false);
    expect(v.firstInside).toBeNull();
    expect(v.lastInside).toBeNull();
    expect(v.peakWindKt).toBeNull();
    expect(ms(v.closest.time)).toBe(T0 + 6 * HOUR);
    const want = haversine(18, 110, 18, 115);
    expect(Math.abs(v.closest.distanceKm - want) / want).toBeLessThan(0.01);
  });
});

describe('windLevel (SPEC 5.5: knots x 0.514444 -> m/s -> Decision 18/2021 Appendix III level)', () => {
  const W = (kt: number | null) => (windLevel as any)(kt);

  it('the tests\' own table matches the SOURCES.md "Beaufort table" lower bounds (self-check)', () => {
    const rows = sourcesBeaufortLower();
    expect(rows.length).toBe(18);
    expect(rows.map(([n]) => n)).toEqual([...Array(18).keys()]);
    expect(rows.map(([, lo]) => lo)).toEqual(BEAUFORT_LOWER_MS);
  });

  it('named values: 0 kt -> 0, 1 kt -> 1, 33 kt -> 7, 34 kt -> 8, 63 kt -> 11, 64 kt -> 12, 130 kt -> 17', () => {
    expect(W(0)).toBe(0); // 0 m/s
    expect(W(1)).toBe(1); // 0.51 m/s
    expect(W(33)).toBe(7); // 16.98 m/s
    expect(W(34)).toBe(8); // 17.49 m/s
    expect(W(63)).toBe(11); // 32.41 m/s
    expect(W(64)).toBe(12); // 32.92 m/s
    expect(W(130)).toBe(17); // 66.88 m/s
  });

  it('above 61.2 m/s (119 kt and more) it returns 17', () => {
    expect(W(119)).toBe(17); // 61.22 m/s
    expect(W(200)).toBe(17);
    expect(W(300)).toBe(17);
  });

  it('null in gives null out', () => {
    expect(W(null)).toBeNull();
  });

  it('each level starts at its lower bound: 0.01 kt below the bound is level n-1, 0.01 kt above is level n', () => {
    for (let n = 1; n < BEAUFORT_LOWER_MS.length; n++) {
      const kt = BEAUFORT_LOWER_MS[n] / KT_TO_MS;
      expect(W(kt - 0.01), `${(kt - 0.01).toFixed(3)} kt`).toBe(n - 1);
      expect(W(kt + 0.01), `${(kt + 0.01).toFixed(3)} kt`).toBe(n);
    }
  });

  it('every whole knot from 0 to 200 gives the table level', () => {
    for (let kt = 0; kt <= 200; kt++) expect(W(kt), `${kt} kt`).toBe(refWindLevel(kt));
  });
});
