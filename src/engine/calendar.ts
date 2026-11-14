// Simulation time is an integer day number (days since 1970-01-01, proleptic Gregorian).
// Conversions use Howard Hinnant's civil-date algorithms: no Date objects, no time zones.

export interface Ymd { y: number; m: number; d: number } // m: 1..12

export function daysFromCivil(y: number, m: number, d: number): number {
  y -= m <= 2 ? 1 : 0;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

export function civilFromDays(z: number): Ymd {
  z += 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp + (mp < 10 ? 3 : -9);
  return { y: yoe + era * 400 + (m <= 2 ? 1 : 0), m, d };
}

export function parseDate(s: string): number {
  const [y, m, d] = s.split('-').map(Number);
  return daysFromCivil(y, m, d);
}

export function formatDate(day: number): string {
  const { y, m, d } = civilFromDays(day);
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** First day of the month after `day`. */
export function nextMonthStart(day: number): number {
  const { y, m } = civilFromDays(day);
  return m === 12 ? daysFromCivil(y + 1, 1, 1) : daysFromCivil(y, m + 1, 1);
}

export function addMonths(day: number, n: number): number {
  const { y, m, d } = civilFromDays(day);
  const t = y * 12 + (m - 1) + n;
  return daysFromCivil(Math.floor(t / 12), (t % 12) + 1, d);
}
