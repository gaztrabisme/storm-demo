// The map key as a worked specimen (DESIGN 2): one real piece of the track around now, drawn with the chart's
// own functions at the map's own scale (storm/glyph.ts): past dots, the dot at now inside its wind area with
// the quadrant notches, the forecast rings and the 24-hour 70 % circle. Its four notes stand in one
// left-aligned italic column to the right of the glyph, each joined by a fine leader that ends in a small open
// dot on the part it names. The column runs top to bottom in the order the parts sit on the glyph, so no two
// leaders cross: the forecast ring's leader rises above the glyph, the wind area's upper edge and the oldest
// past dot reach their notes by straight horizontal hairlines, and the 70 % circle's leader drops below the
// wind area. The dot sizes for a few wind levels, at the map's scale, sit under the column. No box behind it:
// the notes carry a halo in the ground colour.
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
  const note = (text: string, test?: string) => h('p', { class: 'key__note', ...(test ? { test } : {}), text });
  const forecast = note(t('map.forecast'));
  const wind = note(t('map.wind'));
  const past = note(t('map.past'));
  const coneLegend = note(t('cone.legend'), 'cone-legend');
  const order = [forecast, wind, past, coneLegend];
  const notes = h('div', { class: 'key__notes' }, ...order);
  const stage = h('div', { class: 'key__stage', 'aria-hidden': 'true' });
  const sizes = h('div', { class: 'key__sizes', 'aria-hidden': 'true' });
  const draw = svgEl('svg', { class: 'key__draw', 'aria-hidden': 'true', focusable: 'false' });
  const el = h('figure', { class: 'key' }, draw as unknown as Node, stage, notes, sizes);

  let metrics: MapMetrics = { scale: 1, pxPerKm: 0.25 };

  // The real records: 18 h before now to 24 h after, the wind area at now, the 24-hour circle.
  const at = (ms: number) => trackAt(TRACK, ms);
  const now = at(NOW_MS);
  const glyphTimes = [-3, -2, -1, 0, 1, 2, 3, 4].map((k) => NOW_MS + k * H6);
  const lineTimes: number[] = [];
  for (let ms = NOW_MS - 3 * H6; ms <= NOW_MS + 4 * H6; ms += H6 / 2) lineTimes.push(ms);
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
    if (!W || !now) return;
    draw.replaceChildren();

    // Geometry in local px, then its box.
    const ring = windRing(now)?.map(proj) ?? [];
    const coneRing = circleRing(cone24.lat, cone24.lon, cone24.radiusKm);
    const line = lineTimes.map((ms) => at(ms)).filter((s): s is NonNullable<typeof s> => !!s);
    const glyphs = glyphTimes.map((ms) => ({ ms, s: at(ms) })).filter((g) => !!g.s);
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    const grow = (x: number, y: number, r = 0) => {
      x0 = Math.min(x0, x - r);
      y0 = Math.min(y0, y - r);
      x1 = Math.max(x1, x + r);
      y1 = Math.max(y1, y + r);
    };
    for (const [x, y] of [...ring, ...coneRing.map(proj), ...line.map(proj)]) grow(x, y);
    for (const { s } of glyphs) {
      const [x, y] = proj(s!);
      grow(x, y, glyphRadius(windLevel(s!.windKt), metrics.scale));
    }
    // Room above the glyph for the first note's leader to run across, clear of the wind area.
    const lh = parseFloat(getComputedStyle(wind).lineHeight) || 18;
    const head = Math.ceil(lh + 10);
    const sw = Math.ceil(x1 - x0 + 12);
    const sh = Math.ceil(y1 - y0 + 12) + head;
    // Reading the offsets below lays the figure out again at the new stage size.
    stage.style.width = `${sw}px`;
    stage.style.height = `${sh}px`;
    const ox = stage.offsetLeft + 6 - x0;
    const oy = stage.offsetTop + head + 6 - y0;
    const P = (p: LatLon): [number, number] => {
      const [x, y] = proj(p);
      return [x + ox, y + oy];
    };
    const path = (pts: Array<[number, number]>, close = false) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${f1(x)},${f1(y)}`).join('') + (close ? 'Z' : '');

    const g = svgEl('g', {}, draw);
    const conePts = coneRing.map(P);
    svgEl('path', { class: 'key__cone', d: path(conePts, true) }, g);
    const windPts = windRing(now)?.map(P);
    if (windPts) svgEl('path', { class: 'key__wind', d: path(windPts, true) }, g);
    svgEl('path', { class: 'key__track', d: path(line.filter((s) => s.ms <= NOW_MS).map(P)) }, g);
    svgEl('path', { class: 'key__track key__track--forecast', d: path(line.filter((s) => s.ms >= NOW_MS).map(P)) }, g);
    const pos = new Map<number, { x: number; y: number; r: number }>();
    for (const { ms, s } of glyphs) {
      const r = glyphRadius(windLevel(s!.windKt), metrics.scale);
      const [x, y] = P(s!);
      pos.set(ms, { x, y, r });
      svgEl('circle', { class: `key__glyph key__glyph--${ms <= NOW_MS ? 'past' : 'forecast'}`, cx: f1(x), cy: f1(y), r: f1(r) }, g);
    }

    // Anchors, top to bottom in the order of the notes: the top of a forecast ring (its note sits above the
    // glyph), the wind area's upper-right edge, the oldest past dot's east side, the bottom of the 70 % circle
    // (its note sits below the wind area).
    const windBottom = windPts ? Math.max(...windPts.map((p) => p[1])) : oy + y1;
    const anchors: Array<[number, number] | null> = [null, null, null, null];
    const f12 = pos.get(NOW_MS + 2 * H6);
    if (f12) anchors[0] = [f12.x, f12.y - f12.r - 1.5];
    if (windPts) anchors[1] = windPts[10]; // bearing 50 degrees, in the first quarter arc
    const p18 = pos.get(NOW_MS - 3 * H6);
    if (p18) anchors[2] = [p18.x + p18.r + 1.5, p18.y];
    anchors[3] = conePts[36]; // bearing 180

    for (const n of order) n.style.marginTop = '0px';
    let prevBottom = -Infinity;
    order.forEach((n, i) => {
      const a = anchors[i];
      let want = i === 0 ? stage.offsetTop + lh / 2 : a ? a[1] : prevBottom + 10 + lh / 2;
      if (i === 3) want = Math.max(want, windBottom + 10 + lh / 2);
      want = Math.max(want, prevBottom + 8 + lh / 2);
      const top = n.offsetTop;
      const m = Math.max(0, want - lh / 2 - top);
      n.style.marginTop = `${f1(m)}px`;
      prevBottom = n.offsetTop + n.offsetHeight;
    });

    // Leaders: from the part, straight across when its note is level with it, otherwise up or down, then across.
    const colX = notes.offsetLeft - 6;
    order.forEach((n, i) => {
      const a = anchors[i];
      if (!a) return;
      const [ax, ay] = a;
      const ny = n.offsetTop + lh / 2;
      const d = Math.abs(ny - ay) < 1 ? `M${f1(ax)},${f1(ay)}H${f1(colX)}` : `M${f1(ax)},${f1(ay)}V${f1(ny)}H${f1(colX)}`;
      svgEl('path', { class: 'key__leader', d }, draw);
      svgEl('circle', { class: 'key__leader-dot', cx: f1(ax), cy: f1(ay), r: 1.8 }, draw);
    });

    const Hh = el.clientHeight;
    draw.setAttribute('width', String(W));
    draw.setAttribute('height', String(Hh));
    draw.setAttribute('viewBox', `0 0 ${W} ${Hh}`);
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
