import { X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { CoursesApi } from './api';
import { Check } from './components/Check';
import { PersonBadge } from './components/PersonBadge';
import { addDays, shortDate } from './format';
import type { CourseRow, OverviewItem, Person } from './types';
import { unitName } from './units';

/**
 * Виправлення активного курсу: дата старту, дострокове завершення, видалення помилкового.
 * items — призначення одного препарату чи комплексу з активним курсом (як згруповано на «Сегодня»).
 */
export function EditCourse({
  api,
  people,
  items,
  today,
  onClose,
}: {
  api: CoursesApi;
  people: Person[];
  items: OverviewItem[];
  today: string;
  onClose: (changed: boolean) => void;
}) {
  const title = unitName(items[0]);
  // У комплексі кілька препаратів — тоді в рядках підписуємо, який саме
  const manyDrugs = new Set(items.map((i) => i.drug.id)).size > 1;
  // prescriptionId → рядок курсу; id курсу в огляді немає, беремо з історії призначення
  const [courses, setCourses] = useState<Map<number, CourseRow> | null>(null);
  const [who, setWho] = useState<Set<number>>(() => new Set(items.map((i) => i.prescriptionId)));
  const [start, setStart] = useState(items[0].forecast.activeCourse!.startDate);
  const [finishOn, setFinishOn] = useState(today);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [changed, setChanged] = useState(false);

  useEffect(() => {
    Promise.all(
      items.map(async (i) => {
        const list = await api.prescriptionCourses(i.prescriptionId);
        const c = list.find((x) => x.start_date === i.forecast.activeCourse!.startDate);
        if (!c) throw new Error('Курс не найден — обновите страницу');
        return [i.prescriptionId, c] as const;
      }),
    ).then((pairs) => setCourses(new Map(pairs)), (e: Error) => setError(e.message));
  }, [api, items]);

  const byId = useMemo(() => new Map(people.map((p, i) => [p.id, { p, primary: i === 0 }])), [people]);
  const name = (i: OverviewItem) => byId.get(i.personId)?.p.name ?? i.personId;
  const chosen = items.filter((i) => who.has(i.prescriptionId));
  const totalDays = (chosen[0] ?? items[0]).forecast.activeCourse!.totalDays;
  const newEnd = addDays(start, totalDays - 1);
  const latestStart = chosen.map((i) => i.forecast.activeCourse!.startDate).sort().at(-1) ?? today;
  const startChanged = chosen.some((i) => i.forecast.activeCourse!.startDate !== start);

  const toggle = (pid: number) =>
    setWho((s) => {
      const next = new Set(s);
      if (next.has(pid)) next.delete(pid);
      else next.add(pid);
      return next;
    });

  /** Застосовує дію до кожного обраного курсу; після першої помилки зупиняється. */
  async function apply(action: (c: CourseRow) => Promise<unknown>) {
    if (!courses) return;
    setBusy(true);
    setError('');
    try {
      for (const i of chosen) {
        await action(courses.get(i.prescriptionId)!);
        setChanged(true);
      }
      onClose(true);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  function finish() {
    const whom = chosen.map(name).join(' и ');
    if (window.confirm(`Завершить курс «${title}» (${whom}) — последний день ${shortDate(finishOn, today)}?`)) {
      apply((c) => api.updateCourse(c.id, { endedEarlyOn: finishOn }));
    }
  }

  function remove() {
    const whom = chosen.map(name).join(' и ');
    if (window.confirm(`Удалить курс «${title}» (${whom})? Он исчезнет из истории, как будто его не начинали.`)) {
      apply((c) => api.deleteCourse(c.id));
    }
  }

  const disabled = busy || !courses || chosen.length === 0;
  const field = 'bg-transparent text-right text-[15px] font-semibold text-ink';

  return (
    <div className="fixed inset-0 z-20 overflow-y-auto bg-ground">
      <div className="mx-auto flex min-h-dvh max-w-md flex-col">
        <header className="flex items-start justify-between pt-4 pr-2 pl-5">
          <div>
            <p className="text-sm text-muted">Курс</p>
            <h1 className="text-[22px] font-bold">{title}</h1>
          </div>
          <button type="button" aria-label="Закрыть" onClick={() => onClose(changed)}
            className="flex size-11 items-center justify-center text-ink">
            <X size={22} aria-hidden="true" />
          </button>
        </header>

        <main className="flex flex-col gap-4 px-5 pt-4 pb-8">
          <section className="flex flex-col gap-2">
            <h2 className="text-[13px] font-semibold tracking-wider text-muted uppercase">
              {items.length > 1 ? 'Для кого' : 'Сейчас'}
            </h2>
            <div className="divide-y divide-line rounded-2xl bg-surface px-4">
              {items.map((i) => {
                const a = i.forecast.activeCourse!;
                const b = byId.get(i.personId);
                const info = (
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex items-center gap-2">
                      {b && <PersonBadge person={b.p} primary={b.primary} />}
                      {manyDrugs && <span className="text-[15px] font-semibold">{i.drug.name}</span>}
                    </span>
                    <span className="text-[13px] text-muted">
                      с {shortDate(a.startDate, today)} · день {a.day} из {a.totalDays} · до {shortDate(a.endDate, today)}
                    </span>
                  </span>
                );
                return items.length > 1 ? (
                  <label key={i.prescriptionId} className="flex cursor-pointer items-center gap-3.5 py-3">
                    <Check checked={who.has(i.prescriptionId)} onChange={() => toggle(i.prescriptionId)} />
                    {info}
                  </label>
                ) : (
                  <div key={i.prescriptionId} className="flex py-3">{info}</div>
                );
              })}
            </div>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-[13px] font-semibold tracking-wider text-muted uppercase">Дата старта</h2>
            <div className="flex flex-col gap-3 rounded-2xl bg-surface p-4">
              <label className="flex items-center justify-between gap-3">
                <span className="text-[15px] text-muted">Начали</span>
                <input type="date" value={start} max={today} required
                  onChange={(e) => e.target.value && setStart(e.target.value)} className={field} />
              </label>
              <p className="text-[13px] text-muted">
                Курс {totalDays} дн. — закончится {shortDate(newEnd, today)}
              </p>
              <button type="button" disabled={disabled || !startChanged}
                onClick={() => apply((c) => api.updateCourse(c.id, { startDate: start }))}
                className="h-12 rounded-xl bg-accent font-semibold text-white disabled:opacity-50">
                Сохранить дату
              </button>
            </div>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-[13px] font-semibold tracking-wider text-muted uppercase">Завершить досрочно</h2>
            <div className="flex flex-col gap-3 rounded-2xl bg-surface p-4">
              <label className="flex items-center justify-between gap-3">
                <span className="text-[15px] text-muted">Последний день</span>
                <input type="date" value={finishOn} min={latestStart} max={today} required
                  onChange={(e) => e.target.value && setFinishOn(e.target.value)} className={field} />
              </label>
              <button type="button" disabled={disabled}
                onClick={finish}
                className="h-12 rounded-xl border border-line font-semibold text-due-ink disabled:opacity-50">
                Завершить курс
              </button>
            </div>
          </section>

          {error && <p className="text-sm text-due-ink">{error}</p>}

          <button type="button" disabled={disabled} onClick={remove}
            className="h-11 self-center px-4 text-sm font-semibold text-due-ink disabled:opacity-50">
            Удалить курс — начали по ошибке
          </button>
        </main>
      </div>
    </div>
  );
}
