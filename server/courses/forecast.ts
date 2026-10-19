import { addDays, diffDays, maxDate, yearOf, type ISODate } from './dates';

/**
 * Правила розрахунку (усі межі включні):
 *  - курс тривалістю N днів, що стартує в день S, закінчується в S + N − 1;
 *  - фактичний кінець = дата дострокового завершення, якщо є, інакше плановий;
 *  - перерва B днів — це B повних днів між курсами: наступний старт = кінець + B + 1;
 *  - ліміт «курсів на рік» рахує курси за датою СТАРТУ в календарному році;
 *    якщо ліміт року вичерпано, наступний старт переноситься на 1 січня наступного року;
 *  - «починати після» іншого препарату: старт не може припасти на його курс —
 *    якщо припадає, переноситься на день після кінця цього курсу (blockers — його курси).
 */

export interface DrugScheme {
  courseDays: number;
  breakDays: number;
  /** null — без ліміту */
  coursesPerYear: number | null;
}

export interface CourseRecord {
  startDate: ISODate;
  plannedEndDate: ISODate;
  endedEarlyOn: ISODate | null;
}

export type Status = 'active' | 'due' | 'break';

export interface Forecast {
  status: Status;
  /** Курс, що йде сьогодні */
  activeCourse: (CourseRecord & { endDate: ISODate; day: number; totalDays: number }) | null;
  /** Кінець останнього завершеного або поточного курсу */
  lastEndDate: ISODate | null;
  /** Найближча дата, з якої можна стартувати; null — препарат ще жодного разу не приймали */
  nextStartDate: ISODate | null;
  /** Для status = 'due': скільки днів тому настала дата старту */
  overdueDays: number;
}

export function plannedEnd(startDate: ISODate, courseDays: number): ISODate {
  return addDays(startDate, courseDays - 1);
}

export function endOf(c: CourseRecord): ISODate {
  return c.endedEarlyOn ?? c.plannedEndDate;
}

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

/** Зсуває дату за межі курсу-попередника, на який вона припадає. */
function afterBlockers(date: ISODate, blockers: CourseRecord[]): ISODate {
  let d = date;
  for (let moved = true, guard = 0; moved && guard < 50; guard++) {
    moved = false;
    for (const b of blockers) {
      if (b.startDate <= d && d <= endOf(b)) {
        d = addDays(endOf(b), 1);
        moved = true;
      }
    }
  }
  return d;
}

/** Найраніший старт не раніше candidate з урахуванням і ліміту на рік, і попередника. */
function earliestStart(candidate: ISODate, scheme: DrugScheme, starts: ISODate[], blockers: CourseRecord[]): ISODate {
  let d = candidate;
  for (let guard = 0; guard < 10; guard++) {
    const next = applyYearLimit(afterBlockers(d, blockers), scheme, starts);
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

  if (started.length === 0) {
    // Ще не приймали: можна сьогодні, якщо зараз не йде курс попередника
    const wait = afterBlockers(today, blockers);
    return wait === today
      ? { status: 'due', activeCourse: null, lastEndDate: null, nextStartDate: null, overdueDays: 0 }
      : { status: 'break', activeCourse: null, lastEndDate: null, nextStartDate: wait, overdueDays: 0 };
  }

  const last = started[started.length - 1];
  const lastEnd = endOf(last);
  const starts = sorted.map((c) => c.startDate);
  const own = addDays(lastEnd, scheme.breakDays + 1);
  // Якщо власна перерва вже минула, реальний старт — сьогодні; попередника перевіряємо саме на цю дату
  let nextStartDate = earliestStart(own, scheme, starts, blockers);
  if (today > lastEnd && own <= today) {
    const fromToday = earliestStart(maxDate(nextStartDate, today), scheme, starts, blockers);
    if (fromToday > today) nextStartDate = fromToday;
  }

  if (today <= lastEnd) {
    return {
      status: 'active',
      activeCourse: {
        ...last,
        endDate: lastEnd,
        day: diffDays(last.startDate, today) + 1,
        totalDays: diffDays(last.startDate, last.plannedEndDate) + 1,
      },
      lastEndDate: lastEnd,
      nextStartDate,
      overdueDays: 0,
    };
  }

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
 * прогноз припускає старт сьогодні.
 */
export function project(
  scheme: DrugScheme,
  courses: CourseRecord[],
  today: ISODate,
  from: ISODate,
  to: ISODate,
  blockers: CourseRecord[] = [],
): ProjectedCourse[] {
  const result: ProjectedCourse[] = courses
    .filter((c) => c.startDate <= to && endOf(c) >= from)
    .map((c) => ({ startDate: c.startDate, endDate: endOf(c), kind: 'actual' as const }));

  const f = forecast(scheme, courses, today, blockers);
  const starts = courses.map((c) => c.startDate);
  let start = f.status === 'active' ? f.nextStartDate! : maxDate(f.nextStartDate ?? today, today);
  start = earliestStart(start, scheme, starts, blockers);

  for (let guard = 0; guard < 50 && start <= to; guard++) {
    const end = plannedEnd(start, scheme.courseDays);
    if (end >= from) result.push({ startDate: start, endDate: end, kind: 'forecast' });
    starts.push(start);
    start = earliestStart(addDays(end, scheme.breakDays + 1), scheme, starts, blockers);
  }
  return result.sort((a, b) => a.startDate.localeCompare(b.startDate));
}
