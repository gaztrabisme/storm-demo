// Interface strings. Every user-facing text comes from vi.json.
import vi from './vi.json';

type Node = string | Node[] | { [k: string]: Node };
const dict = vi as unknown as Node;

/** Raw value at a dotted key (strings, arrays or objects). */
export function lookup(key: string): Node | undefined {
  let cur: Node | undefined = dict;
  for (const part of key.split('.')) {
    if (cur && typeof cur === 'object') cur = (cur as Record<string, Node>)[part];
    else return undefined;
  }
  return cur;
}

/** The string at `key`, with each {name} replaced from `params`. */
export function t(key: string, params?: Record<string, string | number>): string {
  const v = lookup(key);
  if (typeof v !== 'string') {
    if (import.meta.env?.DEV) console.warn(`[i18n] missing key: ${key}`);
    return key;
  }
  return params ? v.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? `{${k}}`)) : v;
}

/** The list of strings at `key`. */
export function tList(key: string): string[] {
  const v = lookup(key);
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}
