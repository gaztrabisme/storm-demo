// The three.js globe behind the controller interface (scene/types.ts). Loaded lazily by scene/index.ts.
// Frame: unit sphere = Earth (6371 km); y is north, longitude 0 on +x, east towards -z.
import * as THREE from 'three';
import { timeline, trackAt, type LatLon, type Step } from '../storm/verdict';
import type { Mode } from '../state';
import type { CreateGlobe, GlobeController, GlobeInit } from './types';
import { createChart } from './chart';
import { CHART_AREA, chartAreaTexture, landMask, patchGeometry, regionGeometry, regionTexture, worldTexture } from './coast';
import { EARTH, SCENE } from './colors';
import { startFrameLoop } from './frameLoop';
import { createHud, PART_ORDER, type HudFrame } from './hud';
import { buildSatellite, SAT_SIZE } from './satellite';
import './scene.css';

const RAD = Math.PI / 180;
const EARTH_KM = 6371;
const GEO_ALT_KM = 35786;
const SAT_LAT = 0;
const SAT_LON = 128.2;

/** Satellite flight duration (ms), out and back. SPEC 6.7 sets 0.8-1.2 s. */
const FLY_SAT_MS = 820;

/**
 * The movable map (SPEC 6.2): the region is the zoom-1 view, and a zoomed view shows a part of that same picture,
 * so nothing outside the region can come into view. Zoom 1 to 4; a wheel notch of 100 px multiplies it by
 * WHEEL_K ** 100, a key press by KEY_ZOOM; an arrow key pans by KEY_PAN of the visible width or height.
 * btn-map-reset returns to zoom 1 in RESET_MS (a cut under reduced motion).
 */
const MAP_ZOOM_MAX = 4;
const WHEEL_K = 0.002;
const KEY_ZOOM = 1.5;
const KEY_PAN = 0.15;
const RESET_MS = 280;
/** The share of the satellite trip over which a zoomed view widens back to the whole region on the way out. */
const TRIP_UNZOOM = 0.3;
/**
 * Field of view (deg) on the map and in the close-up. The map's is narrow, so the camera stands far off and the
 * region reads nearly as a flat chart: a degree near its edges is drawn about as long as one at its centre.
 */
const MAP_FOV = 16;
const SAT_FOV = 40;

/**
 * The satellite close-up (SPEC 6.7): the camera orbits the model. yaw turns about the model's north axis (0 is
 * straight behind it, on the side away from the Earth, so the Earth is a disc behind the model), pitch raises the
 * camera towards north. The arrival angle shows the model a little from the side, the Earth's disc beside it.
 */
const YAW0 = 0.3;
const PITCH0 = 0.12;
const PITCH_MAX = 1.2;
/** Zoom is the camera distance as a share of the arrival distance (SPEC 6.7: 0.6x to 2x). */
const ZOOM_MIN = 0.6;
const ZOOM_MAX = 2;
/** The model's larger side on screen at arrival, as a share of the view's shorter side ("about half"). */
const ARRIVAL_FILL = 0.5;
/**
 * The slow automatic turn, in radians per second; the pause after arrival or after input before it starts (ms); and
 * the time it takes to reach full speed once it starts (ms), so the landing settles before the model begins to turn.
 */
const AUTO_TURN = 1 * (Math.PI / 180);
const AUTO_PAUSE_MS = 1000;
const AUTO_EASE_MS = 1500;
const AUTO_FRAME_MS = 100;
/** Drag and key steps (radians per pixel, radians per key press). */
const DRAG_RAD = 0.005;
const KEY_YAW = 0.1;
const KEY_PITCH = 0.08;
/**
 * How dim the Earth is in the satellite view: the texture colour multiplier (linear light). Both themes end as the
 * night screen's dim disc on space (the light theme's paper colours turn into the night ones on the way out).
 */
const EARTH_DIM = { light: 0.8, dark: 0.8 } as const;

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
   * The satellite flights draw at half resolution, so a slow device keeps up with the frames; the full
   * resolution comes back for the slow end of the flight out, and on landing on the way back.
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
  const camera = new THREE.PerspectiveCamera(MAP_FOV, 1, 0.01, 100);
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
  // The satellite view has a dark ground in both themes (DESIGN 5). In the light theme the paper Earth turns into
  // the night screen's colours on the way out: the shader maps each texel's brightness from the paper palette
  // (coast ink, land, sea) onto the night palette, by uNight from 0 (paper) to 1 (night).
  const lum = (hex: string) => {
    const c = new THREE.Color(hex);
    return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  };
  const nightUniforms = {
    uNight: { value: 0 },
    uCoast: { value: lum(EARTH.light.coast) },
    uLand: { value: lum(EARTH.light.land) },
    uSea: { value: lum(EARTH.light.sea) },
    uCoastN: { value: new THREE.Color(EARTH.dark.coast) },
    uLandN: { value: new THREE.Color(EARTH.dark.land) },
    uSeaN: { value: new THREE.Color(EARTH.dark.sea) },
  };
  const toNight = (sh: THREE.WebGLProgramParametersWithUniforms): void => {
    Object.assign(sh.uniforms, nightUniforms);
    sh.fragmentShader = sh.fragmentShader
      .replace('void main() {', 'uniform float uNight, uCoast, uLand, uSea;\nuniform vec3 uCoastN, uLandN, uSeaN;\nvoid main() {')
      .replace(
        '#include <map_fragment>',
        `#ifdef USE_MAP
  vec4 sampledDiffuseColor = texture2D( map, vMapUv );
  float lum = dot( sampledDiffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
  vec3 nightC = lum < uLand
    ? mix( uCoastN, uLandN, clamp( ( lum - uCoast ) / ( uLand - uCoast ), 0.0, 1.0 ) )
    : mix( uLandN, uSeaN, clamp( ( lum - uLand ) / ( uSea - uLand ), 0.0, 1.0 ) );
  sampledDiffuseColor.rgb = mix( sampledDiffuseColor.rgb, nightC, uNight );
  diffuseColor *= sampledDiffuseColor;
#endif`,
      );
  };
  // The 10 m coast patches over the region turn with it, so no paper patch shows on the way out.
  earthMat.onBeforeCompile = areaMat.onBeforeCompile = regionMat.onBeforeCompile = toNight;
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
    dimK = -1;
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
    if (storm) vec(storm.lat, storm.lon, 1, stormWorld);
  }

  // Province names (full mode).
  const provWorld = init.provinces.map((p) => vec(p.lat, p.lon, 1));

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
  const satModel = buildSatellite();
  const sat = satModel.group;
  sat.position.copy(satWorld);
  sat.lookAt(0, 0, 0);
  scene.add(sat);
  sat.updateMatrixWorld(true);
  // The satellite never moves, so its points, part anchors and face normals are kept in world space.
  const satPts = satModel.points.slice();
  {
    const v = new THREE.Vector3();
    for (let i = 0; i < satPts.length; i += 3) {
      v.set(satPts[i], satPts[i + 1], satPts[i + 2]).applyMatrix4(sat.matrixWorld);
      satPts[i] = v.x;
      satPts[i + 1] = v.y;
      satPts[i + 2] = v.z;
    }
  }
  // The geostationary orbit through the model (DESIGN 5), as dots of one screen size at one screen spacing, in the
  // scene so the Earth hides its far side. The dots are laid out again for each camera pose: each step along the
  // circle is the angle that moves the dot ORBIT_GAP px on screen there, so the line stays dotted where it runs
  // toward the camera. Dots less than 0.7 of the model's depth in front of the camera are left out, so the circle
  // never folds round the camera at the edge of the view.
  const ORBIT_MAX = 6000;
  const ORBIT_GAP = 8;
  const orbitPos = new Float32Array(ORBIT_MAX * 3);
  const orbitAttr = new THREE.BufferAttribute(orbitPos, 3).setUsage(THREE.DynamicDrawUsage);
  const orbitDots = (() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', orbitAttr);
    geo.setDrawRange(0, 0);
    // Round dots: a small disc as the point sprite.
    const dot = document.createElement('canvas');
    dot.width = dot.height = 16;
    const g2 = dot.getContext('2d');
    if (g2) {
      g2.fillStyle = '#fff';
      g2.beginPath();
      g2.arc(8, 8, 7, 0, Math.PI * 2);
      g2.fill();
    }
    const mat = new THREE.PointsMaterial({ color: SCENE.satInk, map: new THREE.CanvasTexture(dot), size: 2 * basePixelRatio, sizeAttenuation: false, transparent: true, opacity: 0.8, alphaTest: 0.3, depthWrite: false });
    const pts = new THREE.Points(geo, mat);
    pts.visible = false;
    pts.frustumCulled = false;
    scene.add(pts);
    return pts;
  })();
  const ov = new THREE.Vector3();
  const ot = new THREE.Vector3();
  let orbitKey = '';
  function layoutOrbit(): void {
    camera.updateMatrixWorld();
    const m = camera.matrixWorldInverse.elements;
    const key = `${m.join(',')}|${width}|${height}`;
    if (key === orbitKey) return;
    orbitKey = key;
    const f = height / 2 / Math.tan((camera.fov * RAD) / 2);
    const minDepth = 0.7 * camera.position.distanceTo(satCenter);
    const lon0 = SAT_LON * RAD;
    // In the close-up, a branch also ends where its dots on screen have turned back by more than 70 degrees in one
    // run across the view: past that bend the circle only curls back round the camera.
    const closeUp = trip === 1;
    let count = 0;
    for (const sgn of [1, -1]) {
      let a = 0;
      let px = NaN;
      let py = NaN;
      let pdx = NaN;
      let pdy = NaN;
      let turned = 0;
      for (let it = 0; it < 20000 && Math.abs(a) < Math.PI && count < ORBIT_MAX; it++) {
        const c = Math.cos(lon0 + a);
        const sn = Math.sin(lon0 + a);
        ov.set(c * satR, 0, -sn * satR);
        ot.set(-sn, 0, -c);
        ov.applyMatrix4(camera.matrixWorldInverse);
        ot.transformDirection(camera.matrixWorldInverse).multiplyScalar(satR);
        const depth = -ov.z;
        let step = 0.004;
        let inView = false;
        if (depth > camera.near) {
          // Screen speed (px per radian) of the point along the circle.
          const dsx = (f * (ot.x * depth + ov.x * ot.z)) / (depth * depth);
          const dsy = (f * (ot.y * depth + ov.y * ot.z)) / (depth * depth);
          const speed = Math.hypot(dsx, dsy);
          // The step is a power-of-two share of 0.02 rad and the dots sit on whole multiples of it, so as the camera
          // turns they stay at the same places on the circle and slide with it instead of shimmering.
          const want = Math.min(0.02, Math.max(2e-6, ORBIT_GAP / Math.max(speed, 1e-6)));
          step = 0.02 / 2 ** Math.ceil(Math.log2(0.02 / want));
          const sx = (f * ov.x) / depth;
          const sy = (f * ov.y) / depth;
          inView = Math.abs(sx) < width / 2 + 10 && Math.abs(sy) < height / 2 + 10;
          if (inView) {
            if (closeUp && !Number.isNaN(px)) {
              const dx = sx - px;
              const dy = sy - py;
              if (!Number.isNaN(pdx)) turned += Math.atan2(pdx * dy - pdy * dx, pdx * dx + pdy * dy);
              pdx = dx;
              pdy = dy;
              if (Math.abs(turned) > 1.22) break;
            }
            px = sx;
            py = sy;
            if (depth >= minDepth) {
              orbitPos[count * 3] = c * satR;
              orbitPos[count * 3 + 1] = 0;
              orbitPos[count * 3 + 2] = -sn * satR;
              count++;
            }
          } else step = Math.min(0.02, step * 4);
        } else if (closeUp) break;
        if (!inView) {
          px = py = pdx = pdy = NaN;
          turned = 0;
        }
        a = sgn > 0 ? (Math.floor(a / step + 1e-9) + 1) * step : (Math.ceil(a / step - 1e-9) - 1) * step;
      }
    }
    orbitAttr.needsUpdate = true;
    orbitAttr.clearUpdateRanges();
    orbitAttr.addUpdateRange(0, count * 3);
    orbitDots.geometry.setDrawRange(0, count);
  }
  /** The middle of the model's extent: the close-up camera looks at it and turns round it. */
  const satCenter = new THREE.Vector3();
  {
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < satPts.length; i++) {
      lo[i % 3] = Math.min(lo[i % 3], satPts[i]);
      hi[i % 3] = Math.max(hi[i % 3], satPts[i]);
    }
    satCenter.set((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2);
  }
  const satParts = PART_ORDER.map((k) => satModel.parts.find((x) => x.key === k)!);
  const partWorld = satParts.map((p) => {
    // The eight corners of the part's extent, in world space (for its box on screen).
    const corners: THREE.Vector3[] = [];
    for (let i = 0; i < 8; i++) {
      const e = p.extent;
      corners.push(new THREE.Vector3(i & 1 ? e.max.x : e.min.x, i & 2 ? e.max.y : e.min.y, i & 4 ? e.max.z : e.min.z).applyMatrix4(sat.matrixWorld));
    }
    return { anchor: p.anchor.clone().applyMatrix4(sat.matrixWorld), corners };
  });
  const satInv = sat.matrixWorld.clone().invert();
  /** True when the segment from a to b (group frame) passes through the box. */
  function segHitsBox(a: THREE.Vector3, b: THREE.Vector3, bx: { min: THREE.Vector3; max: THREE.Vector3 }): boolean {
    let t0 = 0;
    let t1 = 1;
    for (const ax of ['x', 'y', 'z'] as const) {
      const d = b[ax] - a[ax];
      const lo = bx.min[ax];
      const hi = bx.max[ax];
      if (Math.abs(d) < 1e-12) {
        if (a[ax] < lo || a[ax] > hi) return false;
        continue;
      }
      let u0 = (lo - a[ax]) / d;
      let u1 = (hi - a[ax]) / d;
      if (u0 > u1) [u0, u1] = [u1, u0];
      t0 = Math.max(t0, u0);
      t1 = Math.min(t1, u1);
      if (t0 > t1) return false;
    }
    return true;
  }
  const camLocal = new THREE.Vector3();
  const rayFrom = new THREE.Vector3();
  const toCamL = new THREE.Vector3();
  /**
   * Whether the camera sees part i's anchor: one of its faces turned more than about 10 degrees from edge-on
   * toward the camera (either side for the dish), and no solid box of another part between the anchor and the camera.
   */
  function partSeen(i: number): boolean {
    const p = satParts[i];
    toCamL.copy(camLocal).sub(p.anchor);
    const len = toCamL.length();
    if (!(len > 0)) return false;
    toCamL.divideScalar(len);
    if (p.normals.length) {
      let best = -Infinity;
      for (const n of p.normals) best = Math.max(best, p.twoSided ? Math.abs(n.dot(toCamL)) : n.dot(toCamL));
      if (best <= 0.17) return false;
    }
    rayFrom.copy(p.anchor).addScaledVector(toCamL, 1e-3 * SAT_SIZE);
    for (let k = 0; k < satModel.solids.length; k++) {
      if (p.own.includes(k)) continue;
      if (segHitsBox(rayFrom, camLocal, satModel.solids[k])) return false;
    }
    return true;
  }

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
  // The place's name beside the pin.
  const pinName = document.createElement('span');
  pinName.className = 'globe__pin-name';
  pinName.setAttribute('aria-hidden', 'true');
  pinEl.append(pinName);
  let pinNameW = -1;
  // btn-map-reset (SPEC 6.2): shown while the map is zoomed in; placed in a corner clear of the demo label, the key,
  // the storm marker and the pin.
  const resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.className = 'btn globe__reset';
  resetBtn.dataset.test = 'btn-map-reset';
  resetBtn.textContent = init.labels.reset;
  resetBtn.hidden = true;
  container.append(resetBtn);
  const resetPos = new Float32Array(2).fill(NaN);
  let resetW = 0;
  let resetH = 0;
  // The close-up's HUD and [satellite], the view that takes focus for the arrow keys.
  const hud = createHud(container, init.labels.hud, init.labels.satellite);

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
    const v = Math.tan((MAP_FOV / 2) * RAD);
    return Math.min(v, v * camera.aspect);
  };
  /** Distance at which a cap of angular radius alpha (deg) fits the view. */
  const fitDist = (alphaDeg: number) => Math.max(1.3, Math.cos(alphaDeg * RAD) + Math.sin(alphaDeg * RAD) / tanHalfMin());
  /**
   * The region (SPEC 6.2): the whole track and all of Vietnam, fitted to the current layout from the data; the map
   * at zoom 1. It is worked out again only when the layout changes (a resize, or the key's height on a desktop); a
   * check, a mode change or the time slider never move it.
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
    fitCamera.fov = MAP_FOV;
    fitCamera.aspect = camera.aspect;
    fitCamera.near = 0.01;
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
      c.dist = Math.max(1.05, Math.min(40, 1 + (c.dist - 1) * k));
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

  /** The region's camera for the current layout. */
  let home: Cam = homeCam();
  /** The canvas size home was fitted for: the satellite trip returns to the same home unless the size changed. */
  let homeW = width;
  let homeH = height;
  /** The layout changed while the satellite view was open: the region is worked out again on the way back. */
  let homeStale = false;

  // ---------------------------------------------------------------- The movable map (SPEC 6.2)
  /**
   * The view inside the region: zoom (1-4) and the centre of the visible part as a share of the zoom-1 picture's
   * width and height. The visible part is width/zoom by height/zoom and always lies inside the picture.
   */
  const view = { zoom: 1, cx: 0.5, cy: 0.5 };
  const reset = { on: false, t0: 0, z0: 1, cx0: 0.5, cy0: 0.5 };
  function clampView(): void {
    view.zoom = Math.min(MAP_ZOOM_MAX, Math.max(1, view.zoom));
    const h = 0.5 / view.zoom;
    view.cx = Math.min(1 - h, Math.max(h, view.cx));
    view.cy = Math.min(1 - h, Math.max(h, view.cy));
    clampDegrees();
  }
  /**
   * The region is also a box in degrees: its centre is the zoom-1 view centre, and its half-size is half the picture
   * over the screen scale (px per degree) at that centre. On the globe, meridians converge northward, so near the
   * picture's corners the screen box alone would let the view centre go further in longitude (or latitude) than this
   * box. The view centre is kept inside both: within half-size × (1 - 1/zoom) of the region centre on each axis.
   */
  let boxKey = '';
  let box = { lat: 0, lon: 0, hLat: 0, hLon: 0 };
  function degreeBox(): typeof box {
    const key = `${home.lat}|${home.lon}|${home.dist}|${width}|${height}`;
    if (key === boxKey) return box;
    boxKey = key;
    const c = surfaceAt(1, 0.5, 0.5);
    box = { lat: c.lat, lon: c.lon, hLat: Infinity, hLon: Infinity };
    if (!Number.isFinite(c.lat)) return box;
    viewCamera.clearViewOffset();
    viewCamera.updateProjectionMatrix();
    viewCamera.updateMatrixWorld();
    const p0 = vec(c.lat, c.lon, 1, new THREE.Vector3()).project(viewCamera);
    const pe = vec(c.lat, c.lon + 1, 1, new THREE.Vector3()).project(viewCamera);
    const pn = vec(c.lat + 1, c.lon, 1, new THREE.Vector3()).project(viewCamera);
    const pxLon = Math.abs(pe.x - p0.x) * 0.5 * width;
    const pxLat = Math.abs(pn.y - p0.y) * 0.5 * height;
    if (pxLon > 1e-6) box.hLon = width / 2 / pxLon;
    if (pxLat > 1e-6) box.hLat = height / 2 / pxLat;
    mvKey = '';
    return box;
  }
  /** Pulls cx (axis 'x', limits longitude) or cy (axis 'y', latitude) toward the middle until the centre is in the box. */
  function pullIn(axis: 'x' | 'y'): void {
    const b = degreeBox();
    const k = 1 - 1 / view.zoom;
    const lim = axis === 'x' ? b.hLon * k : b.hLat * k;
    if (!Number.isFinite(lim)) return;
    const off = (cx: number, cy: number): number => {
      const v = surfaceAt(view.zoom, cx, cy);
      return axis === 'x' ? Math.abs(v.lon - b.lon) : Math.abs(v.lat - b.lat);
    };
    const cur = axis === 'x' ? view.cx : view.cy;
    const at = (t: number): number => (axis === 'x' ? off(t, view.cy) : off(view.cx, t));
    const r = at(cur);
    if (!(r > lim)) return;
    let ok = 0.5;
    let bad = cur;
    for (let i = 0; i < 40; i++) {
      const m = (ok + bad) / 2;
      if (at(m) > lim) bad = m;
      else ok = m;
    }
    if (axis === 'x') view.cx = ok;
    else view.cy = ok;
  }
  function clampDegrees(): void {
    if (view.zoom <= 1) return;
    for (let pass = 0; pass < 2; pass++) {
      pullIn('y');
      pullIn('x');
    }
  }
  /** Logs and redraws after an input moved the view; nothing when it did not move. */
  function viewMoved(z: number, cx: number, cy: number): void {
    // The degree clamp lands on its limit by bisection: a push against the edge that ends within 1e-9 of where the
    // view was is no move.
    if (z === view.zoom && Math.abs(cx - view.cx) < 1e-9 && Math.abs(cy - view.cy) < 1e-9) {
      view.cx = cx;
      view.cy = cy;
      return;
    }
    init.onMapMove?.(view.zoom);
    markDirty();
  }
  /** Zoom to z keeping the map point under screen point (px, py) where it is (as far as the region allows). */
  function zoomAt(z: number, px: number, py: number): void {
    const z0 = view.zoom;
    const cx0 = view.cx;
    const cy0 = view.cy;
    reset.on = false;
    const fx = px / width - 0.5;
    const fy = py / height - 0.5;
    const ux = view.cx + fx / z0;
    const uy = view.cy + fy / z0;
    view.zoom = Math.min(MAP_ZOOM_MAX, Math.max(1, z));
    view.cx = ux - fx / view.zoom;
    view.cy = uy - fy / view.zoom;
    clampView();
    viewMoved(z0, cx0, cy0);
  }
  /** Moves the map by (dx, dy) screen px: the picture follows the pointer. */
  function panBy(dx: number, dy: number): void {
    const z0 = view.zoom;
    const cx0 = view.cx;
    const cy0 = view.cy;
    reset.on = false;
    view.cx -= dx / (width * view.zoom);
    view.cy -= dy / (height * view.zoom);
    clampView();
    viewMoved(z0, cx0, cy0);
  }
  /** Sets the camera's view offset for this frame: the zoomed part of the region, widening to it on the satellite trip. */
  let offKey0 = 1;
  let offKey1 = 0.5;
  let offKey2 = 0.5;
  let offW = 0;
  let offH = 0;
  function applyView(): void {
    let z = view.zoom;
    let cx = view.cx;
    let cy = view.cy;
    if (trip > 0) {
      const s = smooth(Math.min(1, trip / TRIP_UNZOOM));
      z = 1 + (z - 1) * (1 - s);
      cx += (0.5 - cx) * s;
      cy += (0.5 - cy) * s;
    }
    if (z === offKey0 && cx === offKey1 && cy === offKey2 && width === offW && height === offH) return;
    offKey0 = z;
    offKey1 = cx;
    offKey2 = cy;
    offW = width;
    offH = height;
    if (z === 1 && cx === 0.5 && cy === 0.5) camera.clearViewOffset();
    else camera.setViewOffset(width, height, (cx - 0.5 / z) * width, (cy - 0.5 / z) * height, width / z, height / z);
  }
  /** __app.mapView: the zoom and the surface point at the view's centre, from the region's camera (not the frame's). */
  const viewCamera = new THREE.PerspectiveCamera(MAP_FOV, 1, 0.01, 100);
  const vd = new THREE.Vector3();
  let mvKey = '';
  let mv = { zoom: 1, lat: NaN, lon: NaN };
  /** The surface point at the centre of the view (zoom z, centre cx, cy), from the region's camera. */
  function surfaceAt(z: number, cx: number, cy: number): { lat: number; lon: number } {
    viewCamera.fov = MAP_FOV;
    viewCamera.aspect = width / height;
    if (z === 1) viewCamera.clearViewOffset();
    else viewCamera.setViewOffset(width, height, (cx - 0.5 / z) * width, (cy - 0.5 / z) * height, width / z, height / z);
    viewCamera.updateProjectionMatrix();
    vec(home.lat, home.lon, home.dist, viewCamera.position);
    viewCamera.lookAt(0, 0, 0);
    viewCamera.updateMatrixWorld();
    vd.set(0, 0, 0.5).unproject(viewCamera).sub(viewCamera.position).normalize();
    const b = viewCamera.position.dot(vd);
    const disc = b * b - (viewCamera.position.lengthSq() - 1);
    if (disc < 0) return { lat: NaN, lon: NaN };
    vd.multiplyScalar(-b - Math.sqrt(disc)).add(viewCamera.position);
    return { lat: Math.asin(Math.max(-1, Math.min(1, vd.y))) / RAD, lon: Math.atan2(-vd.z, vd.x) / RAD };
  }
  function mapView(): { zoom: number; lat: number; lon: number } {
    const key = `${view.zoom}|${view.cx}|${view.cy}|${home.lat}|${home.lon}|${home.dist}|${width}|${height}`;
    if (key !== mvKey) {
      const v = surfaceAt(view.zoom, view.cx, view.cy);
      mvKey = key;
      mv = { zoom: view.zoom, lat: v.lat, lon: v.lon };
    }
    return { zoom: mv.zoom, lat: mv.lat, lon: mv.lon };
  }

  // ---------------------------------------------------------------- Satellite close-up
  const close = { yaw: YAW0, pitch: PITCH0, zoom: 1, d0: 0.04, held: false, idleUntil: 0 };
  const satOut = new THREE.Vector3(); // unit offset of the camera from the model, world space
  /** Unit direction from the model to the close-up camera at (yaw, pitch), in world space. */
  function closeDir(yaw: number, pitch: number, out: THREE.Vector3): THREE.Vector3 {
    const c = Math.cos(pitch);
    return out.set(c * Math.sin(yaw), Math.sin(pitch), -c * Math.cos(yaw)).applyQuaternion(sat.quaternion);
  }

  // Trip between the map and the close-up, after AstroSphere src/scene/flight/flightView.ts (step): one number
  // `trip` runs from 0 (the map view) to 1 (the close-up), with smoothstep easing. Along it the point looked
  // at moves from the Earth's centre to the model (over the first 60 %), the camera's direction from that point is
  // slerped, and its distance changes geometrically, so the model grows steadily as the camera closes in.
  let trip = 0;
  const flight = { on: false, t0: 0, ms: 1, from: 0, to: 0, done: null as null | (() => void) };
  const fDir = new THREE.Vector3();
  const fA = new THREE.Vector3();
  const fTarget = new THREE.Vector3();
  const mLook = new THREE.Matrix4();
  const UP = new THREE.Vector3(0, 1, 0);
  const smooth = (t: number) => t * t * (3 - 2 * t);

  function fly(to: 0 | 1, ms: number, done?: () => void): void {
    if (init.reducedMotion() || ms <= 0) {
      flight.on = false;
      flightResolution(false);
      trip = to;
      done?.();
      markDirty();
      return;
    }
    flight.on = true;
    flightResolution(true);
    flight.t0 = performance.now();
    flight.ms = ms;
    flight.from = trip;
    flight.to = to;
    flight.done = done ?? null;
    markDirty();
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

  /** Camera pose at trip position k (0 map, 1 close-up). */
  function pose(k: number): void {
    const dClose = close.d0 * close.zoom;
    closeDir(close.yaw, close.pitch, satOut);
    if (k >= 1) {
      fTarget.copy(satCenter);
      camera.position.copy(satCenter).addScaledVector(satOut, dClose);
    } else {
      vec(home.lat, home.lon, 1, fA);
      fTarget.copy(satCenter).multiplyScalar(smooth(Math.min(1, k / 0.6)));
      slerpDir(fA, satOut, k, fDir);
      camera.position.copy(fTarget).addScaledVector(fDir, home.dist * (dClose / home.dist) ** k);
    }
    mLook.lookAt(camera.position, fTarget, UP);
    camera.quaternion.setFromRotationMatrix(mLook);
    const fov = k >= 1 ? SAT_FOV : k <= 0 ? MAP_FOV : MAP_FOV + (SAT_FOV - MAP_FOV) * smooth(k);
    if (fov !== camera.fov) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
  }

  /** Near plane close to the model in the close-up, the map's own on the map. */
  function setNear(): void {
    const near = Math.min(0.01, Math.max(0.0005, 0.25 * camera.position.distanceTo(satCenter)));
    if (near !== camera.near) {
      camera.near = near;
      camera.updateProjectionMatrix();
    }
  }

  /** The Earth dims on the way out and comes back on the way back; the map patches hide in the close-up. */
  let dimK = -1;
  function setDim(): void {
    const k = 1 - (1 - EARTH_DIM[ground ?? 'light']) * trip;
    if (k === dimK) return;
    dimK = k;
    earthMat.color.setScalar(k);
    areaMat.color.setScalar(k);
    regionMat.color.setScalar(k);
    areaMesh.visible = regionMesh.visible = trip < 0.6;
    orbitDots.visible = trip > 0;
    nightUniforms.uNight.value = ground === 'light' ? smooth(Math.min(1, trip / 0.8)) : 0;
  }

  /** True when only the automatic turn moves the picture this frame (no flight, no input). */
  let autoOnly = false;
  let lastDraw = -Infinity;
  /** Bumped by every input and request for a frame; a frame with a new value is always drawn. */
  let inputSeq = 0;
  let drawnSeq = -1;

  /** Places the camera for this frame; true while it needs the next frame (a flight, the automatic turn). */
  function placeCamera(now: number, dt: number): boolean {
    let moving = false;
    if (flight.on) {
      const t = Math.min(1, Math.max(0, (now - flight.t0) / flight.ms));
      // Out: full resolution again for the slow last fifth, so the landing on the model is sharp. Back: half
      // resolution to the end, because the last part fills the view with the Earth, the costly part to draw.
      flightResolution(flight.to === 0 || t < 0.8);
      trip = flight.from + (flight.to - flight.from) * smooth(t);
      if (t >= 1) {
        flight.on = false;
        flightResolution(false);
        trip = flight.to;
        // Landed on the model: the automatic turn waits, as after input, then eases in.
        if (flight.to === 1) close.idleUntil = now + AUTO_PAUSE_MS;
        const done = flight.done;
        flight.done = null;
        done?.();
      } else moving = true;
    }
    if (reset.on) {
      const t = init.reducedMotion() ? 1 : Math.min(1, Math.max(0, (now - reset.t0) / RESET_MS));
      const s = smooth(t);
      view.zoom = reset.z0 + (1 - reset.z0) * s;
      view.cx = reset.cx0 + (0.5 - reset.cx0) * s;
      view.cy = reset.cy0 + (0.5 - reset.cy0) * s;
      if (t >= 1) {
        reset.on = false;
        view.zoom = 1;
        view.cx = view.cy = 0.5;
      } else {
        clampView();
        moving = true;
      }
    }
    autoOnly = false;
    if (!flight.on && satView && trip === 1 && !close.held && !init.reducedMotion()) {
      if (now >= close.idleUntil) close.yaw += AUTO_TURN * smooth(Math.min(1, (now - close.idleUntil) / AUTO_EASE_MS)) * dt;
      autoOnly = !moving;
      moving = true;
    }
    setDim();
    pose(trip);
    setNear();
    applyView();
    if (orbitDots.visible) layoutOrbit();
    return moving;
  }

  /** Arrival distance: the model's larger side fills ARRIVAL_FILL of the view's shorter side at zoom 1. */
  const fitBox = new Float32Array(4);
  function fitCloseDistance(): void {
    let d = close.d0;
    closeDir(YAW0, PITCH0, fA);
    fitCamera.fov = SAT_FOV;
    fitCamera.aspect = camera.aspect;
    fitCamera.near = 0.0005;
    fitCamera.updateProjectionMatrix();
    for (let it = 0; it < 5; it++) {
      fitCamera.position.copy(satCenter).addScaledVector(fA, d);
      mLook.lookAt(fitCamera.position, satCenter, UP);
      fitCamera.quaternion.setFromRotationMatrix(mLook);
      fitCamera.updateMatrixWorld();
      modelBox(fitCamera, fitBox);
      const size = Math.max(fitBox[2] - fitBox[0], fitBox[3] - fitBox[1]);
      if (!(size > 0)) break;
      d *= size / (ARRIVAL_FILL * Math.min(width, height));
    }
    close.d0 = d;
  }

  /** The model's box on screen (x0, y0, x1, y1) for a camera, from every point of its drawing. */
  function modelBox(cam: THREE.Camera, out: Float32Array): void {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let i = 0; i < satPts.length; i += 3) {
      proj.set(satPts[i], satPts[i + 1], satPts[i + 2]).project(cam);
      const x = (proj.x * 0.5 + 0.5) * width;
      const y = (-proj.y * 0.5 + 0.5) * height;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    out[0] = x0;
    out[1] = y0;
    out[2] = x1;
    out[3] = y1;
  }

  // ---------------------------------------------------------------- Overlays
  const proj = new THREE.Vector3();
  const toCam = new THREE.Vector3();
  const camDir = new THREE.Vector3();
  const last = { storm: [NaN, NaN], pin: [NaN, NaN], sat: [NaN, NaN, NaN, NaN] };

  /** Screen position of a world point, or false when it is hidden (behind the Earth, behind the camera, off the canvas). */
  function screen(world: THREE.Vector3, surface: boolean): boolean {
    toCam.copy(camera.position).sub(world);
    const front = surface ? world.dot(toCam) > 0 : toCam.dot(camDir) < 0;
    if (!front) return false;
    proj.copy(world).project(camera);
    if (proj.z >= 1) return false;
    proj.x = (proj.x * 0.5 + 0.5) * width;
    proj.y = (-proj.y * 0.5 + 0.5) * height;
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
    updateReset();
    updateClose();
  }

  /**
   * Shows btn-map-reset while zoomed in on the map, in the first corner spot that covers nothing it must not: the
   * demo label and the key (their boxes are read when the button shows and on a resize; they do not move with the
   * map), the storm marker and the pin. Kept free of allocation, as it runs on every frame of a pan.
   */
  const RESET_BOXES = 8;
  const resetBoxes = new Float32Array(RESET_BOXES * 4);
  let nCover = -1;
  let nBoxes = 0;
  const pushBox = (x0: number, y0: number, x1: number, y1: number) => {
    if (nBoxes >= RESET_BOXES) return;
    const o = nBoxes * 4;
    resetBoxes[o] = x0;
    resetBoxes[o + 1] = y0;
    resetBoxes[o + 2] = x1;
    resetBoxes[o + 3] = y1;
    nBoxes++;
  };
  const spotFree = (x: number, y: number): boolean => {
    if (y < 12 || y + resetH > height - 12) return false;
    for (let j = 0; j < nBoxes; j++) {
      const o = j * 4;
      if (x - 4 < resetBoxes[o + 2] && x + resetW + 4 > resetBoxes[o] && y - 4 < resetBoxes[o + 3] && y + resetH + 4 > resetBoxes[o + 1]) return false;
    }
    return true;
  };
  function updateReset(): void {
    const on = view.zoom > 1 && !satView && trip === 0;
    if (resetBtn.hidden === on) {
      if (!on && document.activeElement === resetBtn) container.focus({ preventScroll: true });
      resetBtn.hidden = !on;
      container.classList.toggle('globe--zoomed', on);
      nCover = -1;
      if (on) {
        resetW = resetBtn.offsetWidth;
        resetH = resetBtn.offsetHeight;
      }
    }
    if (!on) return;
    if (nCover < 0) {
      nBoxes = 0;
      for (const b of coverBoxes()) pushBox(b[0], b[1], b[2], b[3]);
      nCover = nBoxes;
    }
    nBoxes = nCover;
    if (!stormEl.hidden) pushBox(last.storm[0] - 16, last.storm[1] - 16, last.storm[0] + 16, last.storm[1] + 16);
    if (!pinEl.hidden) pushBox(last.pin[0] - 12, last.pin[1] - 12, last.pin[0] + 12, last.pin[1] + 12);
    const m = 12;
    let bx = width - resetW - m;
    let by = m;
    // Right side first, then left; at the top, below each box, above each box, at the bottom.
    search: for (let side = 0; side < 2; side++) {
      const x = side === 0 ? width - resetW - m : m;
      for (let k = -1; k <= nBoxes * 2; k++) {
        const y = k < 0 ? m : k === nBoxes * 2 ? height - resetH - m : k % 2 === 0 ? resetBoxes[(k >> 1) * 4 + 3] + 8 : resetBoxes[(k >> 1) * 4 + 1] - resetH - 8;
        if (spotFree(x, y)) {
          bx = x;
          by = y;
          break search;
        }
      }
    }
    bx = Math.round(bx);
    by = Math.round(by);
    if (bx !== resetPos[0] || by !== resetPos[1]) {
      resetPos[0] = bx;
      resetPos[1] = by;
      resetBtn.style.transform = `translate(${bx}px, ${by}px)`;
    }
  }

  // The close-up's overlays: [satellite-model] over the model's box on screen, and the HUD.
  const hudFrame: HudFrame = { width: 1, height: 1, box: new Float32Array(4), anchors: new Float32Array(PART_ORDER.length * 2), facing: new Uint8Array(PART_ORDER.length), parts: new Float32Array(PART_ORDER.length * 4) };
  function updateClose(): void {
    const on = satView && !flight.on && trip === 1;
    hud.show(on);
    if (satEl.hidden === on) satEl.hidden = !on;
    if (!on) return;
    const box = hudFrame.box;
    modelBox(camera, box);
    const x0 = Math.round(box[0]);
    const y0 = Math.round(box[1]);
    const w = Math.round(box[2]) - x0;
    const h = Math.round(box[3]) - y0;
    const ls = last.sat;
    if (x0 !== ls[0] || y0 !== ls[1]) {
      ls[0] = x0;
      ls[1] = y0;
      satEl.style.transform = `translate(${x0}px, ${y0}px)`;
    }
    if (w !== ls[2] || h !== ls[3]) {
      ls[2] = w;
      ls[3] = h;
      satEl.style.width = `${w}px`;
      satEl.style.height = `${h}px`;
    }
    camLocal.copy(camera.position).applyMatrix4(satInv);
    for (let i = 0; i < partWorld.length; i++) {
      const p = partWorld[i];
      proj.copy(p.anchor).project(camera);
      hudFrame.anchors[i * 2] = (proj.x * 0.5 + 0.5) * width;
      hudFrame.anchors[i * 2 + 1] = (-proj.y * 0.5 + 0.5) * height;
      hudFrame.facing[i] = partSeen(i) ? 1 : 0;
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (const c of p.corners) {
        proj.copy(c).project(camera);
        const x = (proj.x * 0.5 + 0.5) * width;
        const y = (-proj.y * 0.5 + 0.5) * height;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
      const pb = hudFrame.parts;
      pb[i * 4] = x0;
      pb[i * 4 + 1] = y0;
      pb[i * 4 + 2] = x1;
      pb[i * 4 + 3] = y1;
    }
    hudFrame.width = width;
    hudFrame.height = height;
    hud.frame(hudFrame);
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
    noteHost: pinEl,
  });

  let metricsKey = '';
  function updateChart(settled: boolean): void {
    const blocked = coverBoxes([...(init.covers?.() ?? []), ...(init.avoid?.() ?? [])]);
    if (!stormEl.hidden) blocked.push([last.storm[0] - 13, last.storm[1] - 13, last.storm[0] + 13, last.storm[1] + 13]);
    if (!pinEl.hidden) blocked.push([last.pin[0] - 9, last.pin[1] - 9, last.pin[0] + 9, last.pin[1] + 9]);
    if (!resetBtn.hidden) blocked.push([resetPos[0] - 4, resetPos[1] - 4, resetPos[0] + resetW + 4, resetPos[1] + resetH + 4]);
    chart.update({
      width,
      height,
      satView,
      returning: flight.on && !satView,
      full: mode === 'full',
      settled,
      // As far as a 40 degree camera would stand to show the same span (the graticule step follows it).
      dist: 1 + ((camera.position.length() - 1) * Math.tan((camera.fov / 2) * RAD)) / Math.tan(20 * RAD),
      zoom: trip > 0 ? 1 : view.zoom,
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
    // A word space of clearance round the chart's labels and notes, so a name never runs on into one of them.
    for (const [x0, y0, x1, y1] of fixed) occupy(x0 - 6, y0 - 2, x1 + 6, y1 + 2);
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

  const loop = startFrameLoop((now, dt) => {
    const moving = placeCamera(now, dt);
    // The automatic turn alone is drawn at most every AUTO_FRAME_MS: it is slow, and a slow device keeps its
    // frames for the page.
    if (autoOnly && drawn && inputSeq === drawnSeq && now - lastDraw < AUTO_FRAME_MS) return true;
    lastDraw = now;
    drawnSeq = inputSeq;
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
  markDirty = () => {
    inputSeq++;
    loop.markDirty();
  };
  applyGround();
  // Compile every material now, the satellite model's included, so the first flight out does not stall on it.
  renderer.compile(scene, camera);
  /** Works the region out again for a new layout; while the satellite view is open, only marks it stale. */
  function reframe(): void {
    if (satView) {
      homeStale = true;
      return;
    }
    home = homeCam();
    homeW = width;
    homeH = height;
    markDirty();
  }

  function resize(): void {
    width = Math.max(1, container.clientWidth);
    height = Math.max(1, container.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    reframe();
    fitCloseDistance();
    labelsMeasured = false;
    pinNameW = -1;
    nCover = -1;
    markDirty();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();
  // The key's height follows the map scale; when it changes, the home framing is worked out again around it.
  let frameH = -1;
  const frameRo = new ResizeObserver(() => {
    const h = init.frameAround ? Math.round(init.frameAround.getBoundingClientRect().height) : 0;
    // A hidden key (the satellite view, or the key folded into the phone panel) leaves the framing as it is.
    if (h === 0 || satView || Math.abs(h - frameH) < 3) return;
    frameH = h;
    reframe();
  });
  if (init.frameAround) frameRo.observe(init.frameAround);

  // The map (SPEC 6.2): a drag (mouse or one finger) pans, scroll or a pinch zooms about the pointer, and while the
  // map has focus + and - zoom and the arrow keys pan. The globe's touch-action is none (styles.css) and every wheel
  // over it is taken, so the page itself never scrolls or zooms over the map.
  // In the close-up (SPEC 6.7): a drag (mouse or one finger) orbits the camera round the model, scroll or a pinch
  // zooms between 0.6x and 2x of the arrival distance, and the arrow keys turn it while [satellite] has focus.
  // Any press holds the automatic turn; it starts again AUTO_PAUSE_MS after the last input.
  const closeLive = () => satView && !flight.on && trip === 1;
  const mapLive = () => !satView && !flight.on && trip === 0;
  /** Which view the pointers down now drive. */
  let ptrMap = false;
  let gLeft = 0;
  let gTop = 0;
  let mapMidX = 0;
  let mapMidY = 0;
  let mapD = 0;
  /** Elements over the map that keep their own pointer use (the reset button, the key, the demo label). */
  const ownPointer = (t: EventTarget | null): boolean => t instanceof Element && t !== container && t !== canvas && !!t.closest('button, a, input, select, .key, .globe__demo, .satview');
  function mapPointerDown(e: PointerEvent): void {
    if (ownPointer(e.target)) return;
    if (nPtr() === 0) ptrMap = true;
    if (!ptrMap) return;
    const slot = ptrId[0] < 0 ? 0 : ptrId[1] < 0 ? 1 : -1;
    if (slot < 0) return;
    if (nPtr() === 0) {
      const r = container.getBoundingClientRect();
      gLeft = r.left;
      gTop = r.top;
    }
    ptrId[slot] = e.pointerId;
    ptrX[slot] = e.clientX;
    ptrY[slot] = e.clientY;
    try {
      container.setPointerCapture(e.pointerId);
    } catch {
      /* the pointer is already gone */
    }
    if (nPtr() === 2) {
      mapD = pinchDist();
      mapMidX = (ptrX[0] + ptrX[1]) / 2;
      mapMidY = (ptrY[0] + ptrY[1]) / 2;
    }
    if (e.pointerType === 'mouse') e.preventDefault();
  }
  function mapPointerMove(e: PointerEvent, slot: number): void {
    const dx = e.clientX - ptrX[slot];
    const dy = e.clientY - ptrY[slot];
    ptrX[slot] = e.clientX;
    ptrY[slot] = e.clientY;
    if (nPtr() === 2) {
      const d = pinchDist();
      const mx = (ptrX[0] + ptrX[1]) / 2;
      const my = (ptrY[0] + ptrY[1]) / 2;
      if (mapD > 0 && d > 0) zoomAt(view.zoom * (d / mapD), mx - gLeft, my - gTop);
      panBy(mx - mapMidX, my - mapMidY);
      mapD = d;
      mapMidX = mx;
      mapMidY = my;
    } else panBy(dx, dy);
  }
  const ptrId = new Int32Array(2).fill(-1);
  const ptrX = new Float32Array(2);
  const ptrY = new Float32Array(2);
  let pinchD = 0;
  let pinchZoom = 1;
  const nPtr = () => (ptrId[0] >= 0 ? 1 : 0) + (ptrId[1] >= 0 ? 1 : 0);
  const pinchDist = () => Math.hypot(ptrX[0] - ptrX[1], ptrY[0] - ptrY[1]);
  const setZoom = (z: number) => {
    close.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
  };
  const turn = (dYaw: number, dPitch: number) => {
    close.yaw += dYaw;
    close.pitch = Math.min(PITCH_MAX, Math.max(-PITCH_MAX, close.pitch + dPitch));
  };
  const touched = () => {
    close.idleUntil = performance.now() + AUTO_PAUSE_MS;
    markDirty();
  };
  function onPointerDown(e: PointerEvent): void {
    if (mapLive()) {
      mapPointerDown(e);
      return;
    }
    if (!closeLive()) return;
    if (nPtr() === 0) ptrMap = false;
    if (ptrMap) return;
    const slot = ptrId[0] < 0 ? 0 : ptrId[1] < 0 ? 1 : -1;
    if (slot < 0) return;
    ptrId[slot] = e.pointerId;
    ptrX[slot] = e.clientX;
    ptrY[slot] = e.clientY;
    try {
      container.setPointerCapture(e.pointerId);
    } catch {
      /* the pointer is already gone */
    }
    if (nPtr() === 2) {
      pinchD = pinchDist();
      pinchZoom = close.zoom;
    }
    close.held = true;
    if (document.activeElement !== hud.root) hud.root.focus({ preventScroll: true });
    touched();
  }
  function onPointerMove(e: PointerEvent): void {
    const slot = ptrId[0] === e.pointerId ? 0 : ptrId[1] === e.pointerId ? 1 : -1;
    if (slot < 0) return;
    if (ptrMap) {
      if (mapLive()) mapPointerMove(e, slot);
      return;
    }
    if (!closeLive()) return;
    const dx = e.clientX - ptrX[slot];
    const dy = e.clientY - ptrY[slot];
    ptrX[slot] = e.clientX;
    ptrY[slot] = e.clientY;
    if (nPtr() === 2) {
      const d = pinchDist();
      if (pinchD > 0 && d > 0) setZoom(pinchZoom * (pinchD / d));
    } else turn(-dx * DRAG_RAD, dy * DRAG_RAD);
    touched();
  }
  function onPointerUp(e: PointerEvent): void {
    const slot = ptrId[0] === e.pointerId ? 0 : ptrId[1] === e.pointerId ? 1 : -1;
    if (slot < 0) return;
    ptrId[slot] = -1;
    if (slot === 0 && ptrId[1] >= 0) {
      ptrId[0] = ptrId[1];
      ptrX[0] = ptrX[1];
      ptrY[0] = ptrY[1];
      ptrId[1] = -1;
    }
    pinchD = 0;
    if (ptrMap) {
      // One finger left of a pinch: it pans on from where it is.
      mapD = 0;
      if (nPtr() === 0) ptrMap = false;
      return;
    }
    if (nPtr() === 0) close.held = false;
    touched();
  }
  function onWheel(e: WheelEvent): void {
    // Every wheel over the globe is taken (Ctrl + wheel is a trackpad pinch): the page never scrolls or zooms here.
    e.preventDefault();
    const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    if (mapLive()) {
      const r = container.getBoundingClientRect();
      zoomAt(view.zoom * Math.exp(-e.deltaY * k * WHEEL_K), e.clientX - r.left, e.clientY - r.top);
      return;
    }
    if (!closeLive()) return;
    setZoom(close.zoom * Math.exp(e.deltaY * k * 0.0015));
    touched();
  }
  function onKey(e: KeyboardEvent): void {
    if (!closeLive() || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === 'ArrowLeft') turn(KEY_YAW, 0);
    else if (e.key === 'ArrowRight') turn(-KEY_YAW, 0);
    else if (e.key === 'ArrowUp') turn(0, KEY_PITCH);
    else if (e.key === 'ArrowDown') turn(0, -KEY_PITCH);
    else return;
    e.preventDefault();
    touched();
  }
  function onMapKey(e: KeyboardEvent): void {
    if (e.target !== container || !mapLive() || e.altKey || e.ctrlKey || e.metaKey) return;
    const k = e.key;
    if (k === '+' || k === '=' || k === 'Add') zoomAt(view.zoom * KEY_ZOOM, width / 2, height / 2);
    else if (k === '-' || k === '_' || k === 'Subtract') zoomAt(view.zoom / KEY_ZOOM, width / 2, height / 2);
    else if (k === 'ArrowLeft') panBy((KEY_PAN * width) / 1, 0);
    else if (k === 'ArrowRight') panBy((-KEY_PAN * width) / 1, 0);
    else if (k === 'ArrowUp') panBy(0, KEY_PAN * height);
    else if (k === 'ArrowDown') panBy(0, -KEY_PAN * height);
    else return;
    e.preventDefault();
  }
  function onReset(): void {
    if (view.zoom === 1 && view.cx === 0.5 && view.cy === 0.5) return;
    init.onMapReset?.();
    reset.on = true;
    reset.t0 = performance.now();
    reset.z0 = view.zoom;
    reset.cx0 = view.cx;
    reset.cy0 = view.cy;
    markDirty();
  }
  // The globe takes focus for the map keys (SPEC 6.2); in the satellite view [satellite] takes it instead.
  container.tabIndex = 0;
  container.addEventListener('keydown', onMapKey);
  resetBtn.addEventListener('click', onReset);
  container.addEventListener('pointerdown', onPointerDown);
  container.addEventListener('pointermove', onPointerMove);
  container.addEventListener('pointerup', onPointerUp);
  container.addEventListener('pointercancel', onPointerUp);
  container.addEventListener('wheel', onWheel, { passive: false });
  hud.root.addEventListener('keydown', onKey);
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
      markDirty();
    },
    setTime(ms) {
      if (ms === timeMs) return;
      timeMs = ms;
      updateStorm();
      markDirty();
    },
    setPlace(p) {
      place = p ? { lat: p.lat, lon: p.lon, label: p.label } : null;
      if (p) vec(p.lat, p.lon, 1, pinWorld);
      pinName.textContent = p?.label ?? '';
      // The pin's name for screen readers and the tests: the place's label ("Vị trí của bạn" for the own location).
      pinEl.setAttribute('aria-label', p?.label || init.labels.pin);
      pinNameW = -1;
      markDirty();
    },
    highlightStorm() {
      window.clearTimeout(highlightTimer);
      stormEl.classList.add('globe__storm--hi');
      highlightTimer = window.setTimeout(() => stormEl.classList.remove('globe__storm--hi'), 4000);
    },
    showSatellite() {
      if (satView) return;
      satView = true;
      close.yaw = YAW0;
      close.pitch = PITCH0;
      close.zoom = 1;
      close.held = false;
      ptrId.fill(-1);
      close.idleUntil = 0;
      reset.on = false;
      container.tabIndex = -1;
      fly(1, FLY_SAT_MS);
    },
    satellite() {
      return { yaw: close.yaw, pitch: close.pitch, zoom: close.zoom };
    },
    mapView,
    back() {
      if (!satView) return;
      satView = false;
      container.tabIndex = 0;
      // The trip returns to the view it left from (SPEC 6.2, 6.7): the region is fitted again only when the canvas
      // size changed while the satellite view was open.
      if (homeStale) {
        homeStale = false;
        if (width !== homeW || height !== homeH) {
          home = homeCam();
          homeW = width;
          homeH = height;
        }
      }
      fly(0, FLY_SAT_MS);
    },
    dispose() {
      window.clearTimeout(highlightTimer);
      ro.disconnect();
      frameRo.disconnect();
      container.removeEventListener('pointerdown', onPointerDown);
      container.removeEventListener('pointermove', onPointerMove);
      container.removeEventListener('pointerup', onPointerUp);
      container.removeEventListener('pointercancel', onPointerUp);
      container.removeEventListener('wheel', onWheel);
      container.removeEventListener('keydown', onMapKey);
      resetBtn.remove();
      hud.dispose();
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
