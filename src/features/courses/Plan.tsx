import { ChevronRight } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CoursesApi } from './api';
import { PersonSwitch } from './components/PersonSwitch';
import { DrugSheet } from './Drugs';
import { addDays, daysUntil, plural, shortDate } from './format';
import type { Person, Plan, PlanCourse, PlanRow } from './types';
import { useOnVisible } from './useOnVisible';

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

/** Скільки місяців показувати; період починається з першого числа минулого місяця */
const RANGES = [
  { months: 3, label: '3 мес' },
  { months: 6, label: 'Полгода' },
  { months: 12, label: 'Год' },
];

/** '2026-10-19', -1 → '2026-09-01' */
function monthStart(d: string, shift: number): string {
  const [y, m] = d.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + shift, 1)).toISOString().slice(0, 10);
}

/** Сьогодні за годинником телефона: потрібне лише для меж періоду, «сьогодні» для діаграми дає сервер */
const localToday = () => new Date().toLocaleDateString('sv');

/** Рядок діаграми: комплекс або препарат × людина */
interface Track { personId: string; courses: PlanCourse[] }
interface Unit { key: string; name: string; target: { drugId: number } | { groupId: number }; drugs: number; tracks: Track[] }

function toUnits(rows: PlanRow[], people: Person[]): Unit[] {
  const units = new Map<string, Unit & { drugIds: Set<number>; byPerson: Map<string, Map<string, PlanCourse>> }>();
  for (const r of rows) {
    const key = r.group ? `g${r.group.id}` : `d${r.drugId}`;
    let u = units.get(key);
    if (!u) {
      u = {
        key,
        name: r.group?.name ?? r.drugName,
        target: r.group ? { groupId: r.group.id } : { drugId: r.drugId },
        drugs: 0,
        tracks: [],
        drugIds: new Set(),
        byPerson: new Map(),
      };
      units.set(key, u);
    }
    u.drugIds.add(r.drugId);
    // Препарати комплексу йдуть одними датами — однакові відрізки зливаємо
    const courses = u.byPerson.get(r.personId) ?? new Map<string, PlanCourse>();
    for (const c of r.courses) courses.set(`${c.startDate}|${c.endDate}|${c.kind}`, c);
    u.byPerson.set(r.personId, courses);
  }
  const order = (id: string) => people.findIndex((p) => p.id === id);
  return [...units.values()]
    .map(({ key, name, target, drugIds, byPerson }) => ({
      key,
      name,
      target,
      drugs: drugIds.size,
      tracks: [...byPerson]
        .map(([personId, c]) => ({
          personId,
          courses: [...c.values()].sort((a, b) => a.startDate.localeCompare(b.startDate)),
        }))
        .sort((a, b) => order(a.personId) - order(b.personId)),
    }))
    .filter((u) => u.tracks.some((t) => t.courses.length > 0));
}

/** Порядок: що йде зараз, потім що почнеться раніше, наприкінці — лише минулі курси */
function sortKey(u: Unit, today: string): string {
  const all = u.tracks.flatMap((t) => t.courses);
  if (all.some((c) => c.startDate <= today && c.endDate >= today)) return '0';
  const next = all.filter((c) => c.startDate > today).map((c) => c.startDate).sort()[0];
  return next ? `1${next}` : '2';
}

/**
 * Підпис доріжки словами: що зараз і що далі.
 * «Пора начинать» — прогноз, що стартує сьогодні: перерву вже закінчено (або ще не приймали).
 */
function summary(courses: PlanCourse[], plan: Plan): { text: string; due: boolean } {
  const t = plan.today;
  const d = (x: string) => shortDate(x, t);
  const cur = courses.find((c) => c.kind === 'actual' && c.startDate <= t && c.endDate >= t);
  const next = courses.find((c) => c.kind === 'forecast' && c.startDate > t);
  const nextText = next ? `следующий ${d(next.startDate)} – ${d(next.endDate)}` : '';
  if (cur) {
    // Кінець обрізано межею періоду: курс без строку або закінчиться пізніше
    const now = cur.endDate >= plan.to ? 'Идёт сейчас' : `Идёт сейчас, до ${d(cur.endDate)} (ещё ${daysUntil(t, cur.endDate) + 1} ${plural(daysUntil(t, cur.endDate) + 1, ['день', 'дня', 'дней'])})`;
    return { text: [now, nextText].filter(Boolean).join(' · '), due: false };
  }
  const now = courses.find((c) => c.kind === 'forecast' && c.startDate === t);
  if (now) {
    // Кінець обрізано межею періоду — дату не обіцяємо
    return { text: now.endDate >= plan.to ? 'Пора начинать' : `Пора начинать: если сегодня, то до ${d(now.endDate)}`, due: true };
  }
  const last = courses.filter((c) => c.kind === 'actual' && c.endDate < t).at(-1);
  const pause = last ? `Перерыв после курса ${d(last.startDate)} – ${d(last.endDate)}` : '';
  if (next) return { text: [pause || 'Не начат', nextText].join(' · '), due: false };
  return { text: last ? `Последний курс ${d(last.startDate)} – ${d(last.endDate)}` : '', due: false };
}

const kindText = (c: PlanCourse, today: string) =>
  c.kind === 'actual' ? 'курс' : c.startDate === today ? 'пора начинать' : 'прогноз';

export function PlanView({ api, people }: { api: CoursesApi; people: Person[] }) {
  // За замовчуванням — поточний користувач (він першим у people), як на «Сегодня»
  const [pickedPerson, setPerson] = useState('');
  const person = pickedPerson || people[0]?.id || '';
  const [months, setMonths] = useState(6);
  const [data, setData] = useState<Plan | null>(null);
  const [error, setError] = useState('');
  const [opened, setOpened] = useState<{ drugId: number } | { groupId: number } | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!person) return;
    const from = monthStart(localToday(), -1);
    const to = addDays(monthStart(localToday(), months - 1), -1);
    api.plan(from, to, person).then(setData, (e: Error) => setError(e.message));
  }, [api, person, months, version]);
  useOnVisible(useCallback(() => setVersion((v) => v + 1), []));

  const units = useMemo(() => {
    if (!data) return [];
    return toUnits(data.rows, people).sort(
      (a, b) => sortKey(a, data.today).localeCompare(sortKey(b, data.today)) || a.name.localeCompare(b.name, 'ru'),
    );
  }, [data, people]);

  if (error) return <p className="p-5 text-due-ink">{error}</p>;

  const names = new Map(people.map((p) => [p.id, p.name]));
  // Ім'я в підписі лише коли показані обоє: інакше кожен рядок — одна людина
  const labelled = person === 'all';

  return (
    <div className="flex flex-col gap-5 px-5 pt-6 pb-6">
      {opened && (
        <DrugSheet
          api={api}
          people={people}
          target={opened}
          backLabel="План"
          onClose={(changed) => {
            setOpened(null);
            if (changed) setVersion((v) => v + 1);
          }}
        />
      )}
      <header>
        <h1 className="text-3xl font-bold tracking-tight">План</h1>
      </header>

      <PersonSwitch people={people} value={person} onChange={setPerson} />

      <div role="group" aria-label="Период" className="flex gap-1 self-start rounded-[10px] bg-track p-[3px]">
        {RANGES.map((r) => (
          <button
            key={r.months}
            type="button"
            aria-pressed={months === r.months}
            onClick={() => setMonths(r.months)}
            className={`h-[34px] rounded-lg px-3.5 text-sm ${
              months === r.months ? 'bg-surface font-semibold text-ink' : 'text-muted'
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>

      {/* Легенда зверху: без неї смуги не прочитати */}
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted">
        <Legend className="bg-accent" text="Курс: был или идёт" />
        <Legend className="border border-dashed border-accent bg-accent-soft" text="Следующий по схеме" />
        <Legend className="border border-due bg-due-soft" text="Пора начинать" />
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-0.5 rounded-full bg-ink" />
          Сегодня
        </span>
      </div>

      {data && (
        <div className="flex flex-col gap-2.5">
          {/* Шкала місяців; відступи як у картки, щоб збігалася з доріжками */}
          <div aria-hidden="true" className="sticky top-0 z-10 -mx-5 flex bg-ground px-9 py-1.5">
            <MonthScale from={data.from} to={data.to} />
          </div>

          {units.length === 0 && <p className="text-sm text-muted">В этом периоде нет курсов.</p>}

          {units.map((u) => (
            <button
              key={u.key}
              type="button"
              onClick={() => setOpened(u.target)}
              className="flex flex-col gap-2 rounded-2xl bg-surface px-4 py-3 text-left"
            >
              <span className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-semibold">{u.name}</span>
                {'groupId' in u.target && (
                  <span className="shrink-0 text-sm text-muted">
                    {u.drugs} {plural(u.drugs, ['препарат', 'препарата', 'препаратов'])}
                  </span>
                )}
                <ChevronRight size={18} aria-hidden="true" className="-mr-1 shrink-0 text-muted/60" />
              </span>
              {u.tracks.map((t) => {
                const sum = summary(t.courses, data);
                return (
                  <span key={t.personId} className="flex flex-col gap-1.5">
                    <span className="text-sm text-muted">
                      {labelled && <span className="font-semibold text-ink">{names.get(t.personId) ?? t.personId}: </span>}
                      <span className={sum.due ? 'font-medium text-due-ink' : ''}>{sum.text}</span>
                    </span>
                    <Bars
                      plan={data}
                      courses={t.courses}
                      label={`${labelled ? `${names.get(t.personId) ?? t.personId}: ` : ''}${
                        t.courses.map((c) => `${shortDate(c.startDate, data.today)} – ${shortDate(c.endDate, data.today)}, ${kindText(c, data.today)}`).join('; ') || 'нет курсов'
                      }`}
                    />
                  </span>
                );
              })}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Позиція дати на шкалі у відсотках; кінець дня — тому +1 для правої межі */
const pos = (plan: Plan, d: string, endOfDay = false) =>
  ((daysUntil(plan.from, d) + (endOfDay ? 1 : 0)) / (daysUntil(plan.from, plan.to) + 1)) * 100;

function MonthScale({ from, to }: { from: string; to: string }) {
  const plan = { from, to } as Plan;
  const starts: string[] = [];
  for (let m = from; m <= to; m = monthStart(m, 1)) starts.push(m);
  // На довгому періоді підписуємо кожен другий місяць, інакше підписи налазять один на одний.
  // Рік — на першому підписаному місяці нового року, щоб на шкалі «Год» було видно перехід.
  const step = starts.length > 7 ? 2 : 1;
  let year = from.slice(0, 4);
  return (
    <div className="relative h-4 flex-1">
      {starts.map((m, i) => {
        const shown = i % step === 0;
        const newYear = shown && m.slice(0, 4) !== year;
        if (newYear) year = m.slice(0, 4);
        return (
          <span
            key={m}
            className="absolute top-0 border-l border-line pl-1 text-[11px] leading-4 whitespace-nowrap text-muted"
            style={{ left: `${pos(plan, m)}%` }}
          >
            {shown && `${MONTHS[Number(m.slice(5, 7)) - 1]}${newYear ? ` ${m.slice(2, 4)}` : ''}`}
          </span>
        );
      })}
    </div>
  );
}

function Bars({ plan, courses, label }: { plan: Plan; courses: PlanCourse[]; label: string }) {
  const months: string[] = [];
  for (let m = monthStart(plan.from, 1); m <= plan.to; m = monthStart(m, 1)) months.push(m);
  return (
    <span role="img" aria-label={label} className="relative block h-5 w-full rounded-md bg-ground">
      {months.map((m) => (
        <span key={m} className="absolute inset-y-0 border-l border-line/70" style={{ left: `${pos(plan, m)}%` }} />
      ))}
      {courses.map((c) => {
        const tone =
          c.kind === 'actual'
            ? 'bg-accent'
            : c.startDate === plan.today
              ? 'border border-due bg-due-soft'
              : 'border border-dashed border-accent bg-accent-soft';
        // Сервер обрізає лише кінець; курс, що почався до періоду, починаємо від лівого краю
        const left = pos(plan, c.startDate < plan.from ? plan.from : c.startDate);
        return (
          <span
            key={`${c.startDate}|${c.kind}`}
            className={`absolute inset-y-0.5 min-w-1 rounded ${tone}`}
            style={{ left: `${left}%`, width: `${pos(plan, c.endDate, true) - left}%` }}
          />
        );
      })}
      {plan.today >= plan.from && plan.today <= plan.to && (
        <span
          className="absolute -inset-y-0.5 w-0.5 -translate-x-1/2 rounded-full bg-ink"
          style={{ left: `${(pos(plan, plan.today) + pos(plan, plan.today, true)) / 2}%` }}
        />
      )}
    </span>
  );
}

function Legend({ className, text }: { className: string; text: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`h-3 w-5 rounded ${className}`} />
      {text}
    </span>
  );
}
