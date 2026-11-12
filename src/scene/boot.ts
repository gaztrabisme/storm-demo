// The three.js globe behind the controller interface (scene/types.ts). Loaded lazily by scene/index.ts.
// Frame: unit sphere = Earth (6371 km); y is north, longitude 0 on +x, east towards -z.
import * as THREE from 'three';
import { timeline, trackAt, type LatLon, type Step } from '../storm/verdict';
import type { Mode } from '../state';
import type { CreateGlobe, GlobeController, GlobeInit } from './types';
import { createChart } from './chart';
import { CHART_AREA, chartAreaTexture, landMask, patchGeometry, regionGeometry, regionTexture, worldTexture } from './coast';
import { EARTH } from './colors';
import { startFrameLoop } from './frameLoop';
import { buildSatellite } from './satellite';
import './scene.css';

const RAD = Math.PI / 180;
const EARTH_KM = 6371;
const GEO_ALT_KM = 35786;
const SAT_LAT = 0;
const SAT_LON = 128.2;

/** Satellite flight duration (ms), out and back. SPEC 6.7 sets 0.8-1.2 s; the map itself never moves (SPEC 6.2). */
const FLY_SAT_MS = 900;

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
  const basePixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(basePixelRatio);
  /**
   * The satellite flights (1 s) draw their fast part at half resolution, so a slow device keeps up with the
   * frames; the full resolution comes back for the slow end of the flight.
   */
  function flightResolution(on: boolean): void {
    const r = on ? basePixelRatio / 2 : basePixelRatio;
    if (renderer.getPixelRatio() === r) return;
    renderer.setPixelRatio(r);
    renderer.setSize(width, height, false);
  }
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
  const textures: Partial<Record<Ground, { world: THREE.CanvasTexture; area: THREE.CanvasTexture; region: THREE.CanvasTexture }>> = {};
  const texturesFor = (g: Ground) => (textures[g] ??= { world: worldTexture(EARTH[g]), area: chartAreaTexture(EARTH[g]), region: regionTexture(EARTH[g]) });
  const earthMat = new THREE.MeshBasicMaterial();
  const areaMat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false });
  const regionMat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(1, 128, 64), earthMat));
  const areaMesh = new THREE.Mesh(patchGeometry(1.0004, CHART_AREA), areaMat);
  areaMesh.renderOrder = 1;
  scene.add(areaMesh);
  const regionMesh = new THREE.Mesh(regionGeometry(1.0008), regionMat);
  regionMesh.renderOrder = 2;
  scene.add(regionMesh);
  const themeGround = (): Ground => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
  let ground: Ground | null = null;
  function applyGround(): void {
    const g: Ground = themeGround();
    if (g === ground) return;
    ground = g;
    const tx = texturesFor(g);
    earthMat.map = tx.world;
    areaMat.map = tx.area;
    regionMat.map = tx.region;
    earthMat.needsUpdate = areaMat.needsUpdate = regionMat.needsUpdate = true;
    markDirty();
  }
  let markDirty = (): void => {};
  const themeObserver = new MutationObserver(() => applyGround());
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });


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
  // Each province: a small square mark at its point (no track glyph is square) and its name beside it. Both
  // show together or not at all, so the map never carries a dot without a name (DESIGN 2: context recedes).
  const marks: HTMLElement[] = [];
  const labels = init.provinces.map((p) => {
    const mark = document.createElement('span');
    mark.className = 'globe__prov';
    mark.hidden = true;
    const el = document.createElement('span');
    el.className = 'globe__label';
    el.textContent = p.name;
    mark.append(el);
    labelLayer.append(mark);
    marks.push(mark);
    return el;
  });
  /** Placing order: the provinces the panel lists first (wind reaches them, earliest first), then the rest. */
  const idIndex = new Map(init.provinces.map((p, i) => [p.id, i]));
  const labelOrder = timeline(init.provinces, track, nowMs).map((r) => idIndex.get(r.id)!);
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
    for (let i = 0; i < nLabels; i++) marks[i].hidden = false;
    for (let i = 0; i < nLabels; i++) {
      labelW[i] = labels[i].offsetWidth;
      labelH[i] = labels[i].offsetHeight;
    }
    for (let i = 0; i < nLabels; i++) {
      marks[i].hidden = labelOn[i] === 0;
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
  /** Boxes (x0, y0, x1, y1, container pixels) of the given elements where they are shown over the canvas. */
  function coverBoxes(els: Element[] = init.covers?.() ?? []): number[][] {
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
  /**
   * The fixed map view (SPEC 6.2): the whole track and all of Vietnam, fitted to the current layout from the data.
   * It is worked out again only when the layout changes (a resize, or the key's height on a desktop); a check, a
   * mode change or the time slider never move it.
   */
  const homeCam = (): Cam => trackCam();

  const fitCamera = new THREE.PerspectiveCamera(40, 1, 0.01, 100);
  const fv = new THREE.Vector3();
  const fd = new THREE.Vector3();
  /** Surface point under screen position (x, y) for fitCamera, or null. */
  function fitPick(x: number, y: number): LatLon | null {
    fd.set((x / width) * 2 - 1, -(y / height) * 2 + 1, 0.5).unproject(fitCamera).sub(fitCamera.position).normalize();
    const b = fitCamera.position.dot(fd);
    const c = fitCamera.position.lengthSq() - 1;
    const disc = b * b - c;
    if (disc < 0) return null;
    fv.copy(fitCamera.position).addScaledVector(fd, -b - Math.sqrt(disc));
    return { lat: Math.asin(Math.max(-1, Math.min(1, fv.y))) / RAD, lon: Math.atan2(-fv.z, fv.x) / RAD };
  }

  /**
   * Camera that fits the points inside the screen box [x0, y0, x1, y1]: a few rounds of moving the view centre
   * so the points' screen box is centred in the target, and scaling the distance by how much it overflows.
   */
  function fitPoints(pts: LatLon[], box: number[]): Cam {
    let lat0 = Infinity;
    let lat1 = -Infinity;
    let lon0 = Infinity;
    let lon1 = -Infinity;
    for (const p of pts) {
      lat0 = Math.min(lat0, p.lat);
      lat1 = Math.max(lat1, p.lat);
      lon0 = Math.min(lon0, p.lon);
      lon1 = Math.max(lon1, p.lon);
    }
    const c: Cam = { lat: (lat0 + lat1) / 2, lon: (lon0 + lon1) / 2, dist: fitDist(Math.max(lat1 - lat0, lon1 - lon0) / 2 + 2) };
    fitCamera.fov = camera.fov;
    fitCamera.aspect = camera.aspect;
    fitCamera.updateProjectionMatrix();
    const [bx0, by0, bx1, by1] = box;
    for (let it = 0; it < 12; it++) {
      vec(c.lat, c.lon, c.dist, fitCamera.position);
      fitCamera.lookAt(0, 0, 0);
      fitCamera.updateMatrixWorld();
      let sx0 = Infinity;
      let sy0 = Infinity;
      let sx1 = -Infinity;
      let sy1 = -Infinity;
      for (const p of pts) {
        vec(p.lat, p.lon, 1, fv).project(fitCamera);
        const x = (fv.x * 0.5 + 0.5) * width;
        const y = (-fv.y * 0.5 + 0.5) * height;
        sx0 = Math.min(sx0, x);
        sx1 = Math.max(sx1, x);
        sy0 = Math.min(sy0, y);
        sy1 = Math.max(sy1, y);
      }
      const k = Math.max((sx1 - sx0) / Math.max(1, bx1 - bx0), (sy1 - sy0) / Math.max(1, by1 - by0));
      const dx = (sx0 + sx1) / 2 - (bx0 + bx1) / 2;
      const dy = (sy0 + sy1) / 2 - (by0 + by1) / 2;
      const to = fitPick(width / 2 + dx, height / 2 + dy);
      if (to) {
        c.lat = Math.max(-80, Math.min(80, to.lat));
        c.lon = to.lon;
      }
      c.dist = Math.max(1.05, Math.min(6, 1 + (c.dist - 1) * k));
      if (Math.abs(k - 1) < 0.005 && Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) break;
    }
    return c;
  }

  const wideView = () => width >= 600 && width > height;
  /** Vietnam's mainland, north and south ends (it frames the view with the track). */
  const VIETNAM: LatLon[] = [
    { lat: 23.4, lon: 105.3 },
    { lat: 8.6, lon: 104.8 },
    { lat: 12.6, lon: 109.5 },
    { lat: 22.5, lon: 102.1 },
  ];
  function trackCam(): Cam {
    const wide = wideView();
    const pts: LatLon[] = track.points.map((q) => ({ lat: q.lat, lon: q.lon }));
    pts.push(...VIETNAM);
    const { top, bottom } = insets();
    const box = wide ? [56, top + 30, width - 28, height - bottom - 30] : [34, top + 22, width - 14, height - bottom - 30];
    return fitPoints(pts, box);
  }

  /** The fixed map view for the current layout; the satellite trip returns to it. */
  let home: Cam = homeCam();
  let cam: Cam = copyCam(home);
  /** The layout changed while the satellite view was open: the map view is worked out again on the way back. */
  let homeStale = false;

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
      flightResolution(false);
      cam = copyCam(to);
      done?.();
      loop.markDirty();
      return;
    }
    if (flight.on) settleFlight();
    flight.on = true;
    flightResolution(true);
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
    flightResolution(false);
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
      // Full resolution again for the slow last fifth of the flight, so the landing is sharp.
      flightResolution(t < 0.8);
      const r = flight.from.dist * (flight.to.dist / flight.from.dist) ** s;
      slerpDir(flight.dir0, flight.dir1, s, fDir);
      camera.position.copy(fDir).multiplyScalar(r);
      lookAtOrigin(qLook);
      camera.quaternion.slerpQuaternions(flight.q0, qLook, Math.min(1, t * 3));
      if (t >= 1) {
        flight.on = false;
        flightResolution(false);
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
    earth(out) {
      proj.set(0, 0, 0).project(camera);
      out[0] = (proj.x * 0.5 + 0.5) * width;
      out[1] = (-proj.y * 0.5 + 0.5) * height;
      const d = camera.position.length();
      out[2] = d > 1 ? (Math.tan(Math.asin(1 / d)) / Math.tan((camera.fov / 2) * RAD)) * (height / 2) : 0;
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

  let metricsKey = '';
  function updateChart(settled: boolean): void {
    const blocked = coverBoxes([...(init.covers?.() ?? []), ...(init.avoid?.() ?? [])]);
    if (!stormEl.hidden) blocked.push([last.storm[0] - 13, last.storm[1] - 13, last.storm[0] + 13, last.storm[1] + 13]);
    if (!pinEl.hidden) blocked.push([last.pin[0] - 9, last.pin[1] - 9, last.pin[0] + 9, last.pin[1] + 9]);
    chart.update({
      width,
      height,
      satView,
      returning: flight.on && !satView,
      full: mode === 'full',
      settled,
      dist: camera.position.length(),
      timeMs,
      storm,
      place,
      blocked,
    });
    if (settled && !satView) {
      const m = chart.metrics();
      const key = `${m.scale.toFixed(2)}|${m.pxPerKm.toFixed(3)}`;
      if (key !== metricsKey && m.pxPerKm > 0) {
        metricsKey = key;
        init.onMetrics?.(m);
      }
    }
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
    const free = (x: number, y: number, w: number, hh: number): boolean => {
      if (x < 2 || y < 0 || x + w > width - 2 || y + hh > height) return false;
      for (let j = 0; j < n; j++) {
        const o = j * 4;
        if (x < placed[o + 2] && x + w > placed[o] && y < placed[o + 3] && y + hh > placed[o + 1]) return false;
      }
      return true;
    };
    for (const i of labelOrder) {
      let on = screen(provWorld[i], true);
      const w = labelW[i];
      const hh = labelH[i];
      let x = NaN;
      let y = NaN;
      const px = proj.x;
      const py = proj.y;
      if (on) {
        // Right of the mark, then left, above, below; a name that would touch the track, a 70 % circle, a
        // date or a note is left out with its mark (the panel lists every province).
        on = false;
        for (const [cx, cy] of [
          [px + 6, py - hh / 2],
          [px - 6 - w, py - hh / 2],
          [px - w / 2, py - hh - 3],
          [px - w / 2, py + 3],
        ]) {
          if (free(cx, cy, w, hh) && free(px - 3, py - 3, 6, 6)) {
            x = cx;
            y = cy;
            on = true;
            break;
          }
        }
      }
      if (on) {
        occupy(x - 2, y - 1, x + w + 2, y + hh + 1);
        occupy(px - 3, py - 3, px + 3, py + 3);
      }
      const mark = marks[i];
      if ((labelOn[i] === 1) !== on) {
        labelOn[i] = on ? 1 : 0;
        mark.hidden = !on;
      }
      if (on && (x !== labelX[i] || y !== labelY[i])) {
        labelX[i] = x;
        labelY[i] = y;
        mark.style.transform = `translate(${px}px, ${py}px)`;
        labels[i].style.transform = `translate(${x - px}px, ${y - py}px)`;
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
  // Compile every material now, the satellite model's included, so the first flight out does not stall on it.
  renderer.compile(scene, camera);

  /** Works the fixed map view out again for a new layout; while the satellite view is open, only marks it stale. */
  function reframe(): void {
    if (satView) {
      homeStale = true;
      return;
    }
    home = homeCam();
    if (!flight.on) cam = copyCam(home);
    else {
      flight.to = copyCam(home);
      vec(home.lat, home.lon, 1, flight.dir1);
    }
    loop.markDirty();
  }

  function resize(): void {
    width = Math.max(1, container.clientWidth);
    height = Math.max(1, container.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    reframe();
    labelsMeasured = false;
    pinNameW = -1;
    satDir = [NaN, NaN];
    loop.markDirty();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();
  // The key's height follows the map scale; when it changes, the home framing is worked out again around it.
  let frameH = -1;
  const frameRo = new ResizeObserver(() => {
    const h = init.frameAround ? Math.round(init.frameAround.getBoundingClientRect().height) : 0;
    if (Math.abs(h - frameH) < 3) return;
    frameH = h;
    reframe();
  });
  if (init.frameAround) frameRo.observe(init.frameAround);

  // No input on the map (SPEC 6.2): no drag, no wheel or pinch zoom. The globe's touch-action is none (styles.css),
  // so a pinch over it does not zoom the page either.
  // The `where` chip's highlight on the storm marker (SPEC 6.4), cleared after a while.
  let highlightTimer = 0;
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
      loop.markDirty();
    },
    setTime(ms) {
      if (ms === timeMs) return;
      timeMs = ms;
      updateStorm();
      loop.markDirty();
    },
    setPlace(p) {
      place = p ? { lat: p.lat, lon: p.lon, label: p.label } : null;
      if (p) vec(p.lat, p.lon, 1.003, pinWorld);
      pinName.textContent = p?.label ?? '';
      // The pin's name for screen readers and the tests: the place's label ("Vị trí của bạn" for the own location).
      pinEl.setAttribute('aria-label', p?.label || init.labels.pin);
      pinNameW = -1;
      loop.markDirty();
    },
    highlightStorm() {
      window.clearTimeout(highlightTimer);
      stormEl.classList.add('globe__storm--hi');
      highlightTimer = window.setTimeout(() => stormEl.classList.remove('globe__storm--hi'), 4000);
    },
    showSatellite() {
      if (satView) return;
      satView = true;
      fly(SAT_CAM, FLY_SAT_MS);
    },
    back() {
      if (!satView) return;
      satView = false;
      if (homeStale) {
        homeStale = false;
        home = homeCam();
      }
      fly(home, FLY_SAT_MS);
    },
    dispose() {
      window.clearTimeout(highlightTimer);
      ro.disconnect();
      frameRo.disconnect();
      loop.dispose();
      renderer.dispose();
      themeObserver.disconnect();
      for (const tx of Object.values(textures)) {
        tx?.world.dispose();
        tx?.area.dispose();
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
