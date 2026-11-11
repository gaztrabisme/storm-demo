// Display formats (SPEC 2): Vietnam time UTC+7 as "HH:mm, dd/MM".

const pad = (n: number) => String(n).padStart(2, '0');

export function vnTime(x: Date | string | number): string {
  const ms = x instanceof Date ? x.getTime() : typeof x === 'number' ? x : Date.parse(x);
  const v = new Date(ms + 7 * 3600 * 1000);
  return `${pad(v.getUTCHours())}:${pad(v.getUTCMinutes())}, ${pad(v.getUTCDate())}/${pad(v.getUTCMonth() + 1)}`;
}

/** Whole kilometres, Vietnamese thousands separator: 1.087. */
export const km = (d: number): string => String(Math.round(d)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
