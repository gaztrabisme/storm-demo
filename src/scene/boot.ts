// The three.js globe behind the controller interface (scene/types.ts). Loaded lazily by scene/index.ts.
// Frame: unit sphere = Earth (6371 km); y is north, longitude 0 on +x, east towards -z.
import * as THREE from 'three';
import { trackAt, type LatLon, type Step } from '../storm/verdict';
import type { Mode } from '../state';
import type { CreateGlobe, GlobeController, GlobeInit } from './types';
import { createChart } from './chart';
import { landMask, regionGeometry, regionTexture, worldTexture } from './coast';
import { EARTH } from './colors';
import { startFrameLoop } from './frameLoop';
import { buildSatellite } from './satellite';
import './scene.css';

const RAD = Math.PI / 180;
const EARTH_KM = 6371;
const GEO_ALT_KM = 35786;
const SAT_LAT = 0;
const SAT_LON = 128.2;

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
  let place: (LatLon & { label?: string }) | null = null;
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

  // Earth: 110m coast on the whole globe, 10m coast on a patch over the Vietnam region (SPEC 3.3), painted as
  // a paper chart (light theme) or a night screen (dark theme). Each set is painted once, when first needed.
  type Ground = 'light' | 'dark';
  const textures: Partial<Record<Ground, { world: THREE.CanvasTexture; region: THREE.CanvasTexture }>> = {};
  const texturesFor = (g: Ground) => (textures[g] ??= { world: worldTexture(EARTH[g]), region: regionTexture(EARTH[g]) });
  const earthMat = new THREE.MeshBasicMaterial();
  const regionMat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(1, 128, 64), earthMat));
  scene.add(new THREE.Mesh(regionGeometry(1.0008), regionMat));
  const themeGround = (): Ground => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
  let ground: Ground | null = null;
  function applyGround(): void {
    const g: Ground = themeGround();
    if (g === ground) return;
    ground = g;
    const tx = texturesFor(g);
    earthMat.map = tx.world;
    regionMat.map = tx.region;
    earthMat.needsUpdate = regionMat.needsUpdate = true;
    markDirty();
  }
  let markDirty = (): void => {};
  const themeObserver = new MutationObserver(() => applyGround());
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  // Track positions from now on (the camera frames them with the place).
  const future: LatLon[] = track.points.filter((p) => Date.parse(p.t) > nowMs).map((p) => ({ lat: p.lat, lon: p.lon }));
  const atNow = trackAt(track, nowMs);
  if (atNow) future.unshift({ lat: atNow.lat, lon: atNow.lon });

  // Storm at the selected time.
  let storm: Step | null = null;
  const stormWorld = new THREE.Vector3();
  function updateStorm(): void {
    storm = trackAt(track, timeMs);
    if (storm) vec(storm.lat, storm.lon, 1.003, stormWorld);
  }

  // Province names (full mode).
  const provWorld = init.provinces.map((p) => vec(p.lat, p.lon, 1.002));

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
    placeOverlay(stormEl, storm && !satView ? stormWorld : null, true, last.storm);
    placeOverlay(pinEl, place && !satView ? pinWorld : null, true, last.pin);
    placeOverlay(satEl, satView ? satWorld : null, false, last.sat);
    if (!satEl.hidden) placeSatName();
  }

  // ---------------------------------------------------------------- Chart over the globe (scene/chart.ts)
  const cv = new THREE.Vector3();
  const cdir = new THREE.Vector3();
  const isLand = landMask();
  const chart = createChart({
    container,
    track,
    nowMs,
    cone: init.cone,
    provinces: init.provinces,
    surface(lat, lon, out) {
      vec(lat, lon, 1, cv);
      // Front side: the camera sees the outside of the sphere at this point.
      if (cv.x * (camera.position.x - cv.x) + cv.y * (camera.position.y - cv.y) + cv.z * (camera.position.z - cv.z) <= 0) return false;
      cv.project(camera);
      if (cv.z >= 1) return false;
      out[0] = (cv.x * 0.5 + 0.5) * width;
      out[1] = (-cv.y * 0.5 + 0.5) * height;
      return true;
    },
    orbit(lon, out) {
      vec(0, lon, satR, cv);
      // Hidden when the line from the camera to the point passes through the Earth.
      cdir.copy(cv).sub(camera.position);
      const L = cdir.length();
      cdir.divideScalar(L);
      const b = camera.position.dot(cdir);
      const c = camera.position.lengthSq() - 1;
      const disc = b * b - c;
      if (disc > 0) {
        const t0 = -b - Math.sqrt(disc);
        if (t0 > 0 && t0 < L) return false;
      }
      cv.project(camera);
      if (cv.z >= 1 || cv.z <= -1) return false;
      out[0] = (cv.x * 0.5 + 0.5) * width;
      out[1] = (-cv.y * 0.5 + 0.5) * height;
      return true;
    },
    pick(x, y) {
      cdir.set((x / width) * 2 - 1, -(y / height) * 2 + 1, 0.5).unproject(camera).sub(camera.position).normalize();
      const b = camera.position.dot(cdir);
      const c = camera.position.lengthSq() - 1;
      const disc = b * b - c;
      if (disc < 0) return null;
      const tHit = -b - Math.sqrt(disc);
      if (tHit < 0) return null;
      cv.copy(camera.position).addScaledVector(cdir, tHit);
      return { lat: Math.asin(Math.max(-1, Math.min(1, cv.y))) / RAD, lon: Math.atan2(-cv.z, cv.x) / RAD };
    },
    isLand,
  });

  function updateChart(settled: boolean): void {
    const blocked = coverBoxes();
    if (!stormEl.hidden) blocked.push([last.storm[0] - 13, last.storm[1] - 13, last.storm[0] + 13, last.storm[1] + 13]);
    if (!pinEl.hidden) blocked.push([last.pin[0] - 9, last.pin[1] - 9, last.pin[0] + 9, last.pin[1] + 9]);
    chart.update({
      width,
      height,
      satView,
      full: mode === 'full',
      settled,
      dist: camera.position.length(),
      timeMs,
      storm,
      place,
      blocked,
    });
    const named = chart.placeNoted();
    if (pinName.hidden !== named) {
      pinName.hidden = named;
      pinNameW = -1;
    }
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
    const show = mode === 'full' && !satView;
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
    const fixed = chart.boxes();
    if (placed.length < (nLabels + fixed.length + 2) * 4) placed = new Float32Array((nLabels + fixed.length + 2) * 4);
    for (const [x0, y0, x1, y1] of fixed) occupy(x0, y0, x1, y1);
    if (!pinEl.hidden) {
      if (pinNameW < 0) pinNameW = pinName.textContent && !pinName.hidden ? pinName.offsetWidth : 0;
      occupy(last.pin[0] - 10, last.pin[1] - 12, last.pin[0] + 14 + pinNameW, last.pin[1] + 12);
    }
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
    renderer.render(scene, camera);
    updateOverlays();
    updateChart(!moving);
    updateLabels();
    if (!drawn) {
      drawn = true;
      readyResolve();
      for (const cb of readyCbs.splice(0)) cb();
    }
    return moving;
  });
  markDirty = () => loop.markDirty();
  applyGround();

  function resize(): void {
    width = Math.max(1, container.clientWidth);
    height = Math.max(1, container.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
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
      place = p ? { lat: p.lat, lon: p.lon, label: p.label } : null;
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
      themeObserver.disconnect();
      for (const tx of Object.values(textures)) {
        tx?.world.dispose();
        tx?.region.dispose();
      }
      chart.dispose();
      canvas.remove();
      stormEl.remove();
      pinEl.remove();
      satEl.remove();
      labelLayer.remove();
    },
  };
};
