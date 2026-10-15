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
