// Entry: builds the page, links the store to the UI, loads the globe lazily, exposes the test hooks (SPEC 8).
import './styles.css';
import { assistant } from './assistant';
import { CONE, createActions, createStore, NOW_MS, PROVINCES, reducedMotion, TRACK } from './app';
import { t } from './i18n';
import { events, logEvent, throttle } from './log';
import { loadGlobe, type GlobeController } from './scene';
import { modeOf, themeOf } from './state';
import { vnTime } from './storm/format';
import { h } from './ui/dom';
import { showOnboarding } from './ui/onboarding';
import { mapKey } from './ui/key';
import { checkBlock, learnBlock, stormSummary, timelineList, timeSlider, verdictCard } from './ui/panel';
import { PALETTE } from './ui/palette';
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
// SPEC 6.1: the official-bulletin block under the top bar (a placeholder with a link, no bulletin content), and the
// disclaimer footer at the bottom of the page. The bulletin is hidden in the satellite view (styles.css).
/** The national centre's site: a link the reader may follow, not a request the page makes (SPEC 6.1). */
const BULLETIN_HREF = 'https://nchmf.gov.vn';
const bulletin = h(
  'p',
  { test: 'official-bulletin', class: 'bulletin' },
  `${t('bulletin.lead')} `,
  h('a', { class: 'bulletin__link', href: BULLETIN_HREF, target: '_blank', rel: 'noopener', text: t('bulletin.centre') }),
  `. ${t('bulletin.placeholder')}`,
);
const disclaimer = h('p', { test: 'disclaimer', class: 'disclaimer', text: t('disclaimer.text') });

const loading = h('p', { class: 'globe__loading', text: t('app.loading') });
const demoLabel = h('p', { test: 'demo-label', class: 'globe__demo', text: t('demo.label', { now: vnTime(NOW_MS) }) });
// The map key: a worked specimen of the track glyphs with the legend lines (ui/key.ts).
const key = mapKey();
const usui = assistant(store, actions);
const learn = learnBlock(store);
// Desktop: the map key sits in the open sea at the bottom of the map.
const globeBottom = h('div', { class: 'globe__bottom' });
const globeEl = h('section', { test: 'globe', class: 'globe', 'aria-label': t('app.globe') }, loading, demoLabel, globeBottom);

const verdictHost = verdictCard(store, actions, () => learn.openAdvice());
const slider = timeSlider(store, actions);
const check = checkBlock(store, actions);
const panelMain = h(
  'div',
  { class: 'panel__main' },
  slider,
  stormSummary(),
  check,
  verdictHost,
  timelineList(store, actions),
  learn.el,
);
const panel = h('aside', { class: 'panel' }, panelMain, satelliteInfo(store, actions));

// Desktop: the key sits on the map, in the open sea at the lower right. Phone: it folds under the map, in the
// panel below the storm summary and the check button (DESIGN 2), so the button is in view on load: in easy mode
// after the one "Tìm hiểu thêm" line, in full mode after the verdict, above the long province list.
// The full-mode time slider heads the panel on a desktop; on a phone it comes after the check button, which then
// shows on load in both modes.
let wide = true;
const placeKey = () => {
  if (wide) panelMain.prepend(slider);
  else check.after(slider);
  if (wide) globeBottom.append(key.el);
  else if (modeOf(store.state) === 'easy') learn.el.after(key.el);
  else verdictHost.after(key.el);
};
try {
  const wideMq = window.matchMedia('(min-width: 900px)');
  wide = wideMq.matches;
  wideMq.addEventListener('change', (e) => {
    wide = e.matches;
    placeKey();
  });
} catch {
  wide = true;
}
placeKey();
store.subscribe((s, prev) => {
  if (modeOf(s) !== modeOf(prev)) placeKey();
});
document.getElementById('app')?.replaceChildren(topbar, bulletin, globeEl, panel, disclaimer, usui.root, settings.el);

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

/** SPEC 10.6: the satellite HUD's header and labels. */
const hudStrings = () => ({
  header: t('satellite.hud.header'),
  orbit: t('satellite.hud.orbit'),
  ami: t('satellite.hud.ami'),
  fullDisk: t('satellite.hud.fullDisk'),
  resolution: t('satellite.hud.resolution'),
  ksem: t('satellite.hud.ksem'),
  wing: t('satellite.hud.wing'),
  dish: t('satellite.hud.dish'),
});

// The globe (three.js) loads in its own chunk.
let globeRef: GlobeController | null = null;
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
  labels: { storm: t('marker.storm'), pin: t('marker.pin'), satellite: t('marker.satellite'), reset: t('map.reset'), hud: hudStrings() },
  // On a desktop the key counts as a cover on the map, so the chart is framed above it. On a phone it is in the
  // panel, outside the map (and once the panel scrolls, its box can lie beside the map's rows).
  covers: () => [demoLabel, ...(globeBottom.contains(key.el) ? [key.el] : [])],
  // The question sheet comes and goes: map labels keep clear of it, but it never moves the map (SPEC 6.2).
  avoid: () => [usui.sheet],
  frameAround: key.el,
  onMetrics: (m) => key.setMetrics(m),
  // SPEC 7: map_move and map_pull at most one per 2 s, and map_reset.
  onMapMove: throttle<number>(2000, (zoom) => logEvent('map_move', { zoom: Math.round(zoom * 1000) / 1000 })),
  onMapPull: throttle<number>(2000, (zoom) => logEvent('map_pull', { zoom: Math.round(zoom * 1000) / 1000 })),
  onMapReset: () => logEvent('map_reset'),
})
  .then((g) => {
    globeRef = g;
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
      /** SPEC 2.1: the storm and bulletin colours of the current theme (DESIGN 3). */
      get palette() {
        return { ...PALETTE[themeOf(s())] };
      },
      get satellite() {
        return globeRef ? globeRef.satellite() : null;
      },
      /** SPEC 6.2: { zoom, lat, lon }, the view centre. */
      get mapView() {
        return globeRef ? globeRef.mapView() : null;
      },
      events: () => events(),
      ready,
      setPlace: (lat: number, lon: number, label: string) => actions.setPlace(lat, lon, label),
      store,
      actions,
    },
  });
}
