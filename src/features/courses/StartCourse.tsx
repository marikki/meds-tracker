import { X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { CoursesApi } from './api';
import { Check } from './components/Check';
import { PersonBadge } from './components/PersonBadge';
import { addDays, daysUntil, plural, shortDate } from './format';
import type { Overview, OverviewItem, Person } from './types';
import { drugLines, uniquePeople, unitKey, unitName } from './units';

const DAYS: [string, string, string] = ['день', 'дня', 'дней'];

interface Row {
  key: string;
  items: OverviewItem[];
  /** busy — у цю дату вже йде курс, стартувати не можна; early — раніше кінця перерви */
  kind: 'normal' | 'early' | 'busy';
  info: string;
  /** null — курс без срока */
  end: string | null;
}

/**
 * Рядки екрана: препарат чи комплекс × стан. Призначення однієї одиниці (препарати комплексу,
 * різні люди) згортаються в один рядок із кількома бейджами, якщо для них однаковий стан і текст.
 */
function buildRows(items: OverviewItem[], start: string, today: string) {
  const groups = new Map<string, Row & { due: boolean }>();
  for (const i of items) {
    const f = i.forecast;
    const days = i.drug.courseDays;
    const end = days === null ? null : addDays(start, days - 1);
    let kind: Row['kind'] = 'normal';
    let info = end === null ? 'Без срока' : `${days} ${plural(days!, DAYS)} · закончится ${shortDate(end, today)}`;
    const activeEnd = f.activeCourse ? f.activeCourse.endDate : null;
    if (f.activeCourse && (activeEnd === null || start <= activeEnd)) {
      kind = 'busy';
      info = activeEnd === null ? 'Курс уже идёт, без срока' : `Курс уже идёт, до ${shortDate(activeEnd, today)}`;
    } else if (f.nextStartDate && start < f.nextStartDate) {
      const n = daysUntil(start, f.nextStartDate);
      kind = 'early';
      // Ще не приймали — значить, чекаємо попередника, а не власну перерву
      const wait = f.lastEndDate === null && i.after ? `После «${i.after.name}»` : 'Перерыв';
      info = `${wait} до ${shortDate(f.nextStartDate, today)} — раньше на ${n} ${plural(n, DAYS)}`;
    }
    const due = f.status === 'due';
    const key = `${unitKey(i)}|${due}|${info}`;
    const g = groups.get(key);
    if (g) g.items.push(i);
    else groups.set(key, { key, items: [i], kind, info, end, due });
  }
  const all = [...groups.values()].sort((a, b) => unitName(a.items[0]).localeCompare(unitName(b.items[0]), 'ru'));
  const order = { early: 0, normal: 0, busy: 1 };
  return {
    due: all.filter((r) => r.due),
    rest: all.filter((r) => !r.due).sort((a, b) => order[a.kind] - order[b.kind]),
  };
}

export function StartCourse({
  api,
  people,
  initialPerson,
  preselected,
  onClose,
}: {
  api: CoursesApi;
  people: Person[];
  initialPerson: string;
  /** Призначення, вже позначені на «Сегодня»; без нього позначено все, що «пора починати» */
  preselected?: number[];
  onClose: (changed: boolean) => void;
}) {
  const [data, setData] = useState<Overview | null>(null);
  const [start, setStart] = useState('');
  const [person, setPerson] = useState(initialPerson);
  // Обрані призначення; рядок позначений, коли обрані всі його призначення
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.overview('all').then((o) => {
      setData(o);
      setStart(o.today);
      // Як у макеті: усе, що «пора починати», позначене заздалегідь
      setSelected(
        new Set(preselected ?? o.items.filter((i) => i.forecast.status === 'due').map((i) => i.prescriptionId)),
      );
    }, (e: Error) => setError(e.message));
    // preselected потрібен лише при відкритті екрана, тому не в залежностях
  }, [api]);

  const byId = useMemo(() => new Map(people.map((p, i) => [p.id, { p, primary: i === 0 }])), [people]);
  const rows = useMemo(() => {
    if (!data || !start) return { due: [], rest: [] };
    const visible = data.items.filter((i) => person === 'all' || i.personId === person);
    return buildRows(visible, start, data.today);
  }, [data, start, person]);

  const isOn = (r: Row) => r.kind !== 'busy' && r.items.every((i) => selected.has(i.prescriptionId));
  const toggle = (r: Row) =>
    setSelected((s) => {
      const next = new Set(s);
      const on = isOn(r);
      for (const i of r.items) on ? next.delete(i.prescriptionId) : next.add(i.prescriptionId);
      return next;
    });

  const chosen = [...rows.due, ...rows.rest].filter(isOn);
  const names = (r: Row) => uniquePeople(r.items).map((i) => byId.get(i.personId)?.p.name ?? i.personId).join(' и ');

  async function submit() {
    setBusy(true);
    setError('');
    try {
      await api.startCourses(start, chosen.flatMap((r) => r.items.map((i) => i.prescriptionId)));
      onClose(true);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  const list = (title: string, titleClass: string, items: Row[]) =>
    items.length > 0 && (
      <section className="flex flex-col gap-2">
        <h2 className={`text-[13px] font-semibold tracking-wider uppercase ${titleClass}`}>{title}</h2>
        <div className="divide-y divide-line rounded-2xl bg-surface px-4">
          {items.map((r) => (
            <label key={r.key} className={`flex items-center gap-3.5 py-3.5 ${r.kind === 'busy' ? '' : 'cursor-pointer'}`}>
              <Check checked={isOn(r)} disabled={r.kind === 'busy'} onChange={() => toggle(r)} />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className={`font-semibold ${r.kind === 'busy' ? 'text-muted' : ''}`}>{unitName(r.items[0])}</span>
                {r.items[0].group && (
                  <span className="text-[13px] text-muted">{drugLines(r.items).map((d) => d.name).join(' + ')}</span>
                )}
                <span className={`text-[13px] ${r.kind === 'early' ? 'text-due-ink' : 'text-muted'}`}>{r.info}</span>
              </span>
              <span className="flex gap-1">
                {uniquePeople(r.items).map((i) => {
                  const b = byId.get(i.personId);
                  return b ? <PersonBadge key={i.personId} person={b.p} primary={b.primary} /> : null;
                })}
              </span>
            </label>
          ))}
        </div>
      </section>
    );

  const n = chosen.length;
  return (
    <div className="fixed inset-0 z-20 overflow-y-auto bg-ground">
      <div className="mx-auto flex min-h-dvh max-w-md flex-col">
        <header className="flex h-14 items-center justify-between pr-2 pl-5">
          <h1 className="text-[22px] font-bold">Начать курс</h1>
          <button type="button" aria-label="Закрыть" onClick={() => onClose(false)}
            className="flex size-11 items-center justify-center text-ink">
            <X size={22} aria-hidden="true" />
          </button>
        </header>

        <main className="flex flex-1 flex-col gap-4 px-5 pt-2 pb-4">
          <div className="divide-y divide-line rounded-2xl bg-surface px-4">
            <label className="flex h-[52px] items-center justify-between gap-3">
              <span className="text-[15px] text-muted">Дата старта</span>
              <input
                type="date"
                value={start}
                required
                onChange={(e) => e.target.value && setStart(e.target.value)}
                className="bg-transparent text-right text-[15px] font-semibold text-ink"
              />
            </label>
            <div className="flex h-14 items-center justify-between gap-3">
              <span className="text-[15px] text-muted">Для кого</span>
              <div role="group" aria-label="Для кого" className="flex gap-1 rounded-[10px] bg-track p-[3px]">
                {[...people, { id: 'all', name: 'Оба' }].map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    aria-pressed={person === o.id}
                    onClick={() => setPerson(o.id)}
                    className={`h-[34px] rounded-lg px-3.5 text-sm ${
                      person === o.id ? 'bg-surface font-semibold text-ink' : 'text-muted'
                    }`}
                  >
                    {o.name}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {data && rows.due.length + rows.rest.length === 0 && (
            <p className="text-sm text-muted">Нет назначений. Добавьте препараты во вкладке «Препараты».</p>
          )}
          {list('Пора начинать', 'text-due-ink', rows.due)}
          {list('Остальные', 'text-muted', rows.rest)}
        </main>

        <footer className="sticky bottom-0 flex flex-col gap-3 border-t border-line bg-surface px-5 pt-4 pb-[max(2rem,env(safe-area-inset-bottom))]">
          <p className="text-sm text-muted">
            {n === 0
              ? 'Отметьте, что начинаете'
              : chosen
                  .map((r) => `${unitName(r.items[0])} — ${names(r)}, ${r.end ? `до ${shortDate(r.end, data!.today)}` : 'без срока'}`)
                  .join(' · ')}
          </p>
          {error && <p className="text-sm text-due-ink">{error}</p>}
          <button
            type="button"
            disabled={n === 0 || busy}
            onClick={submit}
            className="h-[52px] rounded-xl bg-accent font-semibold text-white disabled:opacity-50"
          >
            {n === 0 ? 'Начать курс' : `Начать ${n} ${plural(n, ['курс', 'курса', 'курсов'])}`}
          </button>
        </footer>
      </div>
    </div>
  );
}
