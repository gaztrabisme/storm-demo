// Event log (SPEC 7). Stored under stormdemo.log.v1 in this browser only; nothing is sent anywhere.
import { readJson, removeKey, writeJson } from '../ui/storage';

export const LOG_KEY = 'stormdemo.log.v1';

export interface LogEvent {
  session: string;
  t: number;
  type: string;
  data: Record<string, unknown> | null;
}

const isEvents = (v: unknown): v is LogEvent[] => Array.isArray(v);

function newSession(): string {
  try {
    const b = new Uint8Array(8);
    crypto.getRandomValues(b);
    return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  } catch {
    return Math.random().toString(16).slice(2, 18);
  }
}

export const session = newSession();
const opened = performance.now();
/** Events of every session; mirrors storage, and is the only copy when storage is unavailable. */
let memory: LogEvent[] = readJson(LOG_KEY, isEvents, []);
/** Set once a write fails (storage full or blocked): from then on the stored copy is stale and memory is the log. */
let storageBroken = false;

export const msSinceOpen = (): number => Math.max(1, Math.round(performance.now() - opened));

export function logEvent(type: string, data: Record<string, unknown> | null = null): void {
  const e: LogEvent = { session, t: msSinceOpen(), type, data };
  // Re-read so that events written by another open tab are kept, unless storage has stopped taking writes.
  const stored = storageBroken ? null : readJson<LogEvent[] | null>(LOG_KEY, (v): v is LogEvent[] | null => isEvents(v), null);
  memory = [...(stored && stored.length >= memory.length ? stored : memory), e];
  if (!writeJson(LOG_KEY, memory)) storageBroken = true;
}

export function events(): LogEvent[] {
  if (!storageBroken) {
    const stored = readJson<LogEvent[] | null>(LOG_KEY, (v): v is LogEvent[] | null => isEvents(v), null);
    if (stored && stored.length >= memory.length) memory = stored;
  }
  return memory.slice();
}

export function clearLog(): void {
  memory = [];
  storageBroken = false;
  removeKey(LOG_KEY);
}

/** Download every stored event as stormdemo-log-{session}.json. */
export function exportLog(): void {
  const blob = new Blob([JSON.stringify(events(), null, 2)], { type: 'application/json' });
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = `stormdemo-log-${session}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

/** Calls `fn` at most once per `ms`, with a trailing call carrying the latest value. */
export function throttle<A>(ms: number, fn: (arg: A) => void): (arg: A) => void {
  let last = -Infinity;
  let timer = 0;
  let pending: A | null = null;
  return (arg: A) => {
    const now = performance.now();
    if (now - last >= ms) {
      last = now;
      fn(arg);
      return;
    }
    pending = arg;
    if (!timer) {
      timer = window.setTimeout(() => {
        timer = 0;
        last = performance.now();
        if (pending !== null) fn(pending);
        pending = null;
      }, ms - (now - last));
    }
  };
}
