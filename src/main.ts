// Entry: builds the page, links the store to the UI, loads the globe lazily, exposes the test hooks (SPEC 8).
import './styles.css';
import { assistant } from './assistant';
import { CONE, createActions, createStore, NOW_MS, PROVINCES, reducedMotion, TRACK } from './app';
import { t } from './i18n';
import { events, logEvent } from './log';
import { loadGlobe } from './scene';
import { modeOf, themeOf } from './state';
import { vnTime } from './storm/format';
import { h } from './ui/dom';
import { showOnboarding } from './ui/onboarding';
import { mapKey } from './ui/key';
import { checkBlock, learnBlock, stormSummary, timelineList, timeSlider, verdictCard } from './ui/panel';
import { satelliteInfo } from './ui/satellite';
import { bindAppearance, settingsDialog } from './ui/settings';

const params = new URLSearchParams(location.search);
const testMode = params.get('test') === '1';

const store = createStore();
const actions = createActions(store);
bindAppearance(store);

// Layout (SPEC 6): top bar, globe, panel.
const settings = settingsDialog(store, actions, testMode);
const btnSource = h('button', { test: 'btn-source', class: 'btn btn--bar', type: 'button', text: t('top.source'), onclick: () => actions.openSatellite() });
const btnSettings = h('button', { test: 'btn-settings', class: 'btn btn--bar', type: 'button', text: t('top.settings'), onclick: () => settings.open() });
const topbar = h('header', { class: 'topbar' }, h('h1', { test: 'title', class: 'topbar__title', text: t('app.title') }), h('div', { class: 'topbar__actions' }, btnSource, btnSettings));

const loading = h('p', { class: 'globe__loading', text: t('app.loading') });
const demoLabel = h('p', { test: 'demo-label', class: 'globe__demo', text: t('demo.label', { now: vnTime(NOW_MS) }) });
// The map key: a worked specimen of the track glyphs with the legend lines (ui/key.ts).
const key = mapKey();
const usui = assistant(store, actions);
// Desktop: the map key sits in the open sea at the bottom of the map.
const globeBottom = h('div', { class: 'globe__bottom' });
const globeEl = h('section', { test: 'globe', class: 'globe', 'aria-label': t('app.globe') }, loading, demoLabel, globeBottom);

const panelMain = h(
  'div',
  { class: 'panel__main' },
  timeSlider(store, actions),
  stormSummary(),
  checkBlock(store, actions),
  verdictCard(store, actions),
  timelineList(actions),
  learnBlock(store),
);
const panel = h('aside', { class: 'panel' }, panelMain, satelliteInfo(store, actions));

// Desktop: the key sits on the map, in the open sea north-east of the track. Phone: it folds under the map,
// at the end of the panel, so the check button and the verdict keep the first screen.
const placeKey = (wide: boolean) => {
  if (wide) globeBottom.append(key.el);
  else panelMain.append(key.el);
};
try {
  const wideMq = window.matchMedia('(min-width: 900px)');
  placeKey(wideMq.matches);
  wideMq.addEventListener('change', (e) => placeKey(e.matches));
} catch {
  placeKey(true);
}
document.getElementById('app')?.replaceChildren(topbar, globeEl, panel, usui.root, settings.el);

// Esc leaves the satellite view (dialogs handle their own Esc).
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || document.querySelector('dialog[open]')) return;
  if (store.state.view === 'satellite') {
    e.preventDefault();
    actions.closeSatellite();
  }
});

try {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => actions.setSystemDark(e.matches));
} catch {
  /* no matchMedia */
}

logEvent('open', { mode: modeOf(store.state), textSize: store.state.settings.textSize, theme: themeOf(store.state), width: window.innerWidth });
if (store.state.onboarding) showOnboarding(store, actions);

// The globe (three.js) loads in its own chunk.
let readyResolve: () => void = () => {};
const ready = new Promise<void>((r) => (readyResolve = r));
loadGlobe({
  container: globeEl,
  track: TRACK,
  nowMs: NOW_MS,
  timeMs: store.state.timeMs,
  mode: modeOf(store.state),
  cone: CONE,
  provinces: PROVINCES,
  reducedMotion,
  labels: { storm: t('marker.storm'), pin: t('marker.pin'), satellite: t('marker.satellite'), satName: t('marker.satName') },
  covers: () => [demoLabel, usui.sheet],
  avoid: () => [key.el],
  onMetrics: (m) => key.setMetrics(m),
})
  .then((g) => {
    actions.attachGlobe(g);
    return g.ready;
  })
  .then(() => {
    loading.remove();
    readyResolve();
  })
  .catch((e: unknown) => {
    console.error(e);
  });

// Test hooks: dev and ?test=1 only (SPEC 8).
if (import.meta.env.DEV || testMode) {
  const s = () => store.state;
  Object.defineProperty(window, '__app', {
    configurable: true,
    value: {
      get view() {
        return s().view;
      },
      get settings() {
        return { textSize: s().settings.textSize, theme: themeOf(s()), mode: modeOf(s()) };
      },
      get verdict() {
        const st = s();
        return st.verdict ? { ...st.verdict, place: st.place } : null;
      },
      now: new Date(NOW_MS).toISOString(),
      cone: CONE.map((c) => ({ ...c })),
      events: () => events(),
      ready,
      setPlace: (lat: number, lon: number, label: string) => actions.setPlace(lat, lon, label),
      store,
      actions,
    },
  });
}
