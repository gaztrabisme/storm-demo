// Main panel (SPEC 6.3): storm summary, check button, province picker, verdict card, timeline, knowledge cards.
// Also the full-mode time slider (SPEC 6.2).
import { FIRST_MS, LAST_MS, NOW_MS, PROVINCES, STEP_3H, TRACK, type Actions } from '../app';
import { lookup, t, tList } from '../i18n';
import { logEvent } from '../log';
import { modeOf, type Store } from '../state';
import { km, vnTime } from '../storm/format';
import { timeline, trackAt, windLevel, type Verdict } from '../storm/verdict';
import { h, nextId } from './dom';

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
  const el = h('div', { class: 'slider full-only' }, h('label', { class: 'slider__label', for: id, text: t('slider.label') }), input, readout);
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
  return h('p', { test: 'storm-summary', class: 'summary', text: t('summary.text', { name: TRACK.name, n: windLevel(s?.windKt ?? null) ?? '' }) });
}

export function checkBlock(store: Store, actions: Actions): HTMLElement {
  const btn = h('button', { test: 'btn-check', class: 'btn btn--primary btn--big', type: 'button', text: t('check.button'), onclick: () => actions.runCheck() });
  const status = h('p', { class: 'status', role: 'status', 'aria-live': 'polite' });
  const selectId = nextId('province');
  const select = h(
    'select',
    { id: selectId, onchange: () => select.value && actions.pickProvince(select.value) },
    h('option', { value: '', text: t('picker.placeholder') }),
    ...[...PROVINCES].sort((a, b) => a.name.localeCompare(b.name, 'vi')).map((p) => h('option', { value: p.id, text: p.name })),
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
  const el = h('section', { test: 'verdict', class: 'verdict', hidden: true, 'aria-live': 'polite' });
  const render = (v: Verdict, label: string) => {
    el.dataset.affected = String(v.affected);
    const body: Node[] = [];
    if (v.affected) {
      body.push(
        h('h2', { test: 'verdict-head', class: 'verdict__head', text: t('verdict.headAffected', { place: label }) }),
        h('p', { test: 'verdict-when', class: 'verdict__when', text: t('verdict.when', { from: vnTime(v.firstInside!), to: vnTime(v.lastInside!) }) }),
      );
      const n = windLevel(v.peakWindKt);
      if (n !== null) body.push(h('p', { test: 'verdict-wind', class: 'verdict__wind', text: t('verdict.wind', { n }) }));
      body.push(h('h3', { class: 'verdict__sub', text: t('verdict.actionsAffected') }));
    } else {
      body.push(
        h('h2', { test: 'verdict-head', class: 'verdict__head', text: t('verdict.headUnaffected', { place: label }) }),
        h('p', { test: 'verdict-when', class: 'verdict__when', text: t('verdict.closest', { place: label, km: km(v.closest.distanceKm), time: vnTime(v.closest.time) }) }),
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
  };
  store.subscribe((s, prev) => {
    if (s.verdict === prev.verdict) return;
    if (s.verdict && s.place) {
      render(s.verdict, s.place.label);
      el.scrollIntoView({ block: 'nearest' });
    } else el.hidden = true;
  });
  return el;
}

export function timelineList(actions: Actions): HTMLElement {
  const rows = timeline(PROVINCES, TRACK, NOW_MS);
  const list = h('ol', { class: 'timeline__list' });
  for (const r of rows) {
    const v = r.verdict;
    const detail = v.affected ? t('timeline.range', { from: vnTime(v.firstInside!), to: vnTime(v.lastInside!) }) : t('timeline.far', { km: km(v.closest.distanceKm) });
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
        ),
      ),
    );
  }
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
