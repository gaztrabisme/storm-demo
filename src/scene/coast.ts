// Earth textures painted from Natural Earth coast data (public domain), after AstroSphere src/scene/earth.ts
// and src/data/land.ts. The data comes from the world-atlas npm package via scripts/build-coast.mjs:
//  - coast-110m.json: Natural Earth 1:110m land, the whole globe (equirectangular texture);
//  - coast-10m-vn.json: Natural Earth 1:10m land clipped to REGION, painted on its own sphere patch (SPEC 3.3).
import * as THREE from 'three';
import world from '../data/generated/coast-110m.json';
import vn from '../data/generated/coast-10m-vn.json';
import type { EarthPalette } from './colors';

type Rings = number[][];

/** The 10m region (degrees). Must match REGION in scripts/build-coast.mjs. */
export const REGION = vn.region as { west: number; east: number; south: number; north: number };

type Project = (lon: number, lat: number) => [number, number];

function drawRings(ctx: CanvasRenderingContext2D, rings: Rings, project: Project, fill: string, stroke: string, lineWidth: number, wrap = false): void {
  ctx.beginPath();
  for (const ring of rings) {
    // On the whole-globe texture a ring that crosses the 180th meridian is unwrapped (its longitudes made
    // continuous) and drawn again one turn east and west, so it never paints a band across the map.
    const shifts = [0];
    if (wrap) {
      let off = 0;
      let min = Infinity;
      let max = -Infinity;
      const lons: number[] = [];
      for (let i = 0; i < ring.length; i += 2) {
        if (i > 0) {
          const d = ring[i] + off - lons[lons.length - 1];
          if (d > 180) off -= 360;
          else if (d < -180) off += 360;
        }
        const l = ring[i] + off;
        lons.push(l);
        min = Math.min(min, l);
        max = Math.max(max, l);
      }
      if (min < -180) shifts.push(360);
      if (max > 180) shifts.push(-360);
      for (const sh of shifts) {
        for (let i = 0; i < ring.length; i += 2) {
          const [x, y] = project(lons[i / 2] + sh, ring[i + 1]);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
      }
      continue;
    }
    for (let i = 0; i < ring.length; i += 2) {
      const [x, y] = project(ring[i], ring[i + 1]);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }
  ctx.fillStyle = fill;
  ctx.fill('evenodd');
  ctx.strokeStyle = stroke;
  ctx.lineWidth = lineWidth;
  ctx.lineJoin = 'round';
  ctx.stroke();
}

function canvasTexture(c: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Whole-globe texture, equirectangular, longitude -180 at u = 0 (matches THREE.SphereGeometry). */
export function worldTexture(pal: EarthPalette): THREE.CanvasTexture {
  const w = 2048;
  const h = 1024;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  const pt: [number, number] = [0, 0];
  const project: Project = (lon, lat) => {
    pt[0] = ((lon + 180) / 360) * w;
    pt[1] = ((90 - lat) / 180) * h;
    return pt;
  };
  ctx.fillStyle = pal.sea;
  ctx.fillRect(0, 0, w, h);
  drawRings(ctx, world as Rings, project, pal.land, pal.coast, 0.6, true);
  return canvasTexture(c);
}

interface Box {
  west: number;
  east: number;
  south: number;
  north: number;
}

/**
 * A sphere-patch texture for a lat/lon box, painted from the given rings at w x h pixels. Its edges fade out
 * over one degree, so the patch blends into the coarser layer under it.
 */
function patchTexture(pal: EarthPalette, box: Box, rings: Rings, w: number, h: number, lineWidth: number, wrap = false): THREE.CanvasTexture {
  const { west, east, south, north } = box;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  const sx = w / (east - west);
  const sy = h / (north - south);
  const pt: [number, number] = [0, 0];
  const project: Project = (lon, lat) => {
    pt[0] = (lon - west) * sx;
    pt[1] = (north - lat) * sy;
    return pt;
  };
  ctx.fillStyle = pal.sea;
  ctx.fillRect(0, 0, w, h);
  drawRings(ctx, rings, project, pal.land, pal.coast, lineWidth, wrap);
  // Fade the edges to transparent.
  ctx.globalCompositeOperation = 'destination-out';
  const edge = (x0: number, y0: number, x1: number, y1: number, rx: number, ry: number, rw: number, rh: number) => {
    const e = ctx.createLinearGradient(x0, y0, x1, y1);
    e.addColorStop(0, 'rgba(0,0,0,1)');
    e.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = e;
    ctx.fillRect(rx, ry, rw, rh);
  };
  edge(0, 0, sx, 0, 0, 0, sx, h);
  edge(w, 0, w - sx, 0, w - sx, 0, sx, h);
  edge(0, 0, 0, sy, 0, 0, w, sy);
  edge(0, h, 0, h - sy, 0, h - sy, w, sy);
  ctx.globalCompositeOperation = 'source-over';
  return canvasTexture(c);
}

/** Texture for the REGION patch, from 10m data. */
export function regionTexture(pal: EarthPalette): THREE.CanvasTexture {
  return patchTexture(pal, REGION, vn.rings as Rings, 2048, 2048, 1.6);
}

/**
 * The chart area around the region (the whole track and its neighbours), from the same 110m data as the
 * globe but painted sharp enough for the chart's scale, so no coast outside the 10m region turns into a
 * blurred, stepped edge. Rings that cross the 180th meridian are unwrapped as on the globe texture.
 */
export const CHART_AREA: Box = { west: 70, east: 170, south: -25, north: 50 };
export function chartAreaTexture(pal: EarthPalette): THREE.CanvasTexture {
  return patchTexture(pal, CHART_AREA, world as Rings, 4096, 3072, 1.4, true);
}

/** Sphere patch geometry for a lat/lon box, in the same frame as THREE.SphereGeometry and vec() in boot.ts. */
export function patchGeometry(radius: number, box: Box): THREE.SphereGeometry {
  const RAD = Math.PI / 180;
  const { west, east, south, north } = box;
  return new THREE.SphereGeometry(radius, 128, 96, (west + 180) * RAD, (east - west) * RAD, (90 - north) * RAD, (north - south) * RAD);
}

/** Sphere patch geometry covering REGION, in the same frame as THREE.SphereGeometry and vec() in boot.ts. */
export function regionGeometry(radius: number): THREE.SphereGeometry {
  const RAD = Math.PI / 180;
  const { west, east, south, north } = REGION;
  return new THREE.SphereGeometry(radius, 96, 96, (west + 180) * RAD, (east - west) * RAD, (90 - north) * RAD, (north - south) * RAD);
}

/**
 * Land or sea at a point, from the same coast data: the 10m region at 0.05 degree, the 110m globe at
 * 0.5 degree elsewhere. Used to keep map notes and date labels in open sea.
 */
export function landMask(): (lat: number, lon: number) => boolean {
  const paint = (rings: Rings, w: number, h: number, wrap: boolean, project: Project): Uint8ClampedArray => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    drawRings(ctx, rings, project, '#000', 'rgba(0,0,0,0)', 0, wrap);
    return ctx.getImageData(0, 0, w, h).data;
  };
  const { west, east, south, north } = REGION;
  const RS = 20; // cells per degree in the region
  const rw = (east - west) * RS;
  const rh = (north - south) * RS;
  const rpt: [number, number] = [0, 0];
  const region = paint(vn.rings as Rings, rw, rh, false, (lon, lat) => {
    rpt[0] = (lon - west) * RS;
    rpt[1] = (north - lat) * RS;
    return rpt;
  });
  const wpt: [number, number] = [0, 0];
  const globe = paint(world as Rings, 720, 360, true, (lon, lat) => {
    wpt[0] = (lon + 180) * 2;
    wpt[1] = (90 - lat) * 2;
    return wpt;
  });
  return (lat, lon) => {
    if (lon >= west && lon < east && lat > south && lat <= north) {
      const x = Math.floor((lon - west) * RS);
      const y = Math.floor((north - lat) * RS);
      return region[(y * rw + x) * 4 + 3] > 127;
    }
    const L = ((((lon + 180) % 360) + 360) % 360);
    const x = Math.min(719, Math.floor(L * 2));
    const y = Math.min(359, Math.max(0, Math.floor((90 - lat) * 2)));
    return globe[(y * 720 + x) * 4 + 3] > 127;
  };
}
