// Minimal three.js globe behind the controller interface (scene/types.ts).
// The Globe stage replaces these internals; the interface and the DOM overlays stay.
import * as THREE from 'three';
import { trackAt, type LatLon, type Radii } from '../storm/verdict';
import type { Mode } from '../state';
import type { CreateGlobe, GlobeController, GlobeInit } from './types';

const RAD = Math.PI / 180;
const EARTH_KM = 6371;
const GEO_ALT_KM = 35786;
const SAT_LON = 128.2;
const NM_KM = 1.852;

/** Unit vector for (lat, lon); y is north, longitude 0 on +x, east towards -z. */
function vec(lat: number, lon: number, r = 1, out = new THREE.Vector3()): THREE.Vector3 {
  const c = Math.cos(lat * RAD);
  return out.set(c * Math.cos(lon * RAD) * r, Math.sin(lat * RAD) * r, -c * Math.sin(lon * RAD) * r);
}

/** Point at distance dKm and bearing brg from (lat, lon), great circle. */
function destination(lat: number, lon: number, brg: number, dKm: number): LatLon {
  const d = dKm / EARTH_KM;
  const p1 = lat * RAD;
  const l1 = lon * RAD;
  const b = brg * RAD;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return { lat: p2 / RAD, lon: l2 / RAD };
}

interface Cam {
  lat: number;
  lon: number;
  dist: number;
  target: THREE.Vector3;
}

const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);

const COLORS = {
  ocean: 0x1b4a72,
  grid: 0x5d86ab,
  past: 0xffffff,
  forecast: 0xffd27a,
  cone: 0xffb066,
  wind: 0xff5a36,
  sat: 0xd8dde3,
  panel: 0x2f5fa8,
};

export const createGlobe: CreateGlobe = (init: GlobeInit): GlobeController => {
  const { container, track, nowMs } = init;
  let mode: Mode = init.mode;
  let timeMs = init.timeMs;
  let place: LatLon | null = null;
  let satView = false;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  const canvas = renderer.domElement;
  canvas.className = 'globe__canvas';
  container.prepend(canvas);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 100);

  // Earth and graticule.
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(1, 96, 64), new THREE.MeshBasicMaterial({ color: COLORS.ocean })));
  {
    const pts: number[] = [];
    const v = new THREE.Vector3();
    const w = new THREE.Vector3();
    for (let lat = -80; lat <= 80; lat += 10)
      for (let lon = 0; lon < 360; lon += 2) {
        vec(lat, lon, 1.001, v);
        vec(lat, lon + 2, 1.001, w);
        pts.push(v.x, v.y, v.z, w.x, w.y, w.z);
      }
    for (let lon = 0; lon < 360; lon += 10)
      for (let lat = -90; lat < 90; lat += 2) {
        vec(lat, lon, 1.001, v);
        vec(lat + 2, lon, 1.001, w);
        pts.push(v.x, v.y, v.z, w.x, w.y, w.z);
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    scene.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: COLORS.grid, transparent: true, opacity: 0.55 })));
  }

  // Track: past solid, forecast dashed (SPEC 4).
  const line = (latlons: LatLon[], r: number) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(latlons.flatMap((p) => vec(p.lat, p.lon, r).toArray()), 3));
    return g;
  };
  const past = track.points.filter((p) => Date.parse(p.t) <= nowMs);
  const future = track.points.filter((p) => Date.parse(p.t) >= nowMs);
  scene.add(new THREE.Line(line(past, 1.004), new THREE.LineBasicMaterial({ color: COLORS.past })));
  const dashed = new THREE.Line(line(future, 1.004), new THREE.LineDashedMaterial({ color: COLORS.forecast, dashSize: 0.008, gapSize: 0.006 }));
  dashed.computeLineDistances();
  scene.add(dashed);

  // Uncertainty circles (SPEC 6.2).
  for (const c of init.cone) {
    const ring: LatLon[] = [];
    for (let b = 0; b <= 360; b += 6) ring.push(destination(c.lat, c.lon, b, c.radiusKm));
    scene.add(new THREE.Line(line(ring, 1.005), new THREE.LineBasicMaterial({ color: COLORS.cone })));
  }

  // Wind area at the selected time: a fan with the four quadrant radii.
  const SEG = 24; // per quadrant
  const fanPos = new Float32Array((4 * SEG + 2) * 3);
  const fanGeo = new THREE.BufferGeometry();
  fanGeo.setAttribute('position', new THREE.BufferAttribute(fanPos, 3));
  const idx: number[] = [];
  for (let i = 1; i <= 4 * SEG; i++) idx.push(0, i, i + 1);
  fanGeo.setIndex(idx);
  const fan = new THREE.Mesh(fanGeo, new THREE.MeshBasicMaterial({ color: COLORS.wind, transparent: true, opacity: 0.38, side: THREE.DoubleSide, depthWrite: false }));
  scene.add(fan);
  const tmp = new THREE.Vector3();
  function updateFan(): void {
    const s = trackAt(track, timeMs);
    if (!s) {
      fan.visible = false;
      return;
    }
    const quads: Array<keyof Radii> = ['ne', 'se', 'sw', 'nw'];
    vec(s.lat, s.lon, 1.003, tmp).toArray(fanPos, 0);
    let k = 1;
    for (let q = 0; q < 4; q++) {
      const r = (s.r34nm[quads[q]] ?? 0) * NM_KM;
      for (let i = 0; i < SEG; i++) {
        const p = destination(s.lat, s.lon, q * 90 + (i * 90) / (SEG - 1), r);
        vec(p.lat, p.lon, 1.003, tmp).toArray(fanPos, k * 3);
        k++;
      }
    }
    for (let j = 0; j < 3; j++) fanPos[k * 3 + j] = fanPos[3 + j];
    fanGeo.attributes.position.needsUpdate = true;
    fanGeo.computeBoundingSphere();
    fan.visible = true;
  }

  // GK-2A, low-poly and not to scale (SPEC 6.7).
  const satR = (EARTH_KM + GEO_ALT_KM) / EARTH_KM;
  const satPos = vec(0, SAT_LON, satR);
  const sat = new THREE.Group();
  {
    const metal = new THREE.MeshBasicMaterial({ color: COLORS.sat });
    const panel = new THREE.MeshBasicMaterial({ color: COLORS.panel });
    const s = 0.02;
    sat.add(new THREE.Mesh(new THREE.BoxGeometry(s, s, s), metal));
    const wing = new THREE.Mesh(new THREE.BoxGeometry(s * 3.2, s * 0.08, s * 1.1), panel);
    wing.position.x = s * 2.2;
    sat.add(wing);
    const dish = new THREE.Mesh(new THREE.ConeGeometry(s * 0.45, s * 0.35, 16, 1, true), metal);
    dish.position.y = s * 0.7;
    sat.add(dish);
    for (const [x, z] of [[-0.35, 0.35], [0.3, -0.4]]) {
      const box = new THREE.Mesh(new THREE.BoxGeometry(s * 0.35, s * 0.3, s * 0.35), metal);
      box.position.set(x * s, -s * 0.62, z * s);
      sat.add(box);
    }
    sat.position.copy(satPos);
    sat.lookAt(0, 0, 0);
  }
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

  // Camera.
  const tanHalfMin = () => {
    const v = Math.tan((camera.fov / 2) * RAD);
    return Math.min(v, v * camera.aspect);
  };
  /** Distance at which a cap of angular radius alpha (deg) fits the view. */
  const fitDist = (alphaDeg: number) => Math.max(1.45, Math.cos(alphaDeg * RAD) + Math.sin(alphaDeg * RAD) / tanHalfMin());
  const homeCam = (): Cam => ({ lat: 16.5, lon: 109.5, dist: fitDist(11), target: new THREE.Vector3() });
  let cam: Cam = homeCam();
  let beforeSat: Cam | null = null;
  let flight: { from: Cam; to: Cam; t0: number; ms: number; done?: () => void } | null = null;
  let userMoved = false;

  function applyCam(c: Cam): void {
    vec(c.lat, c.lon, c.dist, camera.position);
    camera.up.set(0, 1, 0);
    camera.lookAt(c.target);
  }

  const copyCam = (c: Cam): Cam => ({ lat: c.lat, lon: c.lon, dist: c.dist, target: c.target.clone() });

  function fly(to: Cam, ms: number, done?: () => void): void {
    if (init.reducedMotion() || ms <= 0) {
      flight = null;
      cam = copyCam(to);
      done?.();
      markDirty();
      return;
    }
    flight = { from: copyCam(cam), to: copyCam(to), t0: performance.now(), ms, done };
    markDirty();
  }

  function stepFlight(now: number): void {
    if (!flight) return;
    const x = Math.min(1, (now - flight.t0) / flight.ms);
    const e = easeInOut(x);
    const { from, to } = flight;
    let dLon = to.lon - from.lon;
    dLon = ((dLon + 540) % 360) - 180;
    cam.lat = from.lat + (to.lat - from.lat) * e;
    cam.lon = from.lon + dLon * e;
    cam.dist = Math.exp(Math.log(from.dist) + (Math.log(to.dist) - Math.log(from.dist)) * e);
    cam.target.copy(from.target).lerp(to.target, e);
    if (x >= 1) {
      const done = flight.done;
      flight = null;
      cam = copyCam(to);
      done?.();
    }
  }

  function placeCam(p: LatLon): Cam {
    const s = trackAt(track, nowMs);
    const a = vec(p.lat, p.lon);
    const b = s ? vec(s.lat, s.lon) : a.clone();
    const mid = a.clone().add(b);
    if (mid.lengthSq() < 1e-9) mid.copy(a);
    mid.normalize();
    const half = a.angleTo(b) / RAD / 2;
    const lat = Math.asin(mid.y) / RAD;
    const lon = Math.atan2(-mid.z, mid.x) / RAD;
    return { lat, lon, dist: fitDist(half + 5), target: new THREE.Vector3() };
  }

  // Overlays follow the projected 3D points.
  const proj = new THREE.Vector3();
  const toCam = new THREE.Vector3();
  function placeOverlay(el: HTMLElement, world: THREE.Vector3 | null, surface: boolean): void {
    if (!world) {
      el.hidden = true;
      return;
    }
    toCam.copy(camera.position).sub(world);
    const front = surface ? world.dot(toCam) > 0 : toCam.dot(camera.getWorldDirection(proj)) < 0;
    proj.copy(world).project(camera);
    const w = container.clientWidth;
    const h = container.clientHeight;
    const x = (proj.x * 0.5 + 0.5) * w;
    const y = (-proj.y * 0.5 + 0.5) * h;
    const inside = front && proj.z < 1 && x >= 0 && x <= w && y >= 0 && y <= h;
    el.hidden = !inside;
    if (inside) el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
  }
  const stormWorld = new THREE.Vector3();
  const pinWorld = new THREE.Vector3();
  function updateOverlays(): void {
    const s = trackAt(track, timeMs);
    placeOverlay(stormEl, s && !satView ? vec(s.lat, s.lon, 1.003, stormWorld) : null, true);
    placeOverlay(pinEl, place && !satView ? vec(place.lat, place.lon, 1.003, pinWorld) : null, true);
    placeOverlay(satEl, satView ? satPos : null, false);
  }

  // Render on demand; never while the tab is hidden (SPEC 2).
  let raf = 0;
  let readyResolve: () => void = () => {};
  const ready = new Promise<void>((r) => (readyResolve = r));
  let drawn = false;
  const readyCbs: Array<() => void> = [];

  function frame(now: number): void {
    raf = 0;
    if (document.hidden) return;
    stepFlight(now);
    applyCam(cam);
    renderer.render(scene, camera);
    updateOverlays();
    if (!drawn) {
      drawn = true;
      readyResolve();
      for (const cb of readyCbs.splice(0)) cb();
    }
    if (flight) raf = requestAnimationFrame(frame);
  }
  function markDirty(): void {
    if (!raf && !document.hidden) raf = requestAnimationFrame(frame);
  }
  const onVisibility = () => {
    if (document.hidden) {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    } else markDirty();
  };
  document.addEventListener('visibilitychange', onVisibility);

  function resize(): void {
    const w = Math.max(1, container.clientWidth);
    const h = Math.max(1, container.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if (!userMoved && !flight && !satView && !place) cam = homeCam();
    markDirty();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  // Input: full mode only (SPEC 6.2).
  const pointers = new Map<number, { x: number; y: number }>();
  let pinch = 0;
  const canInput = () => mode === 'full' && !satView;
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
    if (pointers.size === 1) {
      const k = (0.25 * (cam.dist - 1)) / Math.max(1, container.clientHeight / 400);
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
    flight = null;
    userMoved = true;
    markDirty();
  };
  const onUp = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    pinch = 0;
  };
  const zoom = (f: number) => {
    cam.dist = Math.max(1.15, Math.min(8, 1 + (cam.dist - 1) * f));
  };
  const onWheel = (e: WheelEvent) => {
    if (!canInput()) return;
    e.preventDefault();
    zoom(Math.exp(e.deltaY * 0.0015));
    flight = null;
    userMoved = true;
    markDirty();
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
  updateFan();

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
      if (m === 'easy' && !satView) {
        userMoved = false;
        fly(place ? placeCam(place) : homeCam(), 900);
      }
      markDirty();
    },
    setTime(ms) {
      timeMs = ms;
      updateFan();
      markDirty();
    },
    flyToPlace(p) {
      place = p ? { lat: p.lat, lon: p.lon } : null;
      if (satView) return markDirty();
      fly(p ? placeCam(p) : homeCam(), 1200);
    },
    flyToStorm() {
      const s = trackAt(track, timeMs);
      if (!s || satView) return;
      fly({ lat: s.lat, lon: s.lon, dist: fitDist(12), target: new THREE.Vector3() }, 1200);
    },
    showSatellite() {
      if (satView) return;
      beforeSat = copyCam(flight ? flight.to : cam);
      satView = true;
      // About 43,800 km from the centre, just behind and north of the satellite, looking at the Earth.
      fly({ lat: 0.6, lon: SAT_LON, dist: satR + 0.25, target: new THREE.Vector3() }, 3800);
    },
    back() {
      if (!satView) return;
      satView = false;
      fly(beforeSat ?? homeCam(), 1500);
      beforeSat = null;
    },
    dispose() {
      ro.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      if (raf) cancelAnimationFrame(raf);
      renderer.dispose();
      canvas.remove();
      stormEl.remove();
      pinEl.remove();
      satEl.remove();
    },
  };
};
