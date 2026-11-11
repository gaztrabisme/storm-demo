// Earth textures painted from Natural Earth coast data (public domain), after AstroSphere src/scene/earth.ts
// and src/data/land.ts. The data comes from the world-atlas npm package via scripts/build-coast.mjs:
//  - coast-110m.json: Natural Earth 1:110m land, the whole globe (equirectangular texture);
//  - coast-10m-vn.json: Natural Earth 1:10m land clipped to REGION, painted on its own sphere patch (SPEC 3.3).
import * as THREE from 'three';
import world from '../data/generated/coast-110m.json';
import vn from '../data/generated/coast-10m-vn.json';
import { SCENE } from './colors';

type Rings = number[][];

/** The 10m region (degrees). Must match REGION in scripts/build-coast.mjs. */
export const REGION = vn.region as { west: number; east: number; south: number; north: number };

type Project = (lon: number, lat: number) => [number, number];

function drawRings(ctx: CanvasRenderingContext2D, rings: Rings, project: Project, fill: string, stroke: string, lineWidth: number): void {
  ctx.beginPath();
  for (const ring of rings) {
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

function grid(ctx: CanvasRenderingContext2D, project: Project, w: number, h: number, west: number, east: number, south: number, north: number, lineWidth: number): void {
  ctx.strokeStyle = SCENE.grid;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  for (let lon = Math.ceil(west / 10) * 10; lon <= east; lon += 10) {
    const [x] = project(lon, 0);
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
  }
  for (let lat = Math.ceil(south / 10) * 10; lat <= north; lat += 10) {
    const [, y] = project(0, lat);
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
  }
  ctx.stroke();
}

function canvasTexture(c: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Whole-globe texture, equirectangular, longitude -180 at u = 0 (matches THREE.SphereGeometry). */
export function worldTexture(): THREE.CanvasTexture {
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
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, SCENE.oceanTop);
  g.addColorStop(0.5, SCENE.oceanMid);
  g.addColorStop(1, SCENE.oceanTop);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  drawRings(ctx, world as Rings, project, SCENE.land, SCENE.coast, 1);
  ctx.fillStyle = SCENE.ice;
  ctx.fillRect(0, 0, w, h * 0.03);
  ctx.fillRect(0, h * 0.95, w, h * 0.05);
  grid(ctx, project, w, h, -180, 180, -80, 80, 1);
  return canvasTexture(c);
}

/**
 * Texture for the REGION patch, from 10m data. Its edges fade out over one degree, so the patch blends
 * into the 110m globe under it.
 */
export function regionTexture(): THREE.CanvasTexture {
  const { west, east, south, north } = REGION;
  const size = 2048;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  const sx = size / (east - west);
  const sy = size / (north - south);
  const pt: [number, number] = [0, 0];
  const project: Project = (lon, lat) => {
    pt[0] = (lon - west) * sx;
    pt[1] = (north - lat) * sy;
    return pt;
  };
  // The ocean gradient of the globe texture, sampled at the patch's latitudes.
  const g = ctx.createLinearGradient(0, 0, 0, size);
  g.addColorStop(0, lerpHex(SCENE.oceanMid, SCENE.oceanTop, Math.abs(north) / 90));
  g.addColorStop(1, lerpHex(SCENE.oceanMid, SCENE.oceanTop, Math.abs(south) / 90));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  drawRings(ctx, vn.rings as Rings, project, SCENE.land, SCENE.coast, 1.25);
  grid(ctx, project, size, size, west, east, south, north, 2);
  // Fade the edges to transparent.
  const fade = sx; // one degree
  ctx.globalCompositeOperation = 'destination-out';
  const edge = (x0: number, y0: number, x1: number, y1: number, rx: number, ry: number, rw: number, rh: number) => {
    const e = ctx.createLinearGradient(x0, y0, x1, y1);
    e.addColorStop(0, 'rgba(0,0,0,1)');
    e.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = e;
    ctx.fillRect(rx, ry, rw, rh);
  };
  edge(0, 0, fade, 0, 0, 0, fade, size);
  edge(size, 0, size - fade, 0, size - fade, 0, fade, size);
  edge(0, 0, 0, fade, 0, 0, size, fade);
  edge(0, size, 0, size - fade, 0, size - fade, size, fade);
  ctx.globalCompositeOperation = 'source-over';
  return canvasTexture(c);
}

/** Mix two #rrggbb colours (k in 0..1). */
function lerpHex(a: string, b: string, k: number): string {
  const t = Math.max(0, Math.min(1, k));
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  let out = '#';
  for (const shift of [16, 8, 0]) {
    const va = (pa >> shift) & 255;
    const vb = (pb >> shift) & 255;
    out += Math.round(va + (vb - va) * t)
      .toString(16)
      .padStart(2, '0');
  }
  return out;
}

/** Sphere patch geometry covering REGION, in the same frame as THREE.SphereGeometry and vec() in boot.ts. */
export function regionGeometry(radius: number): THREE.SphereGeometry {
  const RAD = Math.PI / 180;
  const { west, east, south, north } = REGION;
  return new THREE.SphereGeometry(radius, 96, 96, (west + 180) * RAD, (east - west) * RAD, (90 - north) * RAD, (north - south) * RAD);
}
