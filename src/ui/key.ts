// The map key as a worked specimen (DESIGN 2): a short piece of the real track drawn with the chart's own
// glyph sizes, each part joined by a fine leader to the existing legend line that explains it, and the dot
// sizes for a few wind levels at true size. Texts are the approved map and circle legend strings.
import { NOW_MS, TRACK } from '../app';
import { t } from '../i18n';
import { glyphRadius, keyLevels } from '../storm/glyph';
import { trackAt, windLevel } from '../storm/verdict';
import { h } from './dom';

const SVGNS = 'http://www.w3.org/2000/svg';
const H24 = 24 * 3600 * 1000;

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, parent?: Element): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  parent?.append(e);
  return e;
}

/** Wind level of the track 24 h before and after now: the real records the specimen shows. */
const levelAt = (ms: number) => windLevel(trackAt(TRACK, ms)?.windKt ?? null);

export function mapKey(): { el: HTMLElement; coneLegend: HTMLElement } {
  const note = (text: string, test?: string) => h('p', { class: 'key__note', ...(test ? { test } : {}), text });
  const past = note(t('map.past'));
  const forecast = note(t('map.forecast'));
  const wind = note(t('map.wind'));
  const coneLegend = note(t('cone.legend'), 'cone-legend');
  const notes = h('div', { class: 'key__notes' }, past, forecast, wind, coneLegend);

  const W = 52;
  const X = 16;
  const spec = svgEl('svg', { class: 'key__spec', width: W, 'aria-hidden': 'true', focusable: 'false' });

  const sizes = h('div', { class: 'key__sizes', 'aria-hidden': 'true' });
  for (const l of keyLevels(TRACK)) {
    const r = glyphRadius(l);
    const s = svgEl('svg', { width: 18, height: 18, viewBox: '-9 -9 18 18' });
    svgEl('circle', { class: 'key__dot', r: r.toFixed(1) }, s);
    sizes.append(h('span', { class: 'key__size' }, s as unknown as Node, h('span', { text: t('map.level', { n: l }) })));
  }

  const el = h('figure', { class: 'key' }, h('div', { class: 'key__field' }, spec as unknown as Node, notes), sizes);

  const rPast = glyphRadius(levelAt(NOW_MS - H24));
  const rFore = glyphRadius(levelAt(NOW_MS + H24));
  const rNow = glyphRadius(levelAt(NOW_MS));

  /** Draw the specimen so each part sits level with the first line of its note. */
  function draw(): void {
    const top = notes.getBoundingClientRect().top;
    const height = notes.offsetHeight;
    if (!height) return;
    const ys = [past, forecast, wind, coneLegend].map((n) => {
      const lh = parseFloat(getComputedStyle(n).lineHeight) || 18;
      return Math.round(n.getBoundingClientRect().top - top + lh / 2) + 0.5;
    });
    spec.setAttribute('height', String(height));
    spec.setAttribute('viewBox', `0 0 ${W} ${height}`);
    spec.replaceChildren();
    const [y0, y1, y2, y3] = ys;
    const split = (y0 + y1) / 2;
    // The track: solid while past, dotted for the forecast.
    svgEl('path', { class: 'key__track key__track--past', d: `M${X},${Math.max(1, y0 - 12)}V${split}` }, spec);
    svgEl('path', { class: 'key__track key__track--forecast', d: `M${X},${split}V${y3}` }, spec);
    // Wind area at the storm's position (pale fill, fine edge), with the storm's own dot.
    svgEl('circle', { class: 'key__wind', cx: X, cy: y2, r: 11 }, spec);
    svgEl('circle', { class: 'key__glyph key__glyph--past', cx: X, cy: y2, r: rNow.toFixed(1) }, spec);
    // 70 % circle: dotted, around a forecast position.
    svgEl('circle', { class: 'key__cone', cx: X, cy: y3, r: 13 }, spec);
    svgEl('circle', { class: 'key__glyph key__glyph--forecast', cx: X, cy: y3, r: rFore.toFixed(1) }, spec);
    svgEl('circle', { class: 'key__glyph key__glyph--past', cx: X, cy: y0, r: rPast.toFixed(1) }, spec);
    svgEl('circle', { class: 'key__glyph key__glyph--forecast', cx: X, cy: y1, r: rFore.toFixed(1) }, spec);
    // Leaders from each part to its note.
    const reach = [rPast, rFore, 11, 13];
    ys.forEach((y, i) => svgEl('path', { class: 'key__leader', d: `M${X + reach[i] + 3},${y}H${W}` }, spec));
  }

  const ro = new ResizeObserver(() => draw());
  ro.observe(notes);
  return { el, coneLegend };
}
