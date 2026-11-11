// Coast data for the globe (run: node scripts/build-coast.mjs).
// Source: Natural Earth land polygons (public domain) as shipped by the world-atlas npm package (ISC):
//  - land-110m.json for the whole globe -> src/data/generated/coast-110m.json
//  - land-10m.json clipped to the Vietnam region box (REGION below), 0.01° precision -> src/data/generated/coast-10m-vn.json
// world-atlas ships 10m, so SPEC 3.3 (10m for the Vietnam region, 110m elsewhere) is met as written.
// Each output is an array of rings, each ring a flat [lon0, lat0, lon1, lat1, ...]. Deterministic output.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { feature } from 'topojson-client';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));
const outDir = join(root, 'src/data/generated');
mkdirSync(outDir, { recursive: true });

/** Region drawn from 10m data. Must match REGION in src/scene/coast.ts. */
const REGION = { west: 95, east: 125, south: 0, north: 30 };
/** Clip box: one degree wider than the region, so the edges the clip adds fall outside what is drawn. */
const CLIP = { west: REGION.west - 1, east: REGION.east + 1, south: REGION.south - 1, north: REGION.north + 1 };

const round = (x, d) => Math.round(x * 10 ** d) / 10 ** d;

function rings(path) {
  const topo = readJson(path);
  const geo = feature(topo, topo.objects.land);
  const out = [];
  for (const f of geo.features) {
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const poly of polys) for (const ring of poly) out.push(ring);
  }
  return out;
}

/** Sutherland-Hodgman clip of one ring against an axis-aligned box. */
function clip(ring, box) {
  const edges = [
    (p) => p[0] >= box.west,
    (p) => p[0] <= box.east,
    (p) => p[1] >= box.south,
    (p) => p[1] <= box.north,
  ];
  const cross = [
    (a, b) => at(a, b, (box.west - a[0]) / (b[0] - a[0])),
    (a, b) => at(a, b, (box.east - a[0]) / (b[0] - a[0])),
    (a, b) => at(a, b, (box.south - a[1]) / (b[1] - a[1])),
    (a, b) => at(a, b, (box.north - a[1]) / (b[1] - a[1])),
  ];
  let pts = ring;
  for (let e = 0; e < 4 && pts.length; e++) {
    const inside = edges[e];
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const ia = inside(a);
      const ib = inside(b);
      if (ia) out.push(a);
      if (ia !== ib) out.push(cross[e](a, b));
    }
    pts = out;
  }
  return pts;
}
const at = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

function flatten(ring, digits) {
  const flat = [];
  let px = NaN;
  let py = NaN;
  for (const [lon, lat] of ring) {
    const x = round(lon, digits);
    const y = round(lat, digits);
    if (x === px && y === py) continue;
    flat.push(x, y);
    px = x;
    py = y;
  }
  return flat;
}

const world = rings('node_modules/world-atlas/land-110m.json').map((r) => flatten(r, 2)).filter((r) => r.length >= 6);
const region = rings('node_modules/world-atlas/land-10m.json')
  .map((r) => clip(r, CLIP))
  .filter((r) => r.length >= 3)
  .map((r) => flatten(r, 2))
  .filter((r) => r.length >= 6);

const write = (name, data) => {
  const s = JSON.stringify(data);
  writeFileSync(join(outDir, name), s);
  console.log(`${name}: ${(data.rings ?? data).length} rings, ${(s.length / 1024).toFixed(1)} KB`);
};
write('coast-110m.json', world);
write('coast-10m-vn.json', { region: REGION, rings: region });
