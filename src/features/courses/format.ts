const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

/** '2026-11-12' → '12 ноя' (рік — лише якщо не поточний) */
export function shortDate(d: string, today: string): string {
  const [y, m, day] = d.split('-').map(Number);
  const base = `${day} ${MONTHS[m - 1]}`;
  return d.slice(0, 4) === today.slice(0, 4) ? base : `${base} ${y}`;
}

export function daysUntil(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
}

/** '2026-10-14' + 29 → '2026-11-12' (дати без часових поясів, як на сервері) */
export function addDays(d: string, days: number): string {
  return new Date(Date.parse(d) + days * 86_400_000).toISOString().slice(0, 10);
}

/** plural(3, ['день', 'дня', 'дней']) → 'дня' */
export function plural(n: number, [one, few, many]: [string, string, string]): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
