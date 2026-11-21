const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatters.set(tz, f);
  }
  return f;
}

/** Offset of the zone from UTC, in ms, at the given instant (negative west of UTC). */
export function tzOffsetMs(tz: string, utcMs: number): number {
  const parts: Record<string, number> = {};
  for (const p of formatter(tz).formatToParts(new Date(utcMs))) {
    if (p.type !== 'literal') parts[p.type] = Number(p.value);
  }
  const asLocal = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asLocal - Math.floor(utcMs / 1000) * 1000;
}

/** Convert a wall-clock time in a zone to a UTC instant, handling daylight saving. */
export function localToUtc(tz: string, year: number, month: number, day: number, hour: number, minute: number): number {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const off1 = tzOffsetMs(tz, guess);
  let utc = guess - off1;
  const off2 = tzOffsetMs(tz, utc);
  if (off2 !== off1) utc = guess - off2;
  return utc;
}

/** Short zone label (PST or PDT) at an instant. */
export function tzAbbrev(tz: string, utcMs: number): string {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' });
  return f.formatToParts(new Date(utcMs)).find((p) => p.type === 'timeZoneName')?.value ?? '';
}

const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Day of year (1-365) to [month, day] in a non-leap year. */
export function doyToMonthDay(doy: number): [number, number] {
  let d = Math.min(365, Math.max(1, Math.round(doy)));
  for (let m = 0; m < 12; m++) {
    if (d <= MONTH_DAYS[m]) return [m + 1, d];
    d -= MONTH_DAYS[m];
  }
  return [12, 31];
}

export function monthDayToDoy(month: number, day: number): number {
  let d = day;
  for (let m = 0; m < month - 1; m++) d += MONTH_DAYS[m];
  return d;
}

export function monthName(month: number): string {
  return MONTH_NAMES[month - 1];
}

/** Calendar dates from (month, day) to (month, day), wrapping the year end when needed. */
export function dateRange(from: [number, number], to: [number, number], everyDays: number): [number, number][] {
  const start = monthDayToDoy(from[0], from[1]);
  let end = monthDayToDoy(to[0], to[1]);
  if (end < start) end += 365;
  const out: [number, number][] = [];
  for (let d = start; d <= end; d += Math.max(1, everyDays)) {
    out.push(doyToMonthDay(((d - 1) % 365) + 1));
  }
  return out;
}
