/**
 * Дати без часу у форматі 'YYYY-MM-DD'.
 * Уся арифметика — через номер дня від епохи в UTC, тож часові пояси
 * і перехід на літній час на неї не впливають.
 */
export type ISODate = string;

const DAY_MS = 86_400_000;
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isISODate(value: unknown): value is ISODate {
  if (typeof value !== 'string' || !ISO_RE.test(value)) return false;
  return toDayNumber(value) !== null && fromDayNumber(toDayNumber(value)!) === value;
}

function toDayNumber(d: ISODate): number | null {
  const [y, m, day] = d.split('-').map(Number);
  const ms = Date.UTC(y, m - 1, day);
  return Number.isNaN(ms) ? null : ms / DAY_MS;
}

function fromDayNumber(n: number): ISODate {
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}

function dayNumber(d: ISODate): number {
  const n = toDayNumber(d);
  if (n === null) throw new Error(`Invalid date: ${d}`);
  return n;
}

export function addDays(d: ISODate, days: number): ISODate {
  return fromDayNumber(dayNumber(d) + days);
}

/** b − a у днях: diffDays('2026-10-01', '2026-10-14') === 13 */
export function diffDays(a: ISODate, b: ISODate): number {
  return dayNumber(b) - dayNumber(a);
}

export function maxDate(a: ISODate, b: ISODate): ISODate {
  return a >= b ? a : b;
}

export function yearOf(d: ISODate): number {
  return Number(d.slice(0, 4));
}

/** Сьогоднішня дата в заданому часовому поясі (за замовчуванням Київ). */
export function todayIn(timeZone = 'Europe/Kyiv', now = new Date()): ISODate {
  // en-CA форматує дату саме як YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
