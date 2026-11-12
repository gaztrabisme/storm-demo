// Satellite info panel (SPEC 6.7, approved text SPEC 10.4).
import { reducedMotion, type Actions } from '../app';
import { t, tList } from '../i18n';
import type { Store } from '../state';
import { createFigure, talkMs } from '../assistant/figure';
import { h } from './dom';

/** The flight out lasts 0.82 s (scene/boot.ts); a little margin. */
const FLIGHT_MS = 950;

export function satelliteInfo(store: Store, actions: Actions): HTMLElement {
  const back = h('button', { test: 'btn-back', class: 'btn', type: 'button', text: t('satellite.back'), onclick: () => actions.closeSatellite() });
  const head = h('h2', { class: 'panel__h', id: 'sat-head', text: t('satellite.heading') });
  // SPEC 6.8: on the first visit only, Usui-chan looks up at the satellite and talks.
  const figure = createFigure('assistant-figure--satellite');
  figure.el.hidden = true;
  let visited = false;
  let showTimer = 0;
  const el = h(
    'section',
    { test: 'satellite-info', class: 'satinfo', hidden: true, 'aria-labelledby': 'sat-head' },
    h('div', { class: 'satinfo__top' }, back, figure.el),
    head,
    h('ul', { class: 'satinfo__facts' }, ...tList('satellite.facts').map((f) => h('li', { text: f }))),
    h('p', { class: 'source', text: t('satellite.source') }),
  );
  // Focus goes to btn-back on the way in and back to the control that opened the view on the way out.
  let opener: HTMLElement | null = null;
  const shown = (e: HTMLElement | null): e is HTMLElement => !!e && e.isConnected && e.getClientRects().length > 0;
  store.subscribe((s, prev) => {
    if (s.view === prev.view) return;
    el.hidden = s.view !== 'satellite';
    if (s.view === 'satellite') {
      // She appears once the flight has landed (0.82 s), so drawing her does not slow the flight.
      if (!visited) {
        window.clearTimeout(showTimer);
        showTimer = window.setTimeout(() => {
          if (store.state.view !== 'satellite') return;
          figure.el.hidden = false;
          figure.play(['lookUp', 'talk'], { holdMs: talkMs(t('satellite.heading')) + 1000 });
        }, reducedMotion() ? 0 : FLIGHT_MS);
      } else figure.el.hidden = true;
      visited = true;
      const a = document.activeElement;
      opener = a instanceof HTMLElement && a !== document.body ? a : null;
      back.focus({ preventScroll: true });
    } else {
      const to = shown(opener) ? opener : document.querySelector<HTMLElement>('[data-test="btn-source"]');
      opener = null;
      // Also from the 3D view itself ([satellite], focused for the arrow keys), which hides as the view closes.
      const a = document.activeElement;
      if (el.contains(a) || a === document.body || a?.closest('[data-test="satellite"]')) to?.focus({ preventScroll: true });
    }
  });
  return el;
}
