import { ChevronDown } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { CoursesApi } from './api';
import { Check } from './components/Check';
import { PersonBadge } from './components/PersonBadge';
import { PersonSwitch } from './components/PersonSwitch';
import { EditCourse } from './EditCourse';
import { StartCourse } from './StartCourse';
import { daysUntil, plural, shortDate } from './format';
import type { Overview, OverviewItem, Person } from './types';
import { afterText, drugLines, groupByUnit, uniquePeople, unitKey, unitName } from './units';

/** «через 12 дн.» + «после «Витамины B»» через крапку */
const join = (...parts: string[]) => parts.filter(Boolean).join(' · ');

const uniqueDrugs = (g: OverviewItem[]) => [...new Map(g.map((i) => [i.drug.id, i.drug])).values()];

export function Today({ api, people }: { api: CoursesApi; people: Person[] }) {
  const [person, setPerson] = useState('all');
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState('');
  // Відкритий екран «Начать курс»; preselected — призначення, позначені тут, у «Пора начинать»
  const [starting, setStarting] = useState<{ preselected?: number[] } | null>(null);
  // Позначені в «Пора начинать» одиниці (unitKey)
  const [picked, setPicked] = useState<Set<string>>(new Set());
  // Комплекси, розгорнуті до списку препаратів
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [startError, setStartError] = useState('');
  const [busy, setBusy] = useState(false);
  // Активний курс, відкритий для виправлення (призначення одного препарату чи комплексу)
  const [editing, setEditing] = useState<OverviewItem[] | null>(null);
  // Збільшується після старту курсів, щоб перечитати огляд
  const [version, setVersion] = useState(0);

  useEffect(() => {
    api.overview(person).then(setData, (e: Error) => setError(e.message));
  }, [api, person, version]);

  const byId = useMemo(() => new Map(people.map((p, i) => [p.id, { p, primary: i === 0 }])), [people]);
  const badges = (group: OverviewItem[]) => (
    <span className="flex gap-1">
      {uniquePeople(group).map((i) => {
        const b = byId.get(i.personId);
        return b ? <PersonBadge key={i.personId} person={b.p} primary={b.primary} /> : null;
      })}
    </span>
  );

  if (error) return <p className="p-5 text-due-ink">{error}</p>;
  if (!data) return null;

  const t = data.today;
  const due = groupByUnit(data.items.filter((i) => i.forecast.status === 'due'));
  const active = groupByUnit(data.items.filter((i) => i.forecast.status === 'active'));
  const chosen = due.filter((g) => picked.has(unitKey(g[0])));
  const chosenIds = chosen.flatMap((g) => g.map((i) => i.prescriptionId));
  const toggleIn = (set: typeof setPicked) => (key: string) =>
    set((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const toggleExpanded = toggleIn(setExpanded);

  /** Дозування препарату комплексу: одне на всіх або «Марина: … · Костя: …» */
  const dosageOf = (g: OverviewItem[], drugId: number) => {
    const rows = g.filter((i) => i.drug.id === drugId);
    if (rows.every((r) => r.dosage === rows[0].dosage)) return rows[0].dosage;
    return join(...rows.filter((r) => r.dosage).map((r) => `${byId.get(r.personId)?.p.name ?? r.personId}: ${r.dosage}`));
  };

  const togglePick = toggleIn(setPicked);

  async function startToday() {
    setBusy(true);
    setStartError('');
    try {
      await api.startCourses(t, chosenIds);
      setPicked(new Set());
      setVersion((v) => v + 1);
    } catch (e) {
      setStartError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const soon = groupByUnit(data.items.filter((i) => i.forecast.status === 'break')).sort((a, b) =>
    a[0].forecast.nextStartDate!.localeCompare(b[0].forecast.nextStartDate!),
  );

  return (
    <div className="flex flex-col gap-5 px-5 pt-6 pb-6">
      {starting && (
        <StartCourse
          api={api}
          people={people}
          initialPerson={person}
          preselected={starting.preselected}
          onClose={(changed) => {
            setStarting(null);
            if (changed) {
              setPicked(new Set());
              setVersion((v) => v + 1);
            }
          }}
        />
      )}
      {editing && (
        <EditCourse
          api={api}
          people={people}
          items={editing}
          today={t}
          onClose={(changed) => {
            setEditing(null);
            if (changed) setVersion((v) => v + 1);
          }}
        />
      )}
      <header>
        <p className="text-sm text-muted">{shortDate(t, t)}</p>
        <h1 className="text-3xl font-bold tracking-tight">Сегодня</h1>
      </header>

      <PersonSwitch people={people} value={person} onChange={setPerson} />

      {due.length > 0 && (
        <section className="flex flex-col gap-2.5">
          <h2 className="flex items-center gap-2 text-lg font-bold">
            Пора начинать
            <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-due px-1.5 text-[13px] font-semibold text-white">
              {due.length}
            </span>
          </h2>
          {due.map((g) => {
            const f = g[0].forecast;
            const key = unitKey(g[0]);
            const drugs = uniqueDrugs(g).length;
            // Ржавим лише справжнє «пора», а не «ще не приймали»
            const when =
              f.nextStartDate === null
                ? ''
                : f.overdueDays === 0
                  ? 'Перерыв закончился сегодня'
                  : `Перерыв закончился ${shortDate(f.nextStartDate, t)}`;
            const rest = join(when ? '' : 'Ещё не принимали', afterText(g[0]));
            const open = expanded.has(key);
            return (
              <div
                key={key}
                className="flex flex-col rounded-2xl bg-surface ring-1 ring-transparent transition-colors ring-inset has-checked:bg-due-soft has-checked:ring-due/35 motion-reduce:transition-none"
              >
                <label className={`flex cursor-pointer items-center gap-3.5 px-4 ${g[0].group ? 'pt-3 pb-1' : 'py-3'}`}>
                  <Check tone="due" checked={picked.has(key)} onChange={() => togglePick(key)} />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="font-semibold">{unitName(g[0])}</span>
                    <span className="text-sm text-muted">
                      {when && <span className="font-medium text-due-ink">{when}</span>}
                      {when && rest && ' · '}
                      {rest}
                    </span>
                  </span>
                  {badges(g)}
                </label>
                {g[0].group && (
                  // Окремо від label, щоб розгортання не перемикало галочку; 54px — відступ під текст рядка
                  <div className="flex flex-col pr-4 pb-2 pl-[54px]">
                    <button
                      type="button"
                      aria-expanded={open}
                      onClick={() => toggleExpanded(key)}
                      className="-ml-2 flex h-8 items-center gap-1 self-start rounded-lg px-2 text-sm font-medium text-accent"
                    >
                      {drugs} {plural(drugs, ['препарат', 'препарата', 'препаратов'])}
                      <ChevronDown
                        size={16}
                        aria-hidden="true"
                        className={`transition-transform motion-reduce:transition-none ${open ? 'rotate-180' : ''}`}
                      />
                    </button>
                    {open && (
                      <ul className="mt-1 mb-1 flex flex-col gap-2 border-l-2 border-line pl-3">
                        {uniqueDrugs(g).map((d) => {
                          const dosage = dosageOf(g, d.id);
                          return (
                            <li key={d.id} className="flex flex-col">
                              <span className="text-[15px] font-medium">{d.name}</span>
                              {dosage && <span className="text-sm text-muted">{dosage}</span>}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {startError && <p className="text-sm text-due-ink">{startError}</p>}
          {chosen.length === 0 ? (
            <button type="button" onClick={() => setStarting({})}
              className="mt-1 h-12 rounded-xl bg-due-soft font-semibold text-due-ink">
              Выбрать и начать
            </button>
          ) : (
            <div className="mt-1 flex flex-col gap-1">
              <button type="button" disabled={busy} onClick={startToday}
                className="h-12 rounded-xl bg-due font-semibold text-white disabled:opacity-60">
                Начать {chosen.length} {plural(chosen.length, ['курс', 'курса', 'курсов'])} сегодня
              </button>
              <button type="button" onClick={() => setStarting({ preselected: chosenIds })}
                className="h-10 self-center px-3 text-sm font-semibold text-due-ink">
                Выбрать другую дату
              </button>
            </div>
          )}
        </section>
      )}

      <section className="flex flex-col gap-2.5">
        <h2 className="text-lg font-bold">Активные курсы</h2>
        {active.length === 0 && <p className="text-sm text-muted">Сейчас ничего не принимаете.</p>}
        {active.map((g) => {
          const c = g[0].forecast.activeCourse!;
          return (
            <button
              key={unitKey(g[0])}
              type="button"
              onClick={() => setEditing(g)}
              className="flex flex-col gap-2.5 rounded-2xl bg-surface px-4 py-3.5 text-left"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-semibold">{unitName(g[0])}</div>
                  {g[0].group ? (
                    drugLines(g).map((d) => (
                      <div key={d.name} className="text-sm text-muted">
                        {d.dosage ? `${d.name} — ${d.dosage}` : d.name}
                      </div>
                    ))
                  ) : (
                    <div className="text-sm text-muted">{g[0].dosage}</div>
                  )}
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
            </button>
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
                <div key={unitKey(g[0])} className="flex items-center gap-3.5 py-3">
                  <div className="w-14 text-sm font-semibold">{shortDate(next, t)}</div>
                  <div className="flex-1">
                    <div className="font-semibold">{unitName(g[0])}</div>
                    <div className="text-sm text-muted">{join(`через ${daysUntil(t, next)} дн.`, afterText(g[0]))}</div>
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
