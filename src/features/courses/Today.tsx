import { useEffect, useMemo, useState } from 'react';
import type { CoursesApi } from './api';
import { PersonBadge } from './components/PersonBadge';
import { PersonSwitch } from './components/PersonSwitch';
import { daysUntil, shortDate } from './format';
import type { Overview, OverviewItem, Person } from './types';

/** Рядки одного препарату в різних людей згортаються в один із кількома бейджами. */
function groupByDrug(items: OverviewItem[]) {
  const map = new Map<number, OverviewItem[]>();
  for (const i of items) map.set(i.drug.id, [...(map.get(i.drug.id) ?? []), i]);
  return [...map.values()];
}

export function Today({ api, people }: { api: CoursesApi; people: Person[] }) {
  const [person, setPerson] = useState('all');
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.overview(person).then(setData, (e: Error) => setError(e.message));
  }, [api, person]);

  const byId = useMemo(() => new Map(people.map((p, i) => [p.id, { p, primary: i === 0 }])), [people]);
  const badges = (group: OverviewItem[]) => (
    <span className="flex gap-1">
      {group.map((i) => {
        const b = byId.get(i.personId);
        return b ? <PersonBadge key={i.personId} person={b.p} primary={b.primary} /> : null;
      })}
    </span>
  );

  if (error) return <p className="p-5 text-due-ink">{error}</p>;
  if (!data) return null;

  const t = data.today;
  const due = groupByDrug(data.items.filter((i) => i.forecast.status === 'due'));
  const active = groupByDrug(data.items.filter((i) => i.forecast.status === 'active'));
  const soon = groupByDrug(data.items.filter((i) => i.forecast.status === 'break')).sort((a, b) =>
    a[0].forecast.nextStartDate!.localeCompare(b[0].forecast.nextStartDate!),
  );

  return (
    <div className="flex flex-col gap-5 px-5 pt-6 pb-6">
      <header>
        <p className="text-sm text-muted">{shortDate(t, t)}</p>
        <h1 className="text-3xl font-bold tracking-tight">Сегодня</h1>
      </header>

      <PersonSwitch people={people} value={person} onChange={setPerson} />

      {due.length > 0 && (
        <section className="flex flex-col gap-3 rounded-2xl bg-due-soft p-4">
          <h2 className="font-bold text-due-ink">Пора начинать · {due.length}</h2>
          {due.map((g) => {
            const f = g[0].forecast;
            return (
              <div key={g[0].drug.id} className="flex items-center justify-between gap-3">
                <div>
                  <div className="font-semibold">{g[0].drug.name}</div>
                  <div className="text-sm text-due-ink">
                    {f.nextStartDate === null
                      ? 'Ещё не принимали'
                      : f.overdueDays === 0
                        ? 'Перерыв закончился сегодня'
                        : `Перерыв закончился ${shortDate(f.nextStartDate, t)}`}
                  </div>
                </div>
                {badges(g)}
              </div>
            );
          })}
          {/* TODO: екран «Начать курс» */}
          <button type="button" className="h-11 rounded-xl bg-due font-semibold text-white">Начать курс</button>
        </section>
      )}

      <section className="flex flex-col gap-2.5">
        <h2 className="text-lg font-bold">Активные курсы</h2>
        {active.length === 0 && <p className="text-sm text-muted">Сейчас ничего не принимаете.</p>}
        {active.map((g) => {
          const c = g[0].forecast.activeCourse!;
          return (
            <article key={g[0].drug.id} className="flex flex-col gap-2.5 rounded-2xl bg-surface px-4 py-3.5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-semibold">{g[0].drug.name}</div>
                  <div className="text-sm text-muted">{g[0].dosage}</div>
                </div>
                {badges(g)}
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-track">
                <div className="h-full rounded-full bg-accent" style={{ width: `${(c.day / c.totalDays) * 100}%` }} />
              </div>
              <div className="flex justify-between text-sm text-muted">
                <span>День {c.day} из {c.totalDays}</span>
                <span>до {shortDate(c.endDate, t)}</span>
              </div>
            </article>
          );
        })}
      </section>

      {soon.length > 0 && (
        <section className="flex flex-col gap-2.5">
          <h2 className="text-lg font-bold">Ближайшие старты</h2>
          <div className="divide-y divide-line rounded-2xl bg-surface px-4">
            {soon.map((g) => {
              const next = g[0].forecast.nextStartDate!;
              return (
                <div key={g[0].drug.id} className="flex items-center gap-3.5 py-3">
                  <div className="w-14 text-sm font-semibold">{shortDate(next, t)}</div>
                  <div className="flex-1">
                    <div className="font-semibold">{g[0].drug.name}</div>
                    <div className="text-sm text-muted">через {daysUntil(t, next)} дн.</div>
                  </div>
                  {badges(g)}
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
