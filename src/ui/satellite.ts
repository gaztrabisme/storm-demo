// Satellite info panel (SPEC 6.7, approved text SPEC 10.4).
import type { Actions } from '../app';
import { t, tList } from '../i18n';
import type { Store } from '../state';
import { h } from './dom';

export function satelliteInfo(store: Store, actions: Actions): HTMLElement {
  const back = h('button', { test: 'btn-back', class: 'btn btn--primary', type: 'button', text: t('satellite.back'), onclick: () => actions.closeSatellite() });
  const head = h('h2', { class: 'panel__h', id: 'sat-head', text: t('satellite.heading') });
  const el = h(
    'section',
    { test: 'satellite-info', class: 'satinfo', hidden: true, 'aria-labelledby': 'sat-head' },
    back,
    head,
    h('ul', { class: 'satinfo__facts' }, ...tList('satellite.facts').map((f) => h('li', { text: f }))),
    h('p', { class: 'source', text: t('satellite.source') }),
  );
  store.subscribe((s, prev) => {
    if (s.view === prev.view) return;
    el.hidden = s.view !== 'satellite';
    if (s.view === 'satellite') back.focus({ preventScroll: true });
  });
  return el;
}
