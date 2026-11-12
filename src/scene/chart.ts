// The storm-track chart drawn over the globe (DESIGN 2): one SVG layer, redrawn on each globe frame from
// screen projections the globe supplies. It holds the graticule with degree labels, the track line and its
// glyphs (dot area proportional to the wind level), date labels every 24 h, the 70 % circles with their
// hours, the wind area and two notes with curved leaders; it is hidden in the satellite view. Colours come from
// the CSS tokens (styles.css), so the chart follows the theme.
import { t } from '../i18n';
import { km, vnDay, vnTime } from '../storm/format';
import { circleRing, destination, glyphPoints, glyphRadius, glyphScale, isDatePoint, windRing } from '../storm/glyph';
import { verdict, windLevel, type ConeCircle, type LatLon, type Province, type Step, type Track } from '../storm/verdict';

const SVGNS = 'http://www.w3.org/2000/svg';
const RAD = Math.PI / 180;

export interface ChartDeps {
  container: HTMLElement;
  track: Track;
  nowMs: number;
  cone: ConeCircle[];
  provinces: readonly Province[];
  /** Screen position (container px) of a surface point into out; false when it is on the far side. */
  surface(lat: number, lon: number, out: number[]): boolean;
  /** Surface point under a screen position, or null when the ray misses the Earth. */
  pick(x: number, y: number): LatLon | null;
  isLand(lat: number, lon: number): boolean;
}

export interface ChartFrame {
  width: number;
  height: number;
  satView: boolean;
  /** True while the camera flies back from the satellite: nothing is drawn until it lands on the map. */
  returning?: boolean;
  full: boolean;
  /** False during a camera flight: the notes wait until the camera settles. */
  settled: boolean;
  /** Camera distance in Earth radii (sets the graticule step). */
  dist: number;
  timeMs: number;
  storm: Step | null;
  place: (LatLon & { label?: string }) | null;
  /** Boxes [x0, y0, x1, y1] nothing may cover: what lies over the globe, the storm marker, the pin. */
  blocked: number[][];
}

type Box = [number, number, number, number];

const overlaps = (a: number[], b: number[]) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];

function el<K extends keyof SVGElementTagNameMap>(tag: K, cls: string, parent: Element): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVGNS, tag);
  if (cls) e.setAttribute('class', cls);
  parent.append(e);
  return e;
}

const f1 = (n: number) => Math.round(n * 10) / 10;

export function createChart(deps: ChartDeps) {
  const { track, nowMs } = deps;
  const svg = el('svg', 'chart', deps.container);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  // Drawing order: graticule, 70 % circles, wind area, track, glyphs, labels, notes; orbit for the satellite view.
  const gMap = el('g', '', svg);
  const gratPath = el('path', 'chart__grat', gMap);
  const gGratLab = el('g', 'chart__grat-labels', gMap);
  const gCone = el('g', 'chart__cone', gMap);
  const windPath = el('path', 'chart__wind', gMap);
  const pastPath = el('path', 'chart__track chart__track--past', gMap);
  const forePath = el('path', 'chart__track chart__track--forecast', gMap);
  const gGlyph = el('g', 'chart__glyphs', gMap);
  const gDates = el('g', 'chart__dates', gMap);
  const gNotes = el('g', 'chart__notes', gMap);

  const pt = [0, 0];
  const pt2 = [0, 0];

  // ---- Track: the 3-hour points split at now; glyphs on the 6-hour points.
  const pastPts = track.points.filter((p) => Date.parse(p.t) <= nowMs);
  const forePts = track.points.filter((p) => Date.parse(p.t) >= nowMs);
  const glyphs = glyphPoints(track).map((p) => {
    const level = windLevel(p.windKt);
    const past = Date.parse(p.t) <= nowMs;
    const c = el('circle', `chart__glyph chart__glyph--${level === null ? 'missing' : past ? 'past' : 'forecast'}`, gGlyph);
    const r = glyphRadius(level);
    c.setAttribute('r', String(f1(r)));
    c.dataset.level = level === null ? '' : String(level);
    let label: SVGTextElement | null = null;
    let lead: SVGPathElement | null = null;
    if (isDatePoint(p)) {
      lead = el('path', 'chart__date-lead', gDates);
      label = el('text', 'chart__date', gDates);
      label.textContent = vnDay(p.t);
    }
    return { p, level, r, c, label, lead, x: NaN, y: NaN, on: false, lw: 0, lh: 0 };
  });

  // ---- 70 % circles and their hour labels.
  const cones = deps.cone.map((c) => {
    const path = el('path', 'chart__cone-line', gCone);
    const lab = el('text', 'chart__cone-label', gCone);
    lab.textContent = t('map.hours', { h: c.hours });
    return { c, path, lab, ring: circleRing(c.lat, c.lon, c.radiusKm), edge: destination(c.lat, c.lon, 180, c.radiusKm) };
  });


  // ---- Notes: the storm at the selected time, and the place once one is chosen.
  interface Note {
    g: SVGGElement;
    lead: SVGPathElement;
    dot: SVGCircleElement;
    text: SVGTextElement;
    head: SVGTSpanElement;
    body: SVGTSpanElement;
    key: string;
    w: number;
    h: number;
    box: Box | null;
  }
  const makeNote = (cls: string): Note => {
    const g = el('g', `chart__note ${cls}`, gNotes);
    const lead = el('path', 'chart__lead', g);
    const dot = el('circle', 'chart__lead-dot', g);
    dot.setAttribute('r', '2.5');
    const text = el('text', 'chart__note-text', g);
    const head = el('tspan', 'chart__note-head', text);
    const body = el('tspan', 'chart__note-body', text);
    g.style.display = 'none';
    return { g, lead, dot, text, head, body, key: '', w: 0, h: 0, box: null };
  };
  const stormNote = makeNote('chart__note--storm');
  const placeNote = makeNote('chart__note--place');
  const placeVerdict = new Map<string, string>();

  let fontKey = '';
  const lineH = () => parseFloat(getComputedStyle(gNotes).fontSize) || 12;

  function setNote(n: Note, head: string, body: string): void {
    const key = `${head}|${body}|${fontKey}`;
    if (n.key === key) return;
    n.key = key;
    n.head.textContent = head;
    n.body.textContent = body;
    const lh = lineH();
    n.head.setAttribute('x', '0');
    n.head.setAttribute('dy', String(f1(lh * 1.05)));
    n.body.setAttribute('x', '0');
    n.body.setAttribute('dy', String(f1(lh * 1.35)));
    n.g.style.display = '';
    n.text.setAttribute('transform', 'translate(0,0)');
    try {
      const b = n.text.getBBox();
      n.w = Math.ceil(b.width);
      n.h = Math.ceil(b.y + b.height);
    } catch {
      n.w = Math.max(head.length, body.length) * lh * 0.55;
      n.h = lh * 2.6;
    }
  }

  /**
   * Boxes for a note at angle a (deg, screen) and distance d from the anchor: beside the leader's end when the
   * leader runs sideways; above or below it when it runs up or down, centred on it or starting or ending there.
   */
  function candidates(ax: number, ay: number, w: number, h: number, a: number, d: number, more: boolean): Array<{ box: Box; tx: number; ty: number }> {
    const cx = ax + Math.cos(a * RAD) * d;
    const cy = ay + Math.sin(a * RAD) * d;
    const c = Math.cos(a * RAD);
    const out: Array<{ box: Box; tx: number; ty: number }> = [];
    const push = (x0: number, y0: number, tx: number, ty: number) => out.push({ box: [x0 - 4, y0 - 2, x0 + w + 4, y0 + h + 2], tx, ty });
    if (c > 0.35) push(cx, cy - h / 2, cx - 3, cy);
    else if (c < -0.35) push(cx - w, cy - h / 2, cx + 3, cy);
    if (more ? Math.abs(c) <= 0.5 : Math.abs(c) <= 0.35) {
      const below = Math.sin(a * RAD) > 0;
      const y0 = below ? cy : cy - h;
      const ty = below ? cy - 3 : cy + 3;
      push(cx - w / 2, y0, cx, ty);
      if (more) {
        push(cx - 6, y0, cx, ty);
        push(cx - w + 6, y0, cx, ty);
      }
    }
    return out;
  }

  // Preferred first: lower right (south-east, open sea on this chart), upper right, then round the compass.
  const ANGLES = [45, 30, 60, -30, 150, -150, 0, 180, -60, 120, -120, 90, -90, 15, -15, 165, -165, -45, 135, -135, 75, 105, -75, -105];

  const STORM_DISTS = [70, 100, 140, 190];
  /** The place's note stays close: its leader is at most about 120 px (DESIGN 2, notes in open sea). */
  const PLACE_DISTS = [45, 65, 85, 105, 120];

  /** Number of the polylines' segments (x0, y0, x1, y1) that the segment a-b crosses. */
  function crossings(ax: number, ay: number, bx: number, by: number, segs: number[][]): number {
    let k = 0;
    for (const [x0, y0, x1, y1] of segs) {
      const d1 = (bx - ax) * (y0 - ay) - (by - ay) * (x0 - ax);
      const d2 = (bx - ax) * (y1 - ay) - (by - ay) * (x1 - ax);
      const d3 = (x1 - x0) * (ay - y0) - (y1 - y0) * (ax - x0);
      const d4 = (x1 - x0) * (by - y0) - (y1 - y0) * (bx - x0);
      if (d1 * d2 < 0 && d3 * d4 < 0) k++;
    }
    return k;
  }

  /**
   * Places a note round its anchor: open sea first, clear of the glyphs, and (when `lines` is given) with the
   * fewest crossings of the track and the 70 % circles by its leader or its text.
   */
  function fitNote(n: Note, ax: number, ay: number, f: ChartFrame, taken: number[][], glyphPts: number[][], dists: number[], lines: number[][] | null): boolean {
    let best: { box: Box; tx: number; ty: number } | null = null;
    let bestScore = Infinity;
    for (const d of dists) {
      for (let i = 0; i < ANGLES.length; i++) for (const c of candidates(ax, ay, n.w, n.h, ANGLES[i], d, !!lines)) {
        const [x0, y0, x1, y1] = c.box;
        if (x0 < 6 || y0 < 6 || x1 > f.width - 6 || y1 > f.height - 6) continue;
        if (taken.some((b) => overlaps(b, c.box))) continue;
        let land = 0;
        for (const [sx, sy] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1], [(x0 + x1) / 2, (y0 + y1) / 2], [(x0 + x1) / 2, y0], [(x0 + x1) / 2, y1]]) {
          const ll = deps.pick(sx, sy);
          if (ll && deps.isLand(ll.lat, ll.lon)) land++;
        }
        let hits = 0;
        for (const [gx, gy, r] of glyphPts) if (gx + r > x0 && gx - r < x1 && gy + r > y0 && gy - r < y1) hits++;
        let cross = 0;
        if (lines) {
          cross = crossings(ax, ay, c.tx, c.ty, lines);
          for (const [lx0, ly0, lx1, ly1] of lines) {
            const mx = (lx0 + lx1) / 2;
            const my = (ly0 + ly1) / 2;
            if (mx > x0 && mx < x1 && my > y0 && my < y1) cross += 0.5;
          }
        }
        const score = land * 10 + hits * 4 + cross * 3 + i * 0.15 + (d - dists[0]) * 0.04;
        if (score < bestScore) {
          bestScore = score;
          best = c;
        }
      }
    }
    if (!best) {
      n.g.style.display = 'none';
      n.box = null;
      return false;
    }
    const [x0, y0] = best.box;
    n.g.style.display = '';
    n.text.setAttribute('transform', `translate(${f1(x0 + 4)},${f1(y0 + 2)})`);
    // A fine leader from the anchor dot to the near edge of the note, bowed to one side.
    const dx = best.tx - ax;
    const dy = best.ty - ay;
    const len = Math.hypot(dx, dy) || 1;
    const sx = ax + (dx / len) * 4;
    const sy = ay + (dy / len) * 4;
    const qx = (sx + best.tx) / 2 - (dy / len) * len * 0.22;
    const qy = (sy + best.ty) / 2 + (dx / len) * len * 0.22;
    n.lead.setAttribute('d', `M${f1(sx)},${f1(sy)}Q${f1(qx)},${f1(qy)} ${f1(best.tx)},${f1(best.ty)}`);
    n.dot.setAttribute('cx', String(ax));
    n.dot.setAttribute('cy', String(ay));
    n.box = best.box;
    return true;
  }

  // ---- Graticule labels: a small pool of <text> reused each frame.
  const gratLabels: SVGTextElement[] = [];
  const gratLabel = (i: number) => {
    while (gratLabels.length <= i) gratLabels.push(el('text', 'chart__grat-label', gGratLab));
    return gratLabels[i];
  };
  const charW = () => lineH() * 0.58;

  let vw = 1;
  let vh = 1;
  /** Near the view: points far outside are left out, so a dotted line never runs for millions of pixels. */
  const nearView = (x: number, y: number) => x > -vw && x < 2 * vw && y > -vh && y < 2 * vh;

  /** Inside the view, with a small margin. */
  const inView = (x: number, y: number) => x > -20 && x < vw + 20 && y > -20 && y < vh + 20;

  /**
   * Path data for a polyline of surface points. A segment is drawn only when one of its ends is in view and
   * both are on the near side, so the dotted lines stay short (a long dotted path is slow to paint).
   */
  function polyline(pts: Iterable<LatLon>, collect?: number[][]): string {
    let d = '';
    let pen = false;
    let px = NaN;
    let py = NaN;
    let pIn = false;
    for (const p of pts) {
      const front = deps.surface(p.lat, p.lon, pt) && nearView(pt[0], pt[1]);
      const x = pt[0];
      const y = pt[1];
      collect?.push(front ? [x, y] : [NaN, NaN]);
      if (!front) {
        pen = false;
        px = NaN;
        continue;
      }
      const isIn = inView(x, y);
      if (!Number.isNaN(px) && (isIn || pIn)) {
        if (!pen) d += `M${f1(px)},${f1(py)}`;
        d += `L${f1(x)},${f1(y)}`;
        pen = true;
      } else pen = false;
      px = x;
      py = y;
      pIn = isIn;
    }
    return d;
  }

  let placeNoted = false;
  /** Dot scale and map scale (px per km at the view centre) in the last frame. */
  let scale = 1;
  let pxPerKm = 0;

  function update(f: ChartFrame): void {
    vw = f.width;
    vh = f.height;
    svg.setAttribute('width', String(f.width));
    svg.setAttribute('height', String(f.height));
    svg.setAttribute('viewBox', `0 0 ${f.width} ${f.height}`);
    const fk = document.documentElement.style.fontSize;
    if (fk !== fontKey) {
      fontKey = fk;
      for (const g of glyphs) g.lw = 0;
      stormNote.key = placeNote.key = '';
    }
    gMap.style.display = f.satView || f.returning ? 'none' : '';
    if (f.returning) {
      placeNoted = false;
      return;
    }
    if (f.satView) {
      placeNoted = false;
      return;
    }
    const taken: number[][] = f.blocked.map((b) => [...b]);

    // Graticule, 5 degrees when close, 10 when far.
    const step = f.dist > 2.4 ? 10 : 5;
    let d = '';
    let li = 0;
    const lab = (txt: string, x: number, y: number, anchor: 'start' | 'middle') => {
      const w = txt.length * charW();
      const h = lineH();
      const x0 = anchor === 'middle' ? x - w / 2 : x;
      const box = [x0 - 2, y - h, x0 + w + 2, y + 3];
      if (box[0] < 2 || box[1] < 4 || box[2] > f.width - 2 || taken.some((b) => overlaps(b, box))) return;
      taken.push(box);
      const e = gratLabel(li++);
      e.textContent = txt;
      e.setAttribute('x', String(f1(x)));
      e.setAttribute('y', String(f1(y)));
      e.setAttribute('text-anchor', anchor);
      e.style.display = '';
    };
    // Only the part of the grid in view: the lat/lon box under a 7 x 7 set of screen points, or the whole
    // globe when the Earth's edge is in view.
    let la0 = 90;
    let la1 = -90;
    let lo0 = 360;
    let lo1 = -360;
    let whole = false;
    for (let i = 0; i <= 6 && !whole; i++) {
      for (let j = 0; j <= 6; j++) {
        const ll = deps.pick((f.width * i) / 6, (f.height * j) / 6);
        if (!ll) {
          whole = true;
          break;
        }
        la0 = Math.min(la0, ll.lat);
        la1 = Math.max(la1, ll.lat);
        lo0 = Math.min(lo0, ll.lon);
        lo1 = Math.max(lo1, ll.lon);
      }
    }
    if (whole || lo1 - lo0 > 180) {
      la0 = -80;
      la1 = 80;
      lo0 = -180;
      lo1 = 180 - step;
    } else {
      la0 = Math.max(-80, Math.floor(la0 / step) * step - step);
      la1 = Math.min(80, Math.ceil(la1 / step) * step + step);
      lo0 = Math.floor(lo0 / step) * step - step;
      lo1 = Math.ceil(lo1 / step) * step + step;
    }
    const sampleStep = whole ? 2 : 1;
    const line: number[][] = [];
    for (let lon = lo0; lon <= lo1; lon += step) {
      const pts: LatLon[] = [];
      for (let lat = la0; lat <= la1; lat += sampleStep) pts.push({ lat, lon });
      line.length = 0;
      d += polyline(pts, line);
      // Degree label where the meridian meets the bottom edge.
      const yEdge = f.height;
      for (let i = 1; i < line.length; i++) {
        const [x0, y0] = line[i - 1];
        const [x1, y1] = line[i];
        if (Number.isNaN(x0) || Number.isNaN(x1)) continue;
        if ((y0 - yEdge) * (y1 - yEdge) <= 0 && y0 !== y1) {
          const x = x0 + ((yEdge - y0) / (y1 - y0)) * (x1 - x0);
          if (x > 0 && x < f.width) lab(`${((lon + 540) % 360) - 180}°`, x, f.height - 6, 'middle');
          break;
        }
      }
    }
    for (let lat = la0; lat <= la1; lat += step) {
      const pts: LatLon[] = [];
      for (let lon = lo0; lon <= lo1 + (whole ? step : 0); lon += sampleStep) pts.push({ lat, lon });
      line.length = 0;
      d += polyline(pts, line);
      // Degree label where the parallel meets the left edge.
      for (let i = 1; i < line.length; i++) {
        const [x0, y0] = line[i - 1];
        const [x1, y1] = line[i];
        if (Number.isNaN(x0) || Number.isNaN(x1)) continue;
        if (x0 * x1 <= 0 && x0 !== x1) {
          const y = y0 + ((0 - x0) / (x1 - x0)) * (y1 - y0);
          if (y > 0 && y < f.height) lab(`${Math.abs(lat)}°`, 6, y + 4, 'start');
          break;
        }
      }
    }
    gratPath.setAttribute('d', d);
    for (let i = li; i < gratLabels.length; i++) gratLabels[i].style.display = 'none';

    // 70 % circles, labelled with their hours at the bottom edge.
    const marks: number[][] = [];
    /** Screen segments of the track and the 70 % circles, which the place's note keeps off. */
    const lines: number[][] = [];
    const ringPts: number[][] = [];
    for (const c of cones) {
      ringPts.length = 0;
      c.path.setAttribute('d', polyline(c.ring, ringPts));
      for (const [x, y] of ringPts) if (!Number.isNaN(x)) marks.push([x - 3, y - 3, x + 3, y + 3]);
      for (let k = 1; k < ringPts.length; k++) {
        const [x0, y0] = ringPts[k - 1];
        const [x1, y1] = ringPts[k];
        if (!Number.isNaN(x0) && !Number.isNaN(x1)) lines.push([x0, y0, x1, y1]);
      }
      if (deps.surface(c.edge.lat, c.edge.lon, pt)) {
        c.lab.style.display = '';
        c.lab.setAttribute('x', String(f1(pt[0])));
        c.lab.setAttribute('y', String(f1(pt[1] + lineH() + 1)));
        const w = c.lab.textContent!.length * charW();
        taken.push([pt[0] - w / 2, pt[1], pt[0] + w / 2, pt[1] + lineH() + 3]);
      } else c.lab.style.display = 'none';
    }

    // Wind area of level 8 or more at the selected time, from the four quadrant radii.
    let wd = '';
    let windBox: number[] | null = null;
    const s = f.storm;
    const ring = s ? windRing(s) : null;
    if (ring) {
      let pen = false;
      const wb = [Infinity, Infinity, -Infinity, -Infinity];
      for (const p of ring) {
        if (deps.surface(p.lat, p.lon, pt) && nearView(pt[0], pt[1])) {
          wd += `${pen ? 'L' : 'M'}${f1(pt[0])},${f1(pt[1])}`;
          pen = true;
          wb[0] = Math.min(wb[0], pt[0]);
          wb[1] = Math.min(wb[1], pt[1]);
          wb[2] = Math.max(wb[2], pt[0]);
          wb[3] = Math.max(wb[3], pt[1]);
        }
      }
      if (wd) {
        wd += 'Z';
        windBox = [wb[0] - 3, wb[1] - 3, wb[2] + 3, wb[3] + 3];
      }
    }
    windPath.setAttribute('d', wd);

    // Track line: past solid, forecast dotted.
    pastPath.setAttribute('d', polyline(pastPts));
    forePath.setAttribute('d', polyline(forePts));

    // Glyphs. Their size follows the map scale: the biggest dot takes at most half the usual gap between
    // neighbouring points on screen (glyph.ts), so the dots stay apart on a phone.
    const gaps: number[] = [];
    let prev: (typeof glyphs)[number] | null = null;
    for (const g of glyphs) {
      g.on = deps.surface(g.p.lat, g.p.lon, pt) && pt[0] > -20 && pt[0] < f.width + 20 && pt[1] > -20 && pt[1] < f.height + 20;
      if (g.on) {
        g.x = pt[0];
        g.y = pt[1];
        if (prev?.on) gaps.push(Math.hypot(g.x - prev.x, g.y - prev.y));
      }
      prev = g;
    }
    gaps.sort((a, b) => a - b);
    scale = glyphScale(gaps.length ? gaps[Math.floor(gaps.length * 0.15)] : 0);
    const glyphPts: number[][] = [];
    let lastOn: (typeof glyphs)[number] | null = null;
    for (const g of glyphs) {
      if (g.on) {
        if (lastOn) lines.push([lastOn.x, lastOn.y, g.x, g.y]);
        lastOn = g;
      }
      if (g.on) {
        const r = glyphRadius(g.level, scale);
        if (Math.abs(r - g.r) > 0.05) {
          g.r = r;
          g.c.setAttribute('r', String(f1(r)));
        }
        g.c.setAttribute('cx', String(f1(g.x)));
        g.c.setAttribute('cy', String(f1(g.y)));
        glyphPts.push([g.x, g.y, g.r + 2]);
        marks.push([g.x - g.r - 2, g.y - g.r - 2, g.x + g.r + 2, g.y + g.r + 2]);
      }
      g.c.style.display = g.on ? '' : 'none';
    }
    // Map scale at the view centre, for the key's specimen.
    const mid = deps.pick(f.width / 2, f.height / 2);
    if (mid) {
      const q = destination(mid.lat, mid.lon, 90, 200);
      if (deps.surface(mid.lat, mid.lon, pt) && deps.surface(q.lat, q.lon, pt2)) pxPerKm = Math.hypot(pt2[0] - pt[0], pt2[1] - pt[1]) / 200;
    }

    // Notes: only once the camera has settled. The place's note goes first, so it gets the open sea nearest
    // the place; the storm's note then finds room round the storm.
    const showNotes = f.settled;
    placeNoted = false;
    const pl = f.place;
    if (showNotes && pl && deps.surface(pl.lat, pl.lon, pt2) && pt2[0] >= 0 && pt2[0] <= f.width && pt2[1] >= 0 && pt2[1] <= f.height) {
      const key = `${pl.lat},${pl.lon}`;
      let detail = placeVerdict.get(key);
      if (detail === undefined) {
        const v = verdict(pl, track, nowMs);
        detail = v.affected ? t('timeline.range', { from: vnTime(v.firstInside!), to: vnTime(v.lastInside!) }) : t('timeline.far', { km: km(v.closest.distanceKm) });
        placeVerdict.set(key, detail);
      }
      setNote(placeNote, pl.label ?? '', detail);
      const stormBox: number[][] = [];
      if (s && deps.surface(s.lat, s.lon, pt)) stormBox.push([pt[0] - 16, pt[1] - 16, pt[0] + 16, pt[1] + 16]);
      placeNoted = fitNote(placeNote, pt2[0], pt2[1], f, [...taken, ...stormBox, ...(windBox ? [windBox] : [])], glyphPts, PLACE_DISTS, lines);
      if (placeNoted) taken.push(placeNote.box!);
    } else placeNote.g.style.display = 'none';
    if (showNotes && s && deps.surface(s.lat, s.lon, pt) && pt[0] >= 0 && pt[0] <= f.width && pt[1] >= 0 && pt[1] <= f.height) {
      const lv = windLevel(s.windKt);
      setNote(stormNote, t('marker.storm'), lv === null ? vnTime(f.timeMs) : `${vnTime(f.timeMs)} · ${t('map.level', { n: lv })}`);
      // The note sits in open sea, clear of the wind area it describes.
      const avoid = windBox ? [...taken, windBox] : taken;
      if (fitNote(stormNote, pt[0], pt[1], f, avoid, glyphPts, STORM_DISTS, null)) taken.push(stormNote.box!);
    } else stormNote.g.style.display = 'none';

    // Date labels, one every 24 h (DESIGN 2): all on one side of the track (left of travel, south on this
    // westward track) at one fixed gap from the dot, switching side only where that side is land and the other
    // is sea. A label that would collide moves out along the same line with a short hairline leader; it is never
    // dropped. The label at the selected time is left to the storm's note, which carries that time.
    let side = 1;
    for (let i = 0; i < glyphs.length; i++) {
      const g = glyphs[i];
      if (!g.label) continue;
      const lead = g.lead!;
      const atNote = stormNote.g.style.display !== 'none' && Math.abs(Date.parse(g.p.t) - f.timeMs) < 3 * 3600 * 1000;
      if (!g.on || atNote) {
        g.label.style.display = 'none';
        lead.style.display = 'none';
        continue;
      }
      if (!g.lw) {
        g.label.style.display = '';
        try {
          const b = g.label.getBBox();
          g.lw = b.width;
          g.lh = b.height;
        } catch {
          g.lw = g.label.textContent!.length * charW();
          g.lh = lineH();
        }
      }
      // Direction of travel on screen, from the neighbouring glyphs.
      const a = glyphs[Math.max(0, i - 1)];
      const b = glyphs[Math.min(glyphs.length - 1, i + 1)];
      let tx = (b.on ? b.x : g.x) - (a.on ? a.x : g.x);
      let ty = (b.on ? b.y : g.y) - (a.on ? a.y : g.y);
      const n = Math.hypot(tx, ty) || 1;
      tx /= n;
      ty /= n;
      // Left of travel on screen (y down).
      const left = [ty, -tx];
      const right = [-ty, tx];
      const landL = seaScore(g, left);
      const landR = seaScore(g, right);
      if (landL !== landR) side = landL < landR ? 1 : -1;
      const order = side === 1 ? [left, right] : [right, left];
      const gap = g.r + 4;
      type Spot = { cx: number; cy: number; extra: number; nx: number; ny: number };
      let placed: Spot | null = null;
      let fallback: Spot | null = null;
      for (const [nx, ny] of order) {
        for (const extra of [0, 12, 20]) {
          const ext = Math.abs(nx) * (g.lw / 2) + Math.abs(ny) * (g.lh / 2);
          const cx = g.x + nx * (gap + extra + ext);
          const cy = g.y + ny * (gap + extra + ext);
          const box = [cx - g.lw / 2 - 1, cy - g.lh / 2, cx + g.lw / 2 + 1, cy + g.lh / 2];
          if (box[0] < 2 || box[1] < 2 || box[2] > f.width - 2 || box[3] > f.height - 2) continue;
          const cand = { cx, cy, extra, nx, ny };
          if (!fallback && nx === order[0][0] && ny === order[0][1] && extra === 20) fallback = cand;
          if (taken.some((t) => overlaps(t, box))) continue;
          if (glyphPts.some(([x, y, r]) => x + r > box[0] && x - r < box[2] && y + r > box[1] && y - r < box[3])) continue;
          placed = cand;
          break;
        }
        if (placed) break;
      }
      placed ??= fallback;
      if (!placed) {
        g.label.style.display = 'none';
        lead.style.display = 'none';
        continue;
      }
      const { cx, cy, extra, nx, ny } = placed;
      taken.push([cx - g.lw / 2 - 1, cy - g.lh / 2, cx + g.lw / 2 + 1, cy + g.lh / 2]);
      g.label.style.display = '';
      g.label.setAttribute('x', String(f1(cx)));
      g.label.setAttribute('y', String(f1(cy + g.lh * 0.32)));
      if (extra > 0) {
        const r0 = g.r + 1.5;
        const r1 = gap + extra - 2;
        lead.setAttribute('d', `M${f1(g.x + nx * r0)},${f1(g.y + ny * r0)}L${f1(g.x + nx * r1)},${f1(g.y + ny * r1)}`);
        lead.style.display = '';
      } else lead.style.display = 'none';
    }
    lastTaken = taken.concat(marks);
  }

  /** 1 when the label centre on that side of the dot is over land. */
  function seaScore(g: { x: number; y: number; r: number; lw: number; lh: number }, [nx, ny]: number[]): number {
    const ext = Math.abs(nx) * (g.lw / 2) + Math.abs(ny) * (g.lh / 2);
    const ll = deps.pick(g.x + nx * (g.r + 4 + ext), g.y + ny * (g.r + 4 + ext));
    return ll && deps.isLand(ll.lat, ll.lon) ? 1 : 0;
  }

  let lastTaken: number[][] = [];

  return {
    update,
    /** Boxes the chart labels and notes took in the last frame (province names keep clear of them). */
    boxes: (): number[][] => lastTaken,
    /** Dot scale (glyph.ts) and px per km at the view centre, from the last map frame. */
    metrics: (): { scale: number; pxPerKm: number } => ({ scale, pxPerKm }),
    /** True when the place is named in its note, so the pin's own name is not repeated. */
    placeNoted: (): boolean => placeNoted,
    dispose(): void {
      svg.remove();
    },
  };
}

export type Chart = ReturnType<typeof createChart>;
