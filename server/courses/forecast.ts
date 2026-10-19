import { addDays, diffDays, maxDate, yearOf, type ISODate } from './dates';

/**
 * Правила розрахунку (усі межі включні):
 *  - курс тривалістю N днів, що стартує в день S, закінчується в S + N − 1;
 *  - курс «без строку» (courseDays = null) іде, доки його не завершать;
 *  - фактичний кінець = дата дострокового завершення, якщо є, інакше плановий;
 *  - перерва B днів — це B повних днів між курсами: наступний старт = кінець + B + 1;
 *  - «не повторювати автоматично» (manualRepeat): після кінця курсу прогнозу немає,
 *    статус 'done' — наступний курс лише за рішенням (лікаря);
 *  - ліміт «курсів на рік» рахує курси за датою СТАРТУ в календарному році;
 *    якщо ліміт року вичерпано, наступний старт переноситься на 1 січня наступного року;
 *  - «починати після» іншого препарату: старт не може припасти на його курс —
 *    якщо припадає, переноситься на день після кінця цього курсу (blockers — його курси);
 *    якщо той курс без строку і ще йде — дата невідома (null).
 */

export interface DrugScheme {
  /** null — без строку */
  courseDays: number | null;
  breakDays: number;
  /** null — без ліміту */
  coursesPerYear: number | null;
  /** Не повторювати автоматично */
  manualRepeat: boolean;
}

export interface CourseRecord {
  startDate: ISODate;
  /** null — курс без строку */
  plannedEndDate: ISODate | null;
  endedEarlyOn: ISODate | null;
}

export type Status = 'active' | 'due' | 'break' | 'done';

export interface Forecast {
  status: Status;
  /** Курс, що йде сьогодні; endDate і totalDays — null, якщо він без строку */
  activeCourse:
    | (CourseRecord & { endDate: ISODate | null; day: number; totalDays: number | null })
    | null;
  /** Кінець останнього завершеного або поточного курсу; null — не приймали або йде курс без строку */
  lastEndDate: ISODate | null;
  /**
   * Найближча дата, з якої можна стартувати. null — препарат ще не приймали (і можна зараз),
   * повтору немає (без строку, 'done') або чекаємо попередника без строку.
   */
  nextStartDate: ISODate | null;
  /** Для status = 'due': скільки днів тому настала дата старту */
  overdueDays: number;
}

/** Кінець для порівнянь, коли курс без строку і ще йде */
export const FOREVER = '9999-12-31';

export function plannedEnd(startDate: ISODate, courseDays: number | null): ISODate | null {
  return courseDays === null ? null : addDays(startDate, courseDays - 1);
}

/** Фактичний кінець; FOREVER — курс без строку, ще не завершений */
export function endOf(c: CourseRecord): ISODate {
  return c.endedEarlyOn ?? c.plannedEndDate ?? FOREVER;
}

const shown = (d: ISODate): ISODate | null => (d === FOREVER ? null : d);

/** Найраніший старт не раніше candidate з урахуванням ліміту курсів на рік. */
function applyYearLimit(candidate: ISODate, scheme: DrugScheme, startsSoFar: ISODate[]): ISODate {
  if (scheme.coursesPerYear === null) return candidate;
  let date = candidate;
  // Цикл, бо рік переносу теж може бути вичерпаний (теоретично, якщо курси вже заплановані вперед)
  for (let guard = 0; guard < 10; guard++) {
    const year = yearOf(date);
    const used = startsSoFar.filter((s) => yearOf(s) === year).length;
    if (used < scheme.coursesPerYear) return date;
    date = `${year + 1}-01-01`;
  }
  return date;
}

/** Зсуває дату за межі курсу-попередника, на який вона припадає; null — той курс без строку. */
function afterBlockers(date: ISODate, blockers: CourseRecord[]): ISODate | null {
  let d = date;
  for (let moved = true, guard = 0; moved && guard < 50; guard++) {
    moved = false;
    for (const b of blockers) {
      if (b.startDate <= d && d <= endOf(b)) {
        if (endOf(b) === FOREVER) return null;
        d = addDays(endOf(b), 1);
        moved = true;
      }
    }
  }
  return d;
}

/** Найраніший старт не раніше candidate з урахуванням і ліміту на рік, і попередника. */
function earliestStart(
  candidate: ISODate,
  scheme: DrugScheme,
  starts: ISODate[],
  blockers: CourseRecord[],
): ISODate | null {
  let d = candidate;
  for (let guard = 0; guard < 10; guard++) {
    const free = afterBlockers(d, blockers);
    if (free === null) return null;
    const next = applyYearLimit(free, scheme, starts);
    if (next === d) return d;
    d = next;
  }
  return d;
}

export function forecast(
  scheme: DrugScheme,
  courses: CourseRecord[],
  today: ISODate,
  blockers: CourseRecord[] = [],
): Forecast {
  const sorted = [...courses].sort((a, b) => a.startDate.localeCompare(b.startDate));
  const started = sorted.filter((c) => c.startDate <= today);
  const none = { activeCourse: null, lastEndDate: null, nextStartDate: null, overdueDays: 0 };

  if (started.length === 0) {
    // Ще не приймали: можна сьогодні, якщо зараз не йде курс попередника
    const wait = afterBlockers(today, blockers);
    if (wait === today) return { ...none, status: 'due' };
    return { ...none, status: 'break', nextStartDate: wait };
  }

  const last = started[started.length - 1];
  const lastEnd = endOf(last);
  const starts = sorted.map((c) => c.startDate);
  // Повтор за схемою: немає, якщо «не повторювати» або поточний курс без строку
  const own = scheme.manualRepeat || lastEnd === FOREVER ? null : addDays(lastEnd, scheme.breakDays + 1);

  if (today <= lastEnd) {
    return {
      status: 'active',
      activeCourse: {
        ...last,
        endDate: shown(lastEnd),
        day: diffDays(last.startDate, today) + 1,
        totalDays: last.plannedEndDate === null ? null : diffDays(last.startDate, last.plannedEndDate) + 1,
      },
      lastEndDate: shown(lastEnd),
      nextStartDate: own === null ? null : earliestStart(own, scheme, starts, blockers),
      overdueDays: 0,
    };
  }

  if (own === null) return { ...none, status: 'done', lastEndDate: lastEnd };

  let nextStartDate = earliestStart(own, scheme, starts, blockers);
  // Якщо власна перерва вже минула, реальний старт — сьогодні; попередника перевіряємо саме на цю дату
  if (own <= today) {
    const fromToday = earliestStart(maxDate(nextStartDate ?? today, today), scheme, starts, blockers);
    if (fromToday === null || fromToday > today) nextStartDate = fromToday;
  }

  if (nextStartDate === null) return { ...none, status: 'break', lastEndDate: lastEnd };
  const isDue = nextStartDate <= today;
  return {
    status: isDue ? 'due' : 'break',
    activeCourse: null,
    lastEndDate: lastEnd,
    nextStartDate,
    overdueDays: isDue ? diffDays(nextStartDate, today) : 0,
  };
}

export interface ProjectedCourse {
  startDate: ISODate;
  endDate: ISODate;
  kind: 'actual' | 'forecast';
}

/**
 * Курси для діаграми «План»: фактичні, що перетинають [from, to],
 * плюс прогнозні до дати to. Якщо курс уже «пора» починати,
 * прогноз припускає старт сьогодні. Курс без строку малюється до to.
 */
export function project(
  scheme: DrugScheme,
  courses: CourseRecord[],
  today: ISODate,
  from: ISODate,
  to: ISODate,
  blockers: CourseRecord[] = [],
): ProjectedCourse[] {
  const clip = (d: ISODate) => (d > to ? to : d);
  const result: ProjectedCourse[] = courses
    .filter((c) => c.startDate <= to && endOf(c) >= from)
    .map((c) => ({ startDate: c.startDate, endDate: clip(endOf(c)), kind: 'actual' as const }));

  const f = forecast(scheme, courses, today, blockers);
  const starts = courses.map((c) => c.startDate);
  let start: ISODate | null =
    f.status === 'due' ? maxDate(f.nextStartDate ?? today, today) : f.status === 'done' ? null : f.nextStartDate;
  if (start !== null) start = earliestStart(start, scheme, starts, blockers);

  for (let guard = 0; guard < 50 && start !== null && start <= to; guard++) {
    const end = plannedEnd(start, scheme.courseDays) ?? to;
    if (end >= from) result.push({ startDate: start, endDate: clip(end), kind: 'forecast' });
    // Без повтору — лише один прогнозний курс
    if (scheme.manualRepeat || scheme.courseDays === null) break;
    starts.push(start);
    start = earliestStart(addDays(end, scheme.breakDays + 1), scheme, starts, blockers);
  }
  return result.sort((a, b) => a.startDate.localeCompare(b.startDate));
}
