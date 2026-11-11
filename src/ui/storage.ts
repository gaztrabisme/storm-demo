// Safe browser storage. Every access may throw (private mode, blocked site data, broken JSON).
// Keys are versioned and prefixed: stormdemo.<name>.v<N>.

type Area = 'local' | 'session';

function area(kind: Area): Storage | null {
  try {
    return kind === 'local' ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

/** Read JSON and check its shape; `fallback` when missing, broken or the wrong shape. */
export function readJson<T>(key: string, guard: (v: unknown) => v is T, fallback: T, kind: Area = 'local'): T {
  try {
    const raw = area(kind)?.getItem(key);
    if (raw == null) return fallback;
    const v: unknown = JSON.parse(raw);
    return guard(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

/** Write JSON; returns false when storage is not available. */
export function writeJson(key: string, value: unknown, kind: Area = 'local'): boolean {
  try {
    const a = area(kind);
    if (!a) return false;
    a.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function removeKey(key: string, kind: Area = 'local'): void {
  try {
    area(kind)?.removeItem(key);
  } catch {
    /* storage not available */
  }
}

export const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
