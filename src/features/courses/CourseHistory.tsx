import { FlaskConical, Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CoursesApi } from './api';
import { Check } from './components/Check';
import { PersonBadge } from './components/PersonBadge';
import { addDays, daysUntil, plural, shortDate } from './format';
import type { HistoryCourse, LabCheck, Person } from './types';

const DAYS: [string, string, string] = ['день', 'дня', 'дней'];
const field = 'h-11 min-w-0 rounded-xl border border-line bg-surface px-3 text-base text-ink';
const label = 'flex min-w-0 flex-col gap-1 text-sm text-muted';

/** Рядок історії: курси однакових дат (різні люди, препарати комплексу) — разом */
interface Row {
  key: string;
  start: string;
  /** null — курс без срока, ещё идёт */
  end: string | null;
  courses: HistoryCourse[];
}

function toRows(courses: HistoryCourse[]): Row[] {
  const map = new Map<string, Row>();
  for (const c of courses) {
    const key = `${c.startDate}|${c.endDate ?? 'open'}`;
    const row = map.get(key) ?? { key, start: c.startDate, end: c.endDate, courses: [] };
    row.courses.push(c);
    map.set(key, row);
  }
  return [...map.values()];
}

/** «25(OH)D 12 дек: 48 нг/мл» */
const checkLine = (c: LabCheck, today: string) =>
  `${c.name} ${shortDate(c.doneOn!, today)}${c.result ? `: ${c.result}` : ''}`;

/** Здані аналізи рядка історії (усіх його курсів), від ранніх до пізніх */
const checksOf = (r: Row) =>
  r.courses
    .flatMap((x) => x.checks.map((c) => ({ c, personId: x.personId })))
    .sort((a, b) => a.c.doneOn!.localeCompare(b.c.doneOn!));

/** Призначення; для комплексу — з препаратом, щоб бачити, кому з препаратів бракує курсу */
type Rx = { id: number; personId: string; drugId?: number; drugName?: string };

/**
 * Історія курсів препарату чи комплексу: перегляд, внесення минулого курсу,
 * правка дат і видалення. prescriptions — усі призначення (для комплексу — усіх його препаратів).
 */
export function CourseHistory({
  api,
  people,
  target,
  prescriptions,
  courseDays,
  title = 'История курсов',
  onChanged,
}: {
  api: CoursesApi;
  people: Person[];
  target: { drugId: number } | { groupId: number };
  prescriptions: Rx[];
  /** null — без срока */
  courseDays: number | null;
  title?: string;
  onChanged: () => void;
}) {
  const [data, setData] = useState<{ today: string; courses: HistoryCourse[] } | null>(null);
  const [error, setError] = useState('');
  // key рядка, що редагується, або 'new' — форма минулого курсу
  const [open, setOpen] = useState<string | null>(null);
  const targetKey = 'drugId' in target ? `d${target.drugId}` : `g${target.groupId}`;

  const load = useCallback(() => {
    api.history(target).then(setData, (e: Error) => setError(e.message));
    // target — новий об'єкт на кожен рендер, тому залежимо від його ключа
  }, [api, targetKey]);
  useEffect(load, [load]);

  const byId = useMemo(() => new Map(people.map((p, i) => [p.id, { p, primary: i === 0 }])), [people]);
  const nameOf = (id: string) => byId.get(id)?.p.name ?? id;
  const peopleWith = people.filter((p) => prescriptions.some((x) => x.personId === p.id));

  /**
   * Призначення обраних людей, у яких у цьому рядку немає курсу: у комплексі курс
   * міг потрапити не до всіх препаратів (внесли з одного препарату, препарат додали пізніше).
   */
  const missingIn = (r: Row, who: string[]) =>
    'groupId' in target
      ? prescriptions.filter((p) => who.includes(p.personId) && !r.courses.some((c) => c.prescriptionId === p.id))
      : [];
  const missingNames = (missing: Rx[]) => [...new Set(missing.map((p) => p.drugName ?? ''))].filter(Boolean).join(', ');

  const done = () => {
    setOpen(null);
    onChanged();
    load();
  };

  if (error) return <p className="text-sm text-due-ink">{error}</p>;
  if (!data) return null;
  const t = data.today;
  const rows = toRows(data.courses);

  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-bold">{title}</h2>
        {open !== 'new' && peopleWith.length > 0 && (
          <button type="button" onClick={() => setOpen('new')}
            className="-mr-2 flex h-10 items-center gap-1 rounded-xl px-2 text-sm font-semibold text-accent">
            <Plus size={18} aria-hidden="true" />
            Прошедший курс
          </button>
        )}
      </div>

      {open === 'new' && (
        <CourseEditor
          title="Прошедший курс"
          today={t}
          people={peopleWith}
          initialWho={peopleWith.map((p) => p.id)}
          initialStart=""
          initialEnd=""
          courseDays={courseDays}
          submitLabel="Добавить"
          onCancel={() => setOpen(null)}
          onSubmit={async ({ who, start, end }) => {
            const ids = prescriptions.filter((p) => who.includes(p.personId)).map((p) => p.id);
            await api.startCourses(start, ids, end);
            done();
          }}
        />
      )}

      {rows.length === 0 && open !== 'new' && (
        <p className="text-sm text-muted">Курсов ещё не было. Если уже принимали — добавьте прошедший курс.</p>
      )}

      {rows.length > 0 && (
        <div className="divide-y divide-line rounded-2xl bg-surface px-4">
          {rows.map((r) => {
            const persons = [...new Set(r.courses.map((c) => c.personId))];
            // Курс без срока считаем по сегодня
            const length = daysUntil(r.start, r.end ?? t) + 1;
            const state = r.start > t ? 'запланирован' : r.end === null || r.end >= t ? 'идёт сейчас' : '';
            const missing = missingNames(missingIn(r, persons));
            return open === r.key ? (
              <div key={r.key} className="py-3">
                <CourseEditor
                  title="Изменить курс"
                  today={t}
                  people={people.filter((p) => persons.includes(p.id))}
                  initialWho={persons}
                  initialStart={r.start}
                  initialEnd={r.end ?? ''}
                  courseDays={courseDays}
                  submitLabel="Сохранить"
                  note={missing ? `Курс добавится и для: ${missing}` : ''}
                  onCancel={() => setOpen(null)}
                  onSubmit={async ({ who, start, end }) => {
                    for (const c of r.courses.filter((c) => who.includes(c.personId))) {
                      // Пустой конец у курса без срока — он продолжается
                      await api.updateCourse(c.id, end ? { startDate: start, endDate: end } : { startDate: start });
                    }
                    const add = missingIn(r, who).map((p) => p.id);
                    if (add.length > 0) await api.startCourses(start, add, end || undefined);
                    done();
                  }}
                  onDelete={async (who) => {
                    for (const c of r.courses.filter((c) => who.includes(c.personId))) await api.deleteCourse(c.id);
                    done();
                  }}
                  checks={checksOf(r).map(({ c, personId }) => ({
                    id: c.id,
                    text: checkLine(c, t) + (persons.length > 1 ? ` · ${nameOf(personId)}` : ''),
                  }))}
                  onDeleteCheck={async (id) => {
                    await api.deleteCheck(id);
                    done();
                  }}
                />
              </div>
            ) : (
              <button key={r.key} type="button" onClick={() => setOpen(r.key)}
                className="flex w-full items-center gap-3 py-3 text-left">
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="font-semibold">
                    {shortDate(r.start, t)} — {r.end ? shortDate(r.end, t) : 'сейчас'}
                  </span>
                  <span className="text-sm text-muted">
                    {length} {plural(length, DAYS)}
                    {state && <span className="font-medium text-accent"> · {state}</span>}
                  </span>
                  {missing && <span className="text-sm font-medium text-due-ink">Нет у: {missing}</span>}
                  {checksOf(r).map(({ c, personId }) => (
                    <span key={c.id} className="flex items-start gap-1.5 text-sm text-ink">
                      <FlaskConical size={15} aria-hidden="true" className="mt-0.5 shrink-0 text-muted" />
                      <span>
                        {checkLine(c, t)}
                        {persons.length > 1 && <span className="text-muted"> · {nameOf(personId)}</span>}
                        {c.note && <span className="block text-muted">{c.note}</span>}
                      </span>
                    </span>
                  ))}
                </span>
                <span className="flex gap-1">
                  {people
                    .filter((p) => persons.includes(p.id))
                    .map((p) => {
                      const b = byId.get(p.id)!;
                      return <PersonBadge key={p.id} person={b.p} primary={b.primary} />;
                    })}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

/** Форма дат курсу: внесення минулого або правка наявного */
function CourseEditor({
  title,
  today,
  people,
  initialWho,
  initialStart,
  initialEnd,
  courseDays,
  submitLabel,
  note = '',
  onCancel,
  onSubmit,
  onDelete,
  checks = [],
  onDeleteCheck,
}: {
  title: string;
  today: string;
  people: Person[];
  initialWho: string[];
  initialStart: string;
  /** '' — без конца: для нового курса его надо указать, у курса без срока можно оставить пустым */
  initialEnd: string;
  courseDays: number | null;
  submitLabel: string;
  /** Пояснення під датами, напр. що курс допишеться іншим препаратам комплексу */
  note?: string;
  onCancel: () => void;
  onSubmit: (v: { who: string[]; start: string; end: string }) => Promise<void>;
  onDelete?: (who: string[]) => Promise<void>;
  /** Здані аналізи курсу — щоб прибрати внесений помилково */
  checks?: { id: number; text: string }[];
  onDeleteCheck?: (id: number) => Promise<void>;
}) {
  const [who, setWho] = useState<string[]>(initialWho);
  const [start, setStart] = useState(initialStart);
  const [end, setEnd] = useState(initialEnd);
  // Поки кінець не чіпали вручну, він іде за стартом: старт + тривалість курсу, але не пізніше сьогодні
  const [endTouched, setEndTouched] = useState(initialEnd !== '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const isNew = !onDelete;

  function changeStart(v: string) {
    setStart(v);
    if (!endTouched && v && courseDays !== null) {
      const planned = addDays(v, courseDays - 1);
      setEnd(planned > today ? today : planned);
    }
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  // Идущий курс без срока можно править, не задавая конец
  const openAllowed = !isNew && initialEnd === '';
  const invalid =
    !start || (!end && !openAllowed) || (!!end && end < start) || (isNew && end > today) || who.length === 0;
  const length = start && end && end >= start ? daysUntil(start, end) + 1 : 0;

  return (
    <div className={`flex flex-col gap-3 ${isNew ? 'rounded-2xl bg-surface p-4' : ''}`}>
      <h3 className="font-semibold">{title}</h3>
      {people.length > 1 && (
        <div role="group" aria-label="Для кого" className="flex flex-wrap gap-x-5 gap-y-2">
          {people.map((p) => (
            <label key={p.id} className="flex cursor-pointer items-center gap-2 font-medium">
              <Check
                checked={who.includes(p.id)}
                onChange={() => setWho((w) => (w.includes(p.id) ? w.filter((x) => x !== p.id) : [...w, p.id]))}
              />
              {p.name}
            </label>
          ))}
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <label className={label}>
          Начали
          <input type="date" value={start} max={today} required onChange={(e) => changeStart(e.target.value)} className={field} />
        </label>
        <label className={label}>
          Последний день
          <input type="date" value={end} min={start || undefined} max={isNew ? today : undefined} required={!openAllowed}
            onChange={(e) => {
              setEnd(e.target.value);
              setEndTouched(true);
            }}
            className={field} />
        </label>
      </div>
      <p className="text-[13px] text-muted">
        {length > 0
          ? `${length} ${plural(length, DAYS)}`
          : openAllowed
            ? 'Без срока — оставьте последний день пустым, пока курс идёт'
            : 'Укажите даты'}
        {isNew && courseDays !== null && ' · по схеме — ' + courseDays + ' ' + plural(courseDays, DAYS)}
      </p>
      {note && <p className="text-[13px] font-medium text-due-ink">{note}</p>}
      {error && <p className="text-sm text-due-ink">{error}</p>}
      <div className="flex gap-2">
        <button type="button" disabled={busy || invalid} onClick={() => run(() => onSubmit({ who, start, end }))}
          className="h-11 flex-1 rounded-xl bg-accent font-semibold text-white disabled:opacity-50">
          {submitLabel}
        </button>
        <button type="button" disabled={busy} onClick={onCancel}
          className="h-11 rounded-xl border border-line px-4 font-semibold text-muted">
          Отмена
        </button>
      </div>
      {checks.length > 0 && onDeleteCheck && (
        <div className="flex flex-col gap-1">
          <h4 className="text-sm text-muted">Анализы</h4>
          {checks.map((c) => (
            <div key={c.id} className="flex items-center gap-2 text-sm">
              <span className="min-w-0 flex-1">{c.text}</span>
              <button type="button" disabled={busy}
                onClick={() => window.confirm(`Удалить анализ «${c.text}»?`) && run(() => onDeleteCheck(c.id))}
                className="h-9 shrink-0 px-2 font-semibold text-due-ink disabled:opacity-50">
                Удалить
              </button>
            </div>
          ))}
        </div>
      )}
      {onDelete && (
        <button type="button" disabled={busy || who.length === 0}
          onClick={() => {
            const until = initialEnd ? shortDate(initialEnd, today) : 'сейчас';
            if (window.confirm(`Удалить курс ${shortDate(initialStart, today)} — ${until}? Он исчезнет из истории.`)) {
              run(() => onDelete(who));
            }
          }}
          className="h-10 self-center px-3 text-sm font-semibold text-due-ink disabled:opacity-50">
          Удалить курс
        </button>
      )}
    </div>
  );
}
