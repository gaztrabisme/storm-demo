// One store. State changes only through the actions in app.ts; updates are immutable.
import type { Verdict } from './storm/verdict';

export type TextSize = 16 | 20 | 24;
export type Theme = 'light' | 'dark';
export type Mode = 'easy' | 'full';
export type View = 'map' | 'satellite';
export type PickerState = 'hidden' | 'failed' | 'recheck';

export const TEXT_SIZES: readonly TextSize[] = [16, 20, 24];
export const THEMES: readonly Theme[] = ['light', 'dark'];
export const MODES: readonly Mode[] = ['easy', 'full'];

export interface Settings {
  textSize: TextSize;
  /** null: follow prefers-color-scheme. */
  theme: Theme | null;
  mode: Mode;
}

export interface Place {
  lat: number;
  lon: number;
  label: string;
  id?: string;
}

export interface State {
  settings: Settings;
  systemDark: boolean;
  /** ?mode= for this page load only. */
  modeOverride: Mode | null;
  view: View;
  /** Selected time (ms, UTC); in easy mode always now. */
  timeMs: number;
  place: Place | null;
  verdict: Verdict | null;
  picker: PickerState;
  locating: boolean;
  onboarding: boolean;
}

export const isMode = (v: unknown): v is Mode => v === 'easy' || v === 'full';
export const isTheme = (v: unknown): v is Theme => v === 'light' || v === 'dark';
export const isTextSize = (v: unknown): v is TextSize => v === 16 || v === 20 || v === 24;

export const modeOf = (s: State): Mode => s.modeOverride ?? s.settings.mode;
export const themeOf = (s: State): Theme => s.settings.theme ?? (s.systemDark ? 'dark' : 'light');

export type Listener = (s: State, prev: State) => void;

export class Store {
  private listeners: Listener[] = [];
  constructor(public state: State) {}
  set(patch: Partial<State>): void {
    const prev = this.state;
    this.state = { ...prev, ...patch };
    for (const l of this.listeners) l(this.state, prev);
  }
  subscribe(l: Listener): () => void {
    this.listeners.push(l);
    return () => {
      this.listeners = this.listeners.filter((x) => x !== l);
    };
  }
}
