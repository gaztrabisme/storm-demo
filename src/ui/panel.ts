// Main panel (SPEC 6.3): storm summary, check button, province picker, verdict card, timeline, knowledge cards.
// Also the full-mode time slider (SPEC 6.2).
import { FIRST_MS, LAST_MS, NOW_MS, PROVINCES, STEP_3H, TRACK, placeInSentence, type Actions } from '../app';
import { lookup, t, tList } from '../i18n';
import { logEvent } from '../log';
import { modeOf, type Place, type Store } from '../state';
import { km, vnDay, vnTime } from '../storm/format';
import { timeline, trackAt, windLevel, type Verdict } from '../storm/verdict';
import { h, nextId } from './dom';

const SVGNS = 'http://www.w3.org/2000/svg';
const H24 = 24 * 3600 * 1000;
/** Vietnam midnights (UTC+7) from a to b. */
function vnMidnights(a: number, b: number): number[] {
  const out: number[] = [];
  const off = 7 * 3600 * 1000;
  for (let ms = Math.ceil((a + off) / H24) * H24 - off; ms <= b; ms += H24) out.push(ms);
  return out;
}
function svg(cls: string, attrs: Record<string, string> = {}): SVGSVGElement {
  const e = document.createElementNS(SVGNS, 'svg');
  e.setAttribute('class', cls);
  e.setAttribute('aria-hidden', 'true');
  e.setAttribute('focusable', 'false');
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}
function svgChild(parent: Element, tag: string, attrs: Record<string, string | number>): SVGElement {
  const e = document.createElementNS(SVGNS, tag) as SVGElement;
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  parent.append(e);
  return e;
}
const pct = (n: number) => `${Math.round(n * 10000) / 100}%`;

export function timeSlider(store: Store, actions: Actions): HTMLElement {
  const steps = Math.round((LAST_MS - FIRST_MS) / STEP_3H);
  const id = nextId('slider');
  const indexOf = (ms: number) => Math.round((ms - FIRST_MS) / STEP_3H);
  const readout = h('output', { test: 'time-readout', class: 'slider__readout', for: id, text: vnTime(store.state.timeMs) });
  const input = h('input', {
    test: 'time-slider',
    id,
    type: 'range',
    min: 0,
    max: steps,
    step: 1,
    value: indexOf(store.state.timeMs),
    'aria-label': t('slider.label'),
    oninput: () => actions.setTime(FIRST_MS + Number(input.value) * STEP_3H),
  });
  // The slider drawn as the chart's time axis (DESIGN 1, 2): a 2 px ink line, solid up to now and dotted after
  // it like the track, a tick at each midnight and the date every other day, in the map's date style. The native
  // range input sits on top with a transparent track, so its thumb rides the axis.
  const axis = svg('slider__axis');
  const span = LAST_MS - FIRST_MS;
  const nowX = (NOW_MS - FIRST_MS) / span;
  svgChild(axis, 'line', { class: 'slider__past', x1: '0%', x2: pct(nowX), y1: 22, y2: 22 });
  svgChild(axis, 'line', { class: 'slider__forecast', x1: pct(nowX), x2: '100%', y1: 22, y2: 22 });
  vnMidnights(FIRST_MS, LAST_MS).forEach((ms, i) => {
    const x = pct((ms - FIRST_MS) / span);
    svgChild(axis, 'line', { class: 'slider__tick', x1: x, x2: x, y1: 17, y2: 27 });
    if (i % 2 === 0) svgChild(axis, 'text', { class: 'slider__date', x, y: 42 }).textContent = vnDay(ms);
  });
  const track = h('div', { class: 'slider__track' }, axis as unknown as Node, input);
  const el = h('div', { class: 'slider full-only' }, h('label', { class: 'slider__label', for: id, text: t('slider.label') }), track, readout);
  store.subscribe((s, prev) => {
    if (s.timeMs === prev.timeMs) return;
    readout.textContent = vnTime(s.timeMs);
    const i = indexOf(s.timeMs);
    if (Number(input.value) !== i) input.value = String(i);
    input.setAttribute('aria-valuetext', vnTime(s.timeMs));
  });
  return el;
}

export function stormSummary(): HTMLElement {
  const s = trackAt(TRACK, NOW_MS);
  return h('p', { test: 'storm-summary', class: 'summary', text: t('summary.text', { time: vnTime(NOW_MS), n: windLevel(s?.windKt ?? null) ?? '' }) });
}

/** Sort key for the province list: "TP. Hồ Chí Minh" is filed under H, by its name, not its title. */
const sortName = (name: string): string => name.replace(/^TP\.\s*/, '');

export function checkBlock(store: Store, actions: Actions): HTMLElement {
  const btn = h('button', { test: 'btn-check', class: 'btn btn--primary btn--big', type: 'button', text: t('check.button'), onclick: () => actions.runCheck() });
  const status = h('p', { class: 'status', role: 'status', 'aria-live': 'polite' });
  const selectId = nextId('province');
  const select = h(
    'select',
    { id: selectId, onchange: () => select.value && actions.pickProvince(select.value) },
    h('option', { value: '', text: t('picker.placeholder') }),
    ...[...PROVINCES].sort((a, b) => sortName(a.name).localeCompare(sortName(b.name), 'vi')).map((p) => h('option', { value: p.id, text: p.name })),
  );
  const line = h('label', { for: selectId, class: 'picker__line' });
  const picker = h('div', { test: 'province-picker', class: 'picker', hidden: true }, line, select);
  const render = () => {
    const s = store.state;
    status.textContent = s.locating ? t('check.locating') : '';
    picker.hidden = s.picker === 'hidden';
    line.textContent = s.picker === 'failed' ? t('picker.failed') : t('picker.label');
  };
  store.subscribe((s, prev) => {
    if (s.locating !== prev.locating || s.picker !== prev.picker) {
      render();
      if (s.picker !== 'hidden' && prev.picker === 'hidden') {
        select.value = '';
        select.focus({ preventScroll: true });
        picker.scrollIntoView({ block: 'nearest' });
      }
    }
  });
  render();
  return h('div', { class: 'check' }, btn, status, picker);
}

function actionsList(): HTMLOListElement {
  return h('ol', { test: 'verdict-actions', class: 'actions' }, ...tList('actions.items').map((a) => h('li', { text: a })));
}

export function verdictCard(store: Store, actions: Actions): HTMLElement {
  const el = h('section', { test: 'verdict', class: 'verdict', hidden: true });
  // Announces only the answer (heading and time). Always rendered, so the first verdict is read out too.
  const live = h('p', { class: 'sr-only', role: 'status' });
  let liveTimer = 0;
  const announce = (s: string) => {
    live.textContent = '';
    window.clearTimeout(liveTimer);
    liveTimer = window.setTimeout(() => (live.textContent = s), 100);
  };
  const render = (v: Verdict, p: Place) => {
    const label = p.label;
    const inside = placeInSentence(p);
    el.dataset.affected = String(v.affected);
    const body: Node[] = [];
    if (v.affected) {
      body.push(
        h('h2', { test: 'verdict-head', class: 'verdict__head', text: t('verdict.headAffected', { place: inside }) }),
        h('p', { test: 'verdict-when', class: 'verdict__when', text: t('verdict.when', { from: vnTime(v.firstInside!), to: vnTime(v.lastInside!) }) }),
      );
      const n = windLevel(v.peakWindKt);
      if (n !== null) body.push(h('p', { test: 'verdict-wind', class: 'verdict__wind', text: t('verdict.wind', { n }) }));
      body.push(h('h3', { class: 'verdict__sub', text: t('verdict.actionsAffected') }));
    } else {
      body.push(
        h('h2', { test: 'verdict-head', class: 'verdict__head', text: t('verdict.headUnaffected', { place: label }) }),
        h('p', { test: 'verdict-when', class: 'verdict__when', text: t('verdict.closest', { place: inside, km: km(v.closest.distanceKm), time: vnTime(v.closest.time) }) }),
        h('p', { test: 'verdict-note', class: 'verdict__note', text: t('verdict.note') }),
        h('h3', { class: 'verdict__sub', text: t('verdict.actionsUnaffected') }),
      );
    }
    body.push(
      actionsList(),
      h('p', { test: 'verdict-source', class: 'source', text: t('actions.source') }),
      h('button', { test: 'btn-recheck', class: 'btn', type: 'button', text: t('verdict.recheck'), onclick: () => actions.openPicker() }),
    );
    el.replaceChildren(...body);
    el.hidden = false;
    announce(`${body[0].textContent ?? ''}. ${body[1].textContent ?? ''}`);
  };
  store.subscribe((s, prev) => {
    if (s.verdict === prev.verdict) return;
    if (s.verdict && s.place) {
      render(s.verdict, s.place);
      el.scrollIntoView({ block: 'nearest' });
    } else el.hidden = true;
  });
  return h('div', { class: 'verdict-host' }, live, el);
}

/**
 * The province list as spans on one time axis (DESIGN 1: the panel is the chart's caption column): each row
 * keeps its name and its dates, and under them a thin bar from when wind of level 8 or more reaches the province
 * to when it leaves, on an axis shared by every row (now minus 12 h to the track's last point), with a hairline
 * at the slider's time. A province the wind does not reach keeps the bare axis.
 */
export function timelineList(store: Store, actions: Actions): HTMLElement {
  const rows = timeline(PROVINCES, TRACK, NOW_MS);
  const t0 = NOW_MS - H24 / 2;
  const t1 = LAST_MS;
  const xOf = (ms: number) => Math.max(0, Math.min(1, (ms - t0) / (t1 - t0)));
  const days = vnMidnights(t0, t1).map((ms) => pct(xOf(ms)));
  const nowTicks: SVGElement[] = [];
  const list = h('ol', { class: 'timeline__list' });
  let subheaded = false;
  for (const r of rows) {
    const v = r.verdict;
    // SPEC 6.3: the unaffected rows come under their own sub-heading.
    if (!v.affected && !subheaded) {
      subheaded = true;
      list.append(h('li', { class: 'timeline__group' }, h('h3', { class: 'timeline__sub', text: t('timeline.unaffected') })));
    }
    const detail = v.affected ? t('timeline.range', { from: vnTime(v.firstInside!), to: vnTime(v.lastInside!) }) : t('timeline.far', { km: km(v.closest.distanceKm) });
    const bar = svg('timeline__bar');
    svgChild(bar, 'line', { class: 'timeline__base', x1: '0%', x2: '100%', y1: 6.5, y2: 6.5 });
    for (const x of days) svgChild(bar, 'line', { class: 'timeline__day', x1: x, x2: x, y1: 4.5, y2: 8.5 });
    if (v.affected) {
      const a = xOf(Date.parse(v.firstInside!));
      const b = xOf(Date.parse(v.lastInside!));
      svgChild(bar, 'rect', { class: 'timeline__span', x: pct(a), width: pct(Math.max(0.004, b - a)), y: 3.5, height: 6 });
    }
    nowTicks.push(svgChild(bar, 'line', { class: 'timeline__now', y1: 0, y2: 13 }));
    list.append(
      h(
        'li',
        {},
        h(
          'button',
          { test: 'timeline-row', class: 'timeline__row', type: 'button', 'data-affected': String(v.affected), onclick: () => actions.pickProvince(r.id) },
          h('span', { class: 'timeline__name', text: r.province.name }),
          ' ',
          h('span', { class: 'timeline__detail', text: detail }),
          bar as unknown as Node,
        ),
      ),
    );
  }
  const setNow = (ms: number) => {
    const inside = ms >= t0 && ms <= t1;
    const x = pct(xOf(ms));
    for (const l of nowTicks) {
      l.setAttribute('x1', x);
      l.setAttribute('x2', x);
      l.style.display = inside ? '' : 'none';
    }
  };
  setNow(store.state.timeMs);
  store.subscribe((s, prev) => {
    if (s.timeMs !== prev.timeMs) setNow(s.timeMs);
  });
  return h('section', { test: 'timeline', class: 'timeline full-only' }, h('h2', { class: 'panel__h', text: t('timeline.title') }), list);
}

interface SafetySection {
  heading: string;
  items: string[];
}

function card(id: string, body: Node[]): HTMLDetailsElement {
  const title = t(`cards.${id}.title`);
  const d = h('details', { class: 'card', open: true });
  const summary = h('summary', { class: 'card__title', text: title, onclick: () => !d.open && logEvent('learn_open', { card: id }) });
  d.append(summary, ...body, h('p', { test: 'learn-source', class: 'source', text: t(`cards.${id}.source`) }));
  return d;
}

export function learnBlock(store: Store): HTMLElement {
  const para = (s: string) => h('p', { text: s });
  const sections = (lookup('cards.safety.sections') as unknown as SafetySection[]) ?? [];
  const cards = [
    card('wind', tList('cards.wind.body').map(para)),
    card('radius', tList('cards.radius.body').map(para)),
    card(
      'safety',
      sections.flatMap((s) => [h('h4', { class: 'card__h', text: s.heading }), h('ul', {}, ...s.items.map((i) => h('li', { text: i })))]),
    ),
  ];
  const el = h('section', { test: 'learn', class: 'learn' });
  const more = h('details', { class: 'learn__more' });
  const moreSummary = h('summary', { class: 'learn__summary', text: t('learn.more'), onclick: () => !more.open && logEvent('learn_open', { card: 'all' }) });
  const render = () => {
    if (modeOf(store.state) === 'easy') {
      more.replaceChildren(moreSummary, ...cards);
      el.replaceChildren(more);
    } else el.replaceChildren(...cards);
  };
  store.subscribe((s, prev) => {
    if (modeOf(s) !== modeOf(prev)) render();
  });
  render();
  return el;
}
