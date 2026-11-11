// Usui-chan's answers (SPEC 6.4, 10.5): built only from the approved text of SPEC 10 and the verdict.
import { TRACK } from '../app';
import { t, tList } from '../i18n';
import type { Place } from '../state';
import { km, vnTime } from '../storm/format';
import { trackAt, windLevel, type Verdict } from '../storm/verdict';

export const CHIP_IDS = ['affected', 'when', 'prepare', 'windlevel', 'radius', 'where', 'source'] as const;
export type ChipId = (typeof CHIP_IDS)[number];

/** One answer: Usui-chan's line, then optional quoted approved lines and a source line. */
export interface Answer {
  line: string;
  items?: string[];
  ordered?: boolean;
  source?: string;
}

/** Degrees with one decimal and a Vietnamese decimal comma. */
const deg = (x: number): string => x.toFixed(1).replace('.', ',');

export function whenAnswer(v: Verdict, place: Place): Answer {
  if (v.affected && v.firstInside !== null && v.lastInside !== null) {
    return { line: t('assistant.whenAffected', { place: place.label, from: vnTime(v.firstInside), to: vnTime(v.lastInside) }) };
  }
  return { line: t('assistant.whenUnaffected', { place: place.label, km: km(v.closest.distanceKm), time: vnTime(v.closest.time) }) };
}

export function whereAnswer(timeMs: number): Answer | null {
  const s = trackAt(TRACK, timeMs);
  if (!s) return null;
  const n = windLevel(s.windKt);
  const params = { time: vnTime(timeMs), lat: deg(s.lat), lon: deg(s.lon) };
  return { line: n === null ? t('assistant.whereNoWind', params) : t('assistant.where', { ...params, n }) };
}

export function prepareAnswer(): Answer {
  return { line: t('assistant.prepare'), items: tList('actions.items'), ordered: true, source: t('actions.source') };
}

export function cardAnswer(card: 'wind' | 'radius'): Answer {
  return { line: t('assistant.card', { title: t(`cards.${card}.title`) }), items: tList(`cards.${card}.body`), source: t(`cards.${card}.source`) };
}

export function sourceAnswer(): Answer {
  return { line: t('assistant.source') };
}
