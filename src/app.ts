// Actions: the only code that changes the store. Also owns settings storage, geolocation and the globe link.
import trackJson from './data/generated/yagi.json';
import provincesJson from './data/provinces.json';
import { t } from './i18n';
import { logEvent, msSinceOpen, throttle } from './log';
import type { GlobeController } from './scene/types';
import { isMode, isTextSize, isTheme, modeOf, Store, themeOf, type Mode, type Place, type Settings, type State, type TextSize, type Theme } from './state';
import { cone, verdict, type Province, type Track } from './storm/verdict';
import { isPlainObject, readJson, writeJson } from './ui/storage';

export const TRACK = trackJson as unknown as Track;
export const PROVINCES = provincesJson as unknown as Array<Province & { fullName: string }>;
/** The simulated "now" (SPEC 4). */
export const NOW_MS = Date.parse('2024-09-05T00:00:00Z');
export const FIRST_MS = Date.parse(TRACK.points[0].t);
export const LAST_MS = Date.parse(TRACK.points[TRACK.points.length - 1].t);
export const STEP_3H = 3 * 3600 * 1000;
export const CONE = cone(TRACK, NOW_MS);
export const GEO_TIMEOUT_MS = 8000;

export const SETTINGS_KEY = 'stormdemo.settings.v1';
const DEFAULTS: Settings = { textSize: 16, theme: null, mode: 'easy' };

const isSettings = (v: unknown): v is Settings => isPlainObject(v) && isTextSize(v.textSize) && (v.theme === null || isTheme(v.theme)) && isMode(v.mode);

export function loadSettings(): { settings: Settings; saved: boolean } {
  const s = readJson<Settings | null>(SETTINGS_KEY, (v): v is Settings | null => isSettings(v), null);
  return s ? { settings: { ...s }, saved: true } : { settings: { ...DEFAULTS }, saved: false };
}

export function urlMode(search: string): Mode | null {
  try {
    const v = new URLSearchParams(search).get('mode');
    return isMode(v) ? v : null;
  } catch {
    return null;
  }
}

function systemDark(): boolean {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

export function reducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/**
 * The place's name inside a sentence (SPEC 6.3 step 2): the own-location label "Vị trí của bạn" is written in lower
 * case there; at the start of a sentence and on the map pin it keeps its capital. Province names are unchanged.
 */
export function placeInSentence(p: Place): string {
  return p.label === t('place.yours') ? t('place.yoursInside') : p.label;
}

export type Actions = ReturnType<typeof createActions>;

export function createStore(): Store {
  const { settings, saved } = loadSettings();
  const state: State = {
    settings,
    systemDark: systemDark(),
    modeOverride: urlMode(location.search),
    view: 'map',
    timeMs: NOW_MS,
    place: null,
    verdict: null,
    picker: 'hidden',
    locating: false,
    onboarding: !saved,
  };
  return new Store(state);
}

export function createActions(store: Store) {
  let globe: GlobeController | null = null;
  let checkId = 0;

  const save = () => {
    if (!store.state.onboarding) writeJson(SETTINGS_KEY, store.state.settings);
  };
  const setSetting = <K extends keyof Settings>(name: K, value: Settings[K], logValue: unknown) => {
    const patch: Partial<State> = { settings: { ...store.state.settings, [name]: value } };
    if (name === 'mode') patch.modeOverride = null;
    store.set(patch);
    save();
    logEvent('setting', { name, value: logValue });
  };
  const logSlider = throttle<number>(2000, (ms) => logEvent('slider', { time: new Date(ms).toISOString() }));

  const actions = {
    attachGlobe(g: GlobeController) {
      globe = g;
      const s = store.state;
      g.setMode(modeOf(s));
      g.setTime(s.timeMs);
      if (s.place) g.setPlace(s.place);
      if (s.view === 'satellite') g.showSatellite();
    },

    setTextSize(n: TextSize) {
      if (n !== store.state.settings.textSize) setSetting('textSize', n, n);
    },
    setTheme(th: Theme) {
      const s = store.state;
      if (s.settings.theme === th && themeOf(s) === th) return;
      setSetting('theme', th, th);
    },
    setMode(m: Mode) {
      if (m === store.state.settings.mode && store.state.modeOverride === null) return;
      setSetting('mode', m, m);
    },
    setSystemDark(dark: boolean) {
      store.set({ systemDark: dark });
    },

    finishOnboarding(done: boolean) {
      store.set({ onboarding: false });
      save();
      logEvent(done ? 'onboarding_done' : 'onboarding_skip');
    },

    /** SPEC 6.3: ask for the location; the province picker on refusal, failure or 8 s of silence. */
    runCheck() {
      const id = ++checkId;
      logEvent('check_start');
      store.set({ locating: true, picker: 'hidden' });
      let settled = false;
      const finish = (coords: { latitude: number; longitude: number } | null) => {
        if (settled || id !== checkId) return;
        settled = true;
        window.clearTimeout(timer);
        store.set({ locating: false });
        logEvent('geo_result', { granted: !!coords });
        if (coords) actions.setPlace(coords.latitude, coords.longitude, t('place.yours'));
        else store.set({ picker: 'failed' });
      };
      const timer = window.setTimeout(() => finish(null), GEO_TIMEOUT_MS);
      try {
        if (!navigator.geolocation) throw new Error('no geolocation');
        navigator.geolocation.getCurrentPosition(
          (p) => finish(p.coords),
          () => finish(null),
          { enableHighAccuracy: false, maximumAge: 10 * 60 * 1000, timeout: GEO_TIMEOUT_MS },
        );
      } catch {
        finish(null);
      }
    },

    openPicker() {
      checkId++;
      store.set({ picker: 'recheck', locating: false });
    },

    pickProvince(id: string) {
      const p = PROVINCES.find((x) => x.id === id);
      if (!p) return;
      logEvent('province_pick', { id });
      actions.setPlace(p.lat, p.lon, p.name, p.id);
    },

    /** Verdict for a place at now (SPEC 5) and the pin (SPEC 6.3 step 4); the map view does not move. */
    setPlace(lat: number, lon: number, label: string, id?: string) {
      checkId++;
      const place: Place = { lat, lon, label, ...(id ? { id } : {}) };
      const v = verdict(place, TRACK, NOW_MS);
      // Logged first: the store update below logs the warning the verdict triggers.
      logEvent('verdict_shown', { affected: v.affected, place: label, msSinceOpen: msSinceOpen() });
      store.set({ place, verdict: v, picker: 'hidden', locating: false });
      globe?.setPlace(place);
    },

    /** Full mode time slider. */
    setTime(ms: number) {
      if (ms === store.state.timeMs) return;
      store.set({ timeMs: ms });
      globe?.setTime(ms);
      logSlider(ms);
    },

    /** The `where` chip: highlights the storm marker; no camera move (SPEC 6.4). */
    highlightStorm() {
      globe?.highlightStorm();
    },

    openSatellite() {
      if (store.state.view === 'satellite') return;
      logEvent('satellite_open');
      store.set({ view: 'satellite' });
      globe?.showSatellite();
    },

    closeSatellite() {
      if (store.state.view !== 'satellite') return;
      logEvent('satellite_close');
      store.set({ view: 'map' });
      globe?.back();
    },
  };

  // Mode changes reach the globe; easy mode always shows now.
  store.subscribe((s, prev) => {
    const m = modeOf(s);
    if (m === modeOf(prev)) return;
    globe?.setMode(m);
    if (m === 'easy' && s.timeMs !== NOW_MS) {
      store.set({ timeMs: NOW_MS });
      globe?.setTime(NOW_MS);
    }
  });

  return actions;
}
