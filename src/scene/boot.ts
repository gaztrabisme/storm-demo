// The three.js globe behind the controller interface (scene/types.ts). Loaded lazily by scene/index.ts.
// Frame: unit sphere = Earth (6371 km); y is north, longitude 0 on +x, east towards -z.
import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { trackAt, type LatLon, type Radii } from '../storm/verdict';
import type { Mode } from '../state';
import type { CreateGlobe, GlobeController, GlobeInit } from './types';
import { regionGeometry, regionTexture, worldTexture } from './coast';
import { SCENE } from './colors';
import { startFrameLoop } from './frameLoop';
import { buildSatellite } from './satellite';
import './scene.css';

const RAD = Math.PI / 180;
const EARTH_KM = 6371;
const GEO_ALT_KM = 35786;
const SAT_LAT = 0;
const SAT_LON = 128.2;
const NM_KM = 1.852;
const QUADS: Array<keyof Radii> = ['ne', 'se', 'sw', 'nw'];

/** Flight durations (ms). SPEC 6.7 sets 3-5 s for the satellite flights. */
const FLY_PLACE_MS = 1600;
const FLY_SAT_MS = 4000;
const FLY_MODE_MS = 900;

/**
 * Camera for the satellite view: about 42,700 km from Earth's centre, just behind GK-2A and north-west of it,
 * far enough off its line of sight that the model is drawn clear of the Earth's edge.
 */
const SAT_CAM = { lat: 0.15, lon: 128.05, dist: 42700 / EARTH_KM };

/** Unit vector (times r) for (lat, lon). */
function vec(lat: number, lon: number, r = 1, out = new THREE.Vector3()): THREE.Vector3 {
  const c = Math.cos(lat * RAD);
  return out.set(c * Math.cos(lon * RAD) * r, Math.sin(lat * RAD) * r, -c * Math.sin(lon * RAD) * r);
}

/** Point at distance dKm and bearing brg (deg) from (lat, lon), on a great circle. */
function destination(lat: number, lon: number, brg: number, dKm: number): LatLon {
  const d = dKm / EARTH_KM;
  const p1 = lat * RAD;
  const l1 = lon * RAD;
  const b = brg * RAD;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return { lat: p2 / RAD, lon: l2 / RAD };
}

/** Camera looking at Earth's centre from (lat, lon) at dist Earth radii. */
interface Cam {
  lat: number;
  lon: number;
  dist: number;
}

const copyCam = (c: Cam): Cam => ({ lat: c.lat, lon: c.lon, dist: c.dist });

export const createGlobe: CreateGlobe = (init: GlobeInit): GlobeController => {
  const { container, track, nowMs } = init;
  let mode: Mode = init.mode;
  let timeMs = init.timeMs;
  let place: LatLon | null = null;
  let satView = false;
  let width = 1;
  let height = 1;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  const canvas = renderer.domElement;
  canvas.className = 'globe__canvas';
  container.prepend(canvas);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 100);
  scene.add(new THREE.AmbientLight(0xffffff, 1.4));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  vec(25, 150, 10, sun.position);
  scene.add(sun);

  // Earth: 110m coast on the whole globe, 10m coast on a patch over the Vietnam region (SPEC 3.3).
  const earthTex = worldTexture();
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(1, 128, 64), new THREE.MeshBasicMaterial({ map: earthTex })));
  const regionTex = regionTexture();
  scene.add(
    new THREE.Mesh(
      regionGeometry(1.0008),
      new THREE.MeshBasicMaterial({ map: regionTex, transparent: true, depthWrite: false }),
    ),
  );

  // Fat lines (constant pixel width). Their resolution follows the canvas size.
  const lineMats: LineMaterial[] = [];
  const lineMat = (color: number, linewidth: number, dashed = false): LineMaterial => {
    const m = new LineMaterial({ color, linewidth, dashed, dashSize: 0.012, gapSize: 0.008, transparent: true });
    lineMats.push(m);
    return m;
  };
  const lineOf = (pts: LatLon[], r: number, mat: LineMaterial, closed = false): Line2 => {
    const pos: number[] = [];
    const v = new THREE.Vector3();
    for (const p of pts) pos.push(...vec(p.lat, p.lon, r, v).toArray());
    if (closed && pts.length) pos.push(pos[0], pos[1], pos[2]);
    const g = new LineGeometry();
    g.setPositions(pos);
    const l = new Line2(g, mat);
    l.computeLineDistances();
    return l;
  };

  // Track (SPEC 4): points before now solid, after now dashed, joined at the position at now.
  const atNow = trackAt(track, nowMs);
  const past: LatLon[] = track.points.filter((p) => Date.parse(p.t) < nowMs).map((p) => ({ lat: p.lat, lon: p.lon }));
  const future: LatLon[] = track.points.filter((p) => Date.parse(p.t) > nowMs).map((p) => ({ lat: p.lat, lon: p.lon }));
  if (atNow) {
    past.push({ lat: atNow.lat, lon: atNow.lon });
    future.unshift({ lat: atNow.lat, lon: atNow.lon });
  }
  if (past.length > 1) scene.add(lineOf(past, 1.004, lineMat(SCENE.past, 3)));
  if (future.length > 1) scene.add(lineOf(future, 1.004, lineMat(SCENE.forecast, 3, true)));

  // Track uncertainty circles (SPEC 6.2): centred on the track at now + 24/48/72 h.
  for (const c of init.cone) {
    const ring: LatLon[] = [];
    for (let b = 0; b < 360; b += 4) ring.push(destination(c.lat, c.lon, b, c.radiusKm));
    scene.add(lineOf(ring, 1.005, lineMat(SCENE.cone, 2), true));
  }

  // Wind area of level 8 or more at the selected time: a fan built from the four quadrant radii.
  const SEG = 24; // vertices per quadrant
  const fanPos = new Float32Array((4 * SEG + 2) * 3);
  const fanGeo = new THREE.BufferGeometry();
  fanGeo.setAttribute('position', new THREE.BufferAttribute(fanPos, 3));
  const fanIdx: number[] = [];
  for (let i = 1; i <= 4 * SEG; i++) fanIdx.push(0, i, i + 1);
  fanGeo.setIndex(fanIdx);
  const fan = new THREE.Mesh(
    fanGeo,
    new THREE.MeshBasicMaterial({ color: SCENE.wind, transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false }),
  );
  scene.add(fan);
  const fanEdgeGeo = new THREE.BufferGeometry();
  const fanEdgePos = new Float32Array(4 * SEG * 3);
  fanEdgeGeo.setAttribute('position', new THREE.BufferAttribute(fanEdgePos, 3));
  const fanEdge = new THREE.LineLoop(fanEdgeGeo, new THREE.LineBasicMaterial({ color: SCENE.wind }));
  scene.add(fanEdge);

  // Storm position at the selected time, cached here so frames do not allocate.
  const stormWorld = new THREE.Vector3();
  let stormKnown = false;
  const tmp = new THREE.Vector3();
  function updateStorm(): void {
    const s = trackAt(track, timeMs);
    stormKnown = !!s;
    if (!s) {
      fan.visible = fanEdge.visible = false;
      return;
    }
    vec(s.lat, s.lon, 1.003, stormWorld);
    stormWorld.toArray(fanPos, 0);
    let k = 1;
    let any = false;
    for (let q = 0; q < 4; q++) {
      const r = (s.r34nm[QUADS[q]] ?? 0) * NM_KM;
      if (r > 0) any = true;
      for (let i = 0; i < SEG; i++) {
        const p = destination(s.lat, s.lon, q * 90 + (i * 90) / (SEG - 1), r);
        vec(p.lat, p.lon, 1.003, tmp);
        tmp.toArray(fanPos, k * 3);
        tmp.toArray(fanEdgePos, (k - 1) * 3);
        k++;
      }
    }
    for (let j = 0; j < 3; j++) fanPos[k * 3 + j] = fanPos[3 + j];
    fanGeo.attributes.position.needsUpdate = true;
    fanGeo.computeBoundingSphere();
    fanEdgeGeo.attributes.position.needsUpdate = true;
    fanEdgeGeo.computeBoundingSphere();
    fan.visible = fanEdge.visible = any;
  }

  // Province points and their names (full mode only).
  const provWorld = init.provinces.map((p) => vec(p.lat, p.lon, 1.002));
  const provGeo = new THREE.BufferGeometry();
  provGeo.setAttribute('position', new THREE.Float32BufferAttribute(provWorld.flatMap((v) => v.toArray()), 3));
  const dot = document.createElement('canvas');
  dot.width = dot.height = 32;
  {
    const d = dot.getContext('2d')!;
    d.fillStyle = SCENE.provinceRing;
    d.beginPath();
    d.arc(16, 16, 15, 0, Math.PI * 2);
    d.fill();
    d.fillStyle = SCENE.provinceDot;
    d.beginPath();
    d.arc(16, 16, 10, 0, Math.PI * 2);
    d.fill();
  }
  const dotTex = new THREE.CanvasTexture(dot);
  const provPoints = new THREE.Points(
    provGeo,
    new THREE.PointsMaterial({ size: 8, sizeAttenuation: false, map: dotTex, transparent: true, alphaTest: 0.4, depthWrite: false }),
  );
  scene.add(provPoints);

  const labelLayer = document.createElement('div');
  labelLayer.className = 'globe__labels';
  labelLayer.setAttribute('aria-hidden', 'true');
  container.append(labelLayer);
  const labels = init.provinces.map((p) => {
    const el = document.createElement('span');
    el.className = 'globe__label';
    el.textContent = p.name;
    el.hidden = true;
    labelLayer.append(el);
    return el;
  });
  const nLabels = labels.length;
  const labelW = new Float32Array(nLabels);
  const labelH = new Float32Array(nLabels);
  const labelX = new Float32Array(nLabels).fill(NaN);
  const labelY = new Float32Array(nLabels).fill(NaN);
  const labelOn = new Uint8Array(nLabels);
  let placed = new Float32Array((nLabels + 8) * 4);
  let labelsMeasured = false;
  function measureLabels(): void {
    labelLayer.hidden = false;
    for (let i = 0; i < nLabels; i++) labels[i].hidden = false;
    for (let i = 0; i < nLabels; i++) {
      labelW[i] = labels[i].offsetWidth;
      labelH[i] = labels[i].offsetHeight;
    }
    for (let i = 0; i < nLabels; i++) {
      labels[i].hidden = labelOn[i] === 0;
    }
    labelsMeasured = labelW[0] > 0;
  }

  // GK-2A at 0° N, 128.2° E, 35,786 km above the surface (SPEC 6.7).
  const satR = (EARTH_KM + GEO_ALT_KM) / EARTH_KM;
  const satWorld = vec(SAT_LAT, SAT_LON, satR);
  const sat = buildSatellite();
  sat.position.copy(satWorld);
  sat.lookAt(0, 0, 0);
  scene.add(sat);

  // DOM overlays the tests read (tests/README.md, "How the scripts read the page").
  const overlay = (test: string, cls: string, label: string) => {
    const el = document.createElement('div');
    el.dataset.test = test;
    el.className = `globe__overlay ${cls}`;
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', label);
    el.hidden = true;
    container.append(el);
    return el;
  };
  const stormEl = overlay('storm-marker', 'globe__storm', init.labels.storm);
  const pinEl = overlay('place-pin', 'globe__pin', init.labels.pin);
  const satEl = overlay('satellite-model', 'globe__sat', init.labels.satellite);
  // The place's name beside the pin, and "GK-2A" on a leader line pointing away from the Earth.
  const pinName = document.createElement('span');
  pinName.className = 'globe__pin-name';
  pinName.setAttribute('aria-hidden', 'true');
  pinEl.append(pinName);
  let pinNameW = -1;
  const satLead = document.createElement('span');
  satLead.className = 'globe__sat-lead';
  const satName = document.createElement('span');
  satName.className = 'globe__sat-name';
  satName.setAttribute('aria-hidden', 'true');
  satName.textContent = init.labels.satName;
  satEl.append(satLead, satName);
  let satDir = [NaN, NaN];

  // ---------------------------------------------------------------- What covers the globe
  /** Boxes (x0, y0, x1, y1, container pixels) of the init.covers elements that are shown over the canvas. */
  function coverBoxes(): number[][] {
    const els = init.covers?.() ?? [];
    if (!els.length) return [];
    const g = container.getBoundingClientRect();
    const out: number[][] = [];
    for (const el of els) {
      if (!el.isConnected) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const x0 = Math.max(0, r.left - g.left);
      const x1 = Math.min(width, r.right - g.left);
      const y0 = Math.max(0, r.top - g.top);
      const y1 = Math.min(height, r.bottom - g.top);
      if (x1 > x0 && y1 > y0) out.push([x0, y0, x1, y1]);
    }
    return out;
  }
  /** Heights covered at the top and at the bottom of the canvas, with a margin; they leave at least 40 % open. */
  function insets(): { top: number; bottom: number } {
    let top = 0;
    let bottom = 0;
    for (const [, y0, , y1] of coverBoxes()) {
      if ((y0 + y1) / 2 < height / 2) top = Math.max(top, y1 + 8);
      else bottom = Math.max(bottom, height - y0 + 8);
    }
    const max = height * 0.6;
    if (top + bottom > max) {
      const k = max / (top + bottom);
      top *= k;
      bottom *= k;
    }
    return { top, bottom };
  }

  // ---------------------------------------------------------------- Camera
  const tanHalfMin = () => {
    const v = Math.tan((camera.fov / 2) * RAD);
    return Math.min(v, v * camera.aspect);
  };
  /** Distance at which a cap of angular radius alpha (deg) fits the view. */
  const fitDist = (alphaDeg: number) => Math.max(1.3, Math.cos(alphaDeg * RAD) + Math.sin(alphaDeg * RAD) / tanHalfMin());
  /** Easy mode's locked view: Vietnam and the storm at now. */
  const homeCam = (): Cam => ({ lat: 15.5, lon: 108.5, dist: fitDist(13) });

  /**
   * Camera that shows a cap of angular radius halfDeg around (lat, lon) in the open band between the covers:
   * the distance fits the band's height, and the camera moves north or south so the cap's centre lands in
   * the middle of the band rather than the middle of the canvas.
   */
  function framed(lat: number, lon: number, halfDeg: number): Cam {
    const { top, bottom } = insets();
    const tanFov = Math.tan((camera.fov / 2) * RAD);
    const band = Math.max(1, height - top - bottom);
    const tanHalf = Math.min(tanFov * (band / height), tanFov * camera.aspect);
    const a = halfDeg * RAD;
    const dist = Math.max(1.3, Math.cos(a) + Math.sin(a) / tanHalf);
    // View angle (as a tangent) from the canvas centre down to the band centre; positive when the band sits low.
    const tv = ((top - bottom) / 2 / (height / 2)) * tanFov;
    // Surface angle phi seen at that view angle from distance d: tan(beta) = sin(phi) / (d - cos(phi)).
    const s = Math.max(-1, Math.min(1, (tv * dist) / Math.sqrt(1 + tv * tv)));
    const phi = (Math.asin(s) - Math.atan(tv)) / RAD;
    return { lat: Math.max(-85, Math.min(85, lat + phi)), lon, dist };
  }

  /** The smallest cap holding the place and the track from now on, as a camera. */
  function placeCam(p: LatLon): Cam {
    const pts: THREE.Vector3[] = [vec(p.lat, p.lon)];
    for (const f of future) pts.push(vec(f.lat, f.lon));
    const mid = new THREE.Vector3();
    for (const v of pts) mid.add(v);
    if (mid.lengthSq() < 1e-9) mid.copy(pts[0]);
    mid.normalize();
    let half = 0;
    for (const v of pts) half = Math.max(half, mid.angleTo(v) / RAD);
    return framed(Math.asin(mid.y) / RAD, Math.atan2(-mid.z, mid.x) / RAD, half + 3);
  }
  function stormCam(): Cam | null {
    const s = trackAt(track, timeMs);
    return s ? framed(s.lat, s.lon, 9) : null;
  }

  let cam: Cam = homeCam();
  let beforeSat: Cam | null = null;
  let userMoved = false;

  // Flight, after AstroSphere src/scene/flight/flightView.ts (step): smoothstep progress, distance changing
  // geometrically (log-linear), direction slerped, camera rotation slerped over the first third.
  const flight = {
    on: false,
    t0: 0,
    ms: 1,
    from: { lat: 0, lon: 0, dist: 1 } as Cam,
    to: { lat: 0, lon: 0, dist: 1 } as Cam,
    dir0: new THREE.Vector3(),
    dir1: new THREE.Vector3(),
    q0: new THREE.Quaternion(),
    done: null as null | (() => void),
  };
  const fDir = new THREE.Vector3();
  const qLook = new THREE.Quaternion();
  const mLook = new THREE.Matrix4();
  const ORIGIN = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);

  function fly(to: Cam, ms: number, done?: () => void): void {
    if (init.reducedMotion() || ms <= 0) {
      flight.on = false;
      cam = copyCam(to);
      done?.();
      loop.markDirty();
      return;
    }
    if (flight.on) settleFlight();
    flight.on = true;
    flight.t0 = performance.now();
    flight.ms = ms;
    flight.from = copyCam(cam);
    flight.to = copyCam(to);
    vec(cam.lat, cam.lon, 1, flight.dir0);
    vec(to.lat, to.lon, 1, flight.dir1);
    flight.q0.copy(camera.quaternion);
    flight.done = done ?? null;
    loop.markDirty();
  }

  /** Stop a flight where it is (user input, or a new flight starting). */
  function settleFlight(): void {
    if (!flight.on) return;
    flight.on = false;
    const d = camera.position.length();
    cam = { lat: Math.asin(camera.position.y / d) / RAD, lon: Math.atan2(-camera.position.z, camera.position.x) / RAD, dist: d };
  }

  function slerpDir(a: THREE.Vector3, b: THREE.Vector3, s: number, out: THREE.Vector3): THREE.Vector3 {
    const dot = Math.max(-1, Math.min(1, a.dot(b)));
    const om = Math.acos(dot);
    if (om < 1e-6) return out.copy(a);
    const so = Math.sin(om);
    const ka = Math.sin((1 - s) * om) / so;
    const kb = Math.sin(s * om) / so;
    return out.set(a.x * ka + b.x * kb, a.y * ka + b.y * kb, a.z * ka + b.z * kb).normalize();
  }

  function lookAtOrigin(q: THREE.Quaternion): void {
    mLook.lookAt(camera.position, ORIGIN, UP);
    q.setFromRotationMatrix(mLook);
  }

  /** Places the camera for this frame; true while a flight is in progress. */
  function placeCamera(now: number): boolean {
    if (flight.on) {
      const t = Math.min(1, Math.max(0, (now - flight.t0) / flight.ms));
      const s = t * t * (3 - 2 * t);
      const r = flight.from.dist * (flight.to.dist / flight.from.dist) ** s;
      slerpDir(flight.dir0, flight.dir1, s, fDir);
      camera.position.copy(fDir).multiplyScalar(r);
      lookAtOrigin(qLook);
      camera.quaternion.slerpQuaternions(flight.q0, qLook, Math.min(1, t * 3));
      if (t >= 1) {
        flight.on = false;
        cam = copyCam(flight.to);
        const done = flight.done;
        flight.done = null;
        done?.();
      } else return true;
    }
    vec(cam.lat, cam.lon, cam.dist, camera.position);
    lookAtOrigin(camera.quaternion);
    return false;
  }

  // ---------------------------------------------------------------- Overlays
  const proj = new THREE.Vector3();
  const toCam = new THREE.Vector3();
  const camDir = new THREE.Vector3();
  const last = { storm: [NaN, NaN], pin: [NaN, NaN], sat: [NaN, NaN] };

  /** Screen position of a world point, or false when it is hidden (behind the Earth, behind the camera, off the canvas). */
  function screen(world: THREE.Vector3, surface: boolean): boolean {
    toCam.copy(camera.position).sub(world);
    const front = surface ? world.dot(toCam) > 0 : toCam.dot(camDir) < 0;
    if (!front) return false;
    proj.copy(world).project(camera);
    if (proj.z >= 1) return false;
    proj.x = Math.round((proj.x * 0.5 + 0.5) * width * 2) / 2;
    proj.y = Math.round((-proj.y * 0.5 + 0.5) * height * 2) / 2;
    return proj.x >= 0 && proj.x <= width && proj.y >= 0 && proj.y <= height;
  }

  function placeOverlay(el: HTMLElement, world: THREE.Vector3 | null, surface: boolean, prev: number[]): void {
    const inside = !!world && screen(world, surface);
    if (el.hidden === inside) el.hidden = !inside;
    if (inside && (proj.x !== prev[0] || proj.y !== prev[1])) {
      prev[0] = proj.x;
      prev[1] = proj.y;
      el.style.transform = `translate(${proj.x}px, ${proj.y}px)`;
    }
  }

  const pinWorld = new THREE.Vector3();
  function updateOverlays(): void {
    camera.getWorldDirection(camDir);
    placeOverlay(stormEl, stormKnown && !satView ? stormWorld : null, true, last.storm);
    placeOverlay(pinEl, place && !satView ? pinWorld : null, true, last.pin);
    placeOverlay(satEl, satView ? satWorld : null, false, last.sat);
    if (!satEl.hidden) placeSatName();
    updateLabels();
  }

  /** Leader line and "GK-2A" on the side of the model that points away from the Earth on screen. */
  function placeSatName(): void {
    const sx = last.sat[0];
    const sy = last.sat[1];
    proj.set(0, 0, 0).project(camera);
    let ax = sx - (proj.x * 0.5 + 0.5) * width;
    let ay = sy - (-proj.y * 0.5 + 0.5) * height;
    const n = Math.hypot(ax, ay) || 1;
    ax /= n;
    ay /= n;
    const r0 = 34;
    const len = 26;
    const w = satName.offsetWidth;
    const h = satName.offsetHeight;
    // Away from the Earth first; if the name would leave the canvas, straight down or up instead.
    const sy0 = Math.sign(ay) || 1;
    let dx = ax;
    let dy = ay;
    let reach = 0;
    for (const [cx, cy] of [[ax, ay], [0, sy0], [0, -sy0], [-ax, ay]]) {
      reach = r0 + len + 4 + Math.abs(cx) * (w / 2) + Math.abs(cy) * (h / 2);
      const x = sx + cx * reach;
      const y = sy + cy * reach;
      dx = cx;
      dy = cy;
      if (x - w / 2 >= 4 && x + w / 2 <= width - 4 && y - h / 2 >= 4 && y + h / 2 <= height - 4) break;
    }
    if (Math.abs(dx - satDir[0]) < 0.01 && Math.abs(dy - satDir[1]) < 0.01) return;
    satDir = [dx, dy];
    satLead.style.width = `${len}px`;
    satLead.style.transform = `translate(${32 + dx * r0}px, ${32 + dy * r0}px) rotate(${Math.atan2(dy, dx)}rad)`;
    satName.style.transform = `translate(${32 + dx * reach - w / 2}px, ${32 + dy * reach - h / 2}px)`;
  }

  /** Province names in full mode. A label that would overlap one already placed is left out. */
  function updateLabels(): void {
    const show = provPoints.visible;
    if (labelLayer.hidden === show) labelLayer.hidden = !show;
    if (!show) return;
    if (!labelsMeasured) measureLabels();
    // Boxes a name may not overlap: the pin with its name, the storm marker, and what covers the globe.
    let n = 0;
    const occupy = (x0: number, y0: number, x1: number, y1: number) => {
      const o = n * 4;
      placed[o] = x0;
      placed[o + 1] = y0;
      placed[o + 2] = x1;
      placed[o + 3] = y1;
      n++;
    };
    const fixed = coverBoxes();
    if (placed.length < (nLabels + fixed.length + 2) * 4) placed = new Float32Array((nLabels + fixed.length + 2) * 4);
    for (const [x0, y0, x1, y1] of fixed) occupy(x0, y0, x1, y1);
    if (!pinEl.hidden) {
      if (pinNameW < 0) pinNameW = pinName.textContent ? pinName.offsetWidth : 0;
      occupy(last.pin[0] - 14, last.pin[1] - 32, last.pin[0] + 14 + pinNameW, last.pin[1] + 2);
    }
    if (!stormEl.hidden) occupy(last.storm[0] - 16, last.storm[1] - 16, last.storm[0] + 16, last.storm[1] + 16);
    for (let i = 0; i < nLabels; i++) {
      let on = screen(provWorld[i], true);
      const x = proj.x + 7;
      const y = proj.y - labelH[i] / 2;
      if (on && (x + labelW[i] > width || y < 0 || y + labelH[i] > height)) on = false;
      if (on) {
        for (let j = 0; j < n; j++) {
          const o = j * 4;
          if (x < placed[o + 2] && x + labelW[i] > placed[o] && y < placed[o + 3] && y + labelH[i] > placed[o + 1]) {
            on = false;
            break;
          }
        }
      }
      if (on) occupy(x - 2, y - 1, x + labelW[i] + 2, y + labelH[i] + 1);
      const el = labels[i];
      if ((labelOn[i] === 1) !== on) {
        labelOn[i] = on ? 1 : 0;
        el.hidden = !on;
      }
      if (on && (x !== labelX[i] || y !== labelY[i])) {
        labelX[i] = x;
        labelY[i] = y;
        el.style.transform = `translate(${x}px, ${y}px)`;
      }
    }
  }

  // ---------------------------------------------------------------- Frames
  let readyResolve: () => void = () => {};
  const ready = new Promise<void>((r) => (readyResolve = r));
  let drawn = false;
  const readyCbs: Array<() => void> = [];

  const loop = startFrameLoop((now) => {
    const moving = placeCamera(now);
    provPoints.visible = mode === 'full' && !satView;
    renderer.render(scene, camera);
    updateOverlays();
    if (!drawn) {
      drawn = true;
      readyResolve();
      for (const cb of readyCbs.splice(0)) cb();
    }
    return moving;
  });

  function resize(): void {
    width = Math.max(1, container.clientWidth);
    height = Math.max(1, container.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    for (const m of lineMats) m.resolution.set(width, height);
    if (!userMoved && !flight.on && !satView) cam = place ? placeCam(place) : homeCam();
    labelsMeasured = false;
    pinNameW = -1;
    satDir = [NaN, NaN];
    loop.markDirty();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  // ---------------------------------------------------------------- Input: full mode only (SPEC 6.2)
  const pointers = new Map<number, { x: number; y: number }>();
  let pinch = 0;
  const canInput = () => mode === 'full' && !satView;
  const MIN_DIST = 1.12;
  const MAX_DIST = 6;
  const zoom = (f: number) => {
    cam.dist = Math.max(MIN_DIST, Math.min(MAX_DIST, 1 + (cam.dist - 1) * f));
  };
  const onDown = (e: PointerEvent) => {
    if (!canInput()) return;
    canvas.setPointerCapture?.(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = Math.hypot(a.x - b.x, a.y - b.y);
    }
  };
  const onMove = (e: PointerEvent) => {
    const p = pointers.get(e.pointerId);
    if (!p || !canInput()) return;
    settleFlight();
    if (pointers.size === 1) {
      // Degrees per pixel so the surface under the pointer roughly follows it.
      const k = ((cam.dist - 1) * 2 * Math.tan((camera.fov / 2) * RAD)) / height / RAD;
      cam.lon -= (e.clientX - p.x) * k;
      cam.lat = Math.max(-80, Math.min(80, cam.lat + (e.clientY - p.y) * k));
    }
    p.x = e.clientX;
    p.y = e.clientY;
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch > 0 && d > 0) zoom(pinch / d);
      pinch = d;
    }
    userMoved = true;
    loop.markDirty();
  };
  const onUp = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    pinch = 0;
  };
  const onWheel = (e: WheelEvent) => {
    if (!canInput()) return;
    e.preventDefault();
    settleFlight();
    zoom(Math.exp(e.deltaY * 0.0015));
    userMoved = true;
    loop.markDirty();
  };
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  const applyMode = () => {
    container.classList.toggle('globe--interactive', mode === 'full');
  };
  applyMode();
  updateStorm();

  return {
    ready,
    onReady(cb) {
      if (drawn) cb();
      else readyCbs.push(cb);
    },
    setMode(m) {
      if (m === mode) return;
      mode = m;
      applyMode();
      pointers.clear();
      if (m === 'easy' && !satView) {
        userMoved = false;
        fly(place ? placeCam(place) : homeCam(), FLY_MODE_MS);
      }
      loop.markDirty();
    },
    setTime(ms) {
      if (ms === timeMs) return;
      timeMs = ms;
      updateStorm();
      loop.markDirty();
    },
    flyToPlace(p) {
      place = p ? { lat: p.lat, lon: p.lon } : null;
      if (p) vec(p.lat, p.lon, 1.003, pinWorld);
      pinName.textContent = p?.label ?? '';
      pinNameW = -1;
      userMoved = false;
      if (satView) {
        loop.markDirty();
        return;
      }
      fly(p ? placeCam(p) : homeCam(), FLY_PLACE_MS);
    },
    flyToStorm() {
      const c = stormCam();
      if (!c || satView) return;
      fly(c, FLY_PLACE_MS);
    },
    showSatellite() {
      if (satView) return;
      beforeSat = copyCam(flight.on ? flight.to : cam);
      satView = true;
      pointers.clear();
      fly(SAT_CAM, FLY_SAT_MS);
    },
    back() {
      if (!satView) return;
      satView = false;
      fly(beforeSat ?? homeCam(), FLY_SAT_MS);
      beforeSat = null;
    },
    dispose() {
      ro.disconnect();
      loop.dispose();
      renderer.dispose();
      earthTex.dispose();
      regionTex.dispose();
      dotTex.dispose();
      canvas.remove();
      stormEl.remove();
      pinEl.remove();
      satEl.remove();
      labelLayer.remove();
    },
  };
};
