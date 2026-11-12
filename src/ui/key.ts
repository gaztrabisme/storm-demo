// The map key as a worked specimen (DESIGN 2): one real piece of the track around now, drawn with the chart's
// own functions at the map's own scale (storm/glyph.ts): the two past dots, the dot at now inside its wind
// area with the quadrant notches, the forecast rings and the 24-hour 70 % circle. Fine elbow leaders run from
// four of its parts to the existing legend lines. A second group shows the dot sizes for a few wind levels at
// the same scale as the map. No box behind it: the notes carry a halo in the ground colour.
import { CONE, NOW_MS, TRACK } from '../app';
import { t } from '../i18n';
import { circleRing, glyphRadius, keyLevels, windRing } from '../storm/glyph';
import { trackAt, windLevel, type LatLon } from '../storm/verdict';
import { h } from './dom';

const SVGNS = 'http://www.w3.org/2000/svg';
const H6 = 6 * 3600 * 1000;

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, parent?: Element): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  parent?.append(e);
  return e;
}

const f1 = (n: number) => Math.round(n * 10) / 10;

export interface MapMetrics {
  scale: number;
  pxPerKm: number;
}

export function mapKey(): { el: HTMLElement; coneLegend: HTMLElement; setMetrics(m: MapMetrics): void } {
  const note = (text: string, cls: string, test?: string) => h('p', { class: `key__note ${cls}`, ...(test ? { test } : {}), text });
  const forecast = note(t('map.forecast'), 'key__note--tl');
  const past = note(t('map.past'), 'key__note--tr');
  const coneLegend = note(t('cone.legend'), 'key__note--bl', 'cone-legend');
  const wind = note(t('map.wind'), 'key__note--br');
  const stage = h('div', { class: 'key__stage', 'aria-hidden': 'true' });
  const sizes = h('div', { class: 'key__sizes', 'aria-hidden': 'true' });
  const draw = svgEl('svg', { class: 'key__draw', 'aria-hidden': 'true', focusable: 'false' });
  const el = h('figure', { class: 'key' }, draw as unknown as Node, forecast, past, stage, coneLegend, wind, sizes);

  let metrics: MapMetrics = { scale: 1, pxPerKm: 0.25 };

  // The real records: 12 h before now to 24 h after, the wind area at now, the 24-hour circle.
  const at = (ms: number) => trackAt(TRACK, ms);
  const now = at(NOW_MS);
  const glyphTimes = [-2, -1, 0, 1, 2, 3, 4].map((k) => NOW_MS + k * H6);
  const lineTimes: number[] = [];
  for (let ms = NOW_MS - 2 * H6; ms <= NOW_MS + 4 * H6; ms += H6 / 2) lineTimes.push(ms);
  const cone24 = CONE.find((c) => c.hours === 24) ?? CONE[0];

  /** Local projection around now: x east, y south, in px at the map's scale. */
  const proj = (p: LatLon): [number, number] => {
    const k = metrics.pxPerKm;
    const c = Math.cos((now!.lat * Math.PI) / 180);
    return [(p.lon - now!.lon) * c * 111.32 * k, -(p.lat - now!.lat) * 110.57 * k];
  };

  function sizeRow(): void {
    sizes.replaceChildren();
    for (const l of keyLevels(TRACK)) {
      const r = glyphRadius(l, metrics.scale);
      const d = Math.ceil(r * 2 + 2);
      const s = svgEl('svg', { width: d, height: d, viewBox: `${-d / 2} ${-d / 2} ${d} ${d}` });
      svgEl('circle', { class: 'key__dot', r: f1(r) }, s);
      sizes.append(h('span', { class: 'key__size' }, s as unknown as Node, h('span', { text: t('map.level', { n: l }) })));
    }
  }

  function render(): void {
    const W = el.clientWidth;
    const Hh = el.clientHeight;
    if (!W || !now) return;
    draw.setAttribute('width', String(W));
    draw.setAttribute('height', String(Hh));
    draw.setAttribute('viewBox', `0 0 ${W} ${Hh}`);
    draw.replaceChildren();

    // Geometry in local px, then its box, then placed in the stage centre.
    const ring = windRing(now)?.map(proj) ?? [];
    const cone = circleRing(cone24.lat, cone24.lon, cone24.radiusKm).map(proj);
    const line = lineTimes.map((ms) => at(ms)).filter((s): s is NonNullable<typeof s> => !!s);
    const glyphs = glyphTimes.map((ms) => ({ ms, s: at(ms) })).filter((g) => !!g.s);
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const [x, y] of [...ring, ...cone, ...line.map(proj)]) {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
    const sh = Math.ceil(y1 - y0 + 12);
    if (stage.offsetHeight !== sh) {
      stage.style.height = `${sh}px`;
      return; // the resize observer draws again at the new height
    }
    const ox = W / 2 - (x0 + x1) / 2;
    const oy = stage.offsetTop + 6 - y0;
    const P = (p: LatLon): [number, number] => {
      const [x, y] = proj(p);
      return [x + ox, y + oy];
    };
    const path = (pts: Array<[number, number]>, close = false) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${f1(x)},${f1(y)}`).join('') + (close ? 'Z' : '');

    const g = svgEl('g', {}, draw);
    svgEl('path', { class: 'key__cone', d: path(circleRing(cone24.lat, cone24.lon, cone24.radiusKm).map(P), true) }, g);
    const windPts = windRing(now)?.map(P);
    if (windPts) svgEl('path', { class: 'key__wind', d: path(windPts, true) }, g);
    const pastLine = line.filter((s) => s.ms <= NOW_MS).map(P);
    const foreLine = line.filter((s) => s.ms >= NOW_MS).map(P);
    svgEl('path', { class: 'key__track', d: path(pastLine) }, g);
    svgEl('path', { class: 'key__track key__track--forecast', d: path(foreLine) }, g);
    const pos = new Map<number, { x: number; y: number; r: number }>();
    for (const { ms, s } of glyphs) {
      const level = windLevel(s!.windKt);
      const r = glyphRadius(level, metrics.scale);
      const [x, y] = P(s!);
      pos.set(ms, { x, y, r });
      svgEl('circle', { class: `key__glyph key__glyph--${ms <= NOW_MS ? 'past' : 'forecast'}`, cx: f1(x), cy: f1(y), r: f1(r) }, g);
    }

    // Leaders: from a part, straight up or down to the note's line, then across to the note's edge.
    const box = (n: HTMLElement) => ({ l: n.offsetLeft, r: n.offsetLeft + n.offsetWidth, t: n.offsetTop, b: n.offsetTop + n.offsetHeight });
    const lineH = (n: HTMLElement) => parseFloat(getComputedStyle(n).lineHeight) || 18;
    const leader = (px: number, py: number, n: HTMLElement, up: boolean) => {
      const b = box(n);
      const ty = up ? b.b - lineH(n) / 2 : b.t + lineH(n) / 2;
      let d: string;
      if (px >= b.l - 4 && px <= b.r + 4) d = `M${f1(px)},${f1(py)}V${f1(up ? b.b + 3 : b.t - 3)}`;
      else d = `M${f1(px)},${f1(py)}V${f1(ty)}H${f1(px < b.l ? b.l - 5 : b.r + 5)}`;
      svgEl('path', { class: 'key__leader', d }, draw);
      svgEl('circle', { class: 'key__leader-dot', cx: f1(px), cy: f1(py), r: 1.8 }, draw);
    };
    const p12 = pos.get(NOW_MS - 2 * H6);
    if (p12) leader(p12.x, p12.y - p12.r - 2, past, true);
    const f12 = pos.get(NOW_MS + 2 * H6);
    if (f12) leader(f12.x, f12.y - f12.r - 2, forecast, true);
    if (windPts) {
      // The wind area's south-east edge (bearing 135 deg, the middle of the second quarter arc).
      const [wx, wy] = windPts[19 + 9];
      leader(wx, wy + 2, wind, false);
    }
    const [cx, cy] = P(circleRing(cone24.lat, cone24.lon, cone24.radiusKm)[36]);
    leader(cx, cy + 2, coneLegend, false);
  }

  const ro = new ResizeObserver(() => render());
  ro.observe(el);
  sizeRow();
  return {
    el,
    coneLegend,
    setMetrics(m: MapMetrics) {
      if (Math.abs(m.scale - metrics.scale) < 0.01 && Math.abs(m.pxPerKm - metrics.pxPerKm) < 0.001) return;
      metrics = { scale: m.scale, pxPerKm: m.pxPerKm };
      sizeRow();
      render();
    },
  };
}
