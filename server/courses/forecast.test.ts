import { describe, expect, it } from 'vitest';
import { addDays, diffDays, isISODate, todayIn } from './dates';
import { forecast, plannedEnd, project, type CourseRecord, type DrugScheme } from './forecast';

const course = (startDate: string, courseDays: number, endedEarlyOn: string | null = null): CourseRecord => ({
  startDate,
  plannedEndDate: plannedEnd(startDate, courseDays),
  endedEarlyOn,
});

describe('dates', () => {
  it('рахує дні через межі місяців і років', () => {
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(diffDays('2026-10-01', '2026-10-14')).toBe(13);
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
  });

  it('не ламається на переході на зимовий час', () => {
    // У Києві 25.10.2026 — перехід годинника
    expect(addDays('2026-10-24', 2)).toBe('2026-10-26');
  });

  it('валідує дати', () => {
    expect(isISODate('2026-02-30')).toBe(false);
    expect(isISODate('2026-2-3')).toBe(false);
    expect(isISODate('2026-02-28')).toBe(true);
  });

  it('бере "сьогодні" в київському поясі', () => {
    // 22:30 UTC 14.10 — у Києві вже 15.10
    expect(todayIn('Europe/Kyiv', new Date('2026-10-14T22:30:00Z'))).toBe('2026-10-15');
  });
});

describe('forecast', () => {
  const magnesium: DrugScheme = { courseDays: 30, breakDays: 60, coursesPerYear: 3 };

  it('курс на 30 днів закінчується на 30-й день включно', () => {
    expect(plannedEnd('2026-10-14', 30)).toBe('2026-11-12');
  });

  it('ще не приймали — пора починати', () => {
    const f = forecast(magnesium, [], '2026-10-14');
    expect(f).toMatchObject({ status: 'due', nextStartDate: null, lastEndDate: null });
  });

  it('йде курс: день N з M і дата наступного старту', () => {
    const f = forecast(magnesium, [course('2026-10-01', 30)], '2026-10-14');
    expect(f.status).toBe('active');
    expect(f.activeCourse).toMatchObject({ day: 14, totalDays: 30, endDate: '2026-10-30' });
    // кінець 30.10 + 60 повних днів перерви → старт 30.12
    expect(f.nextStartDate).toBe('2026-12-30');
  });

  it('останній день курсу — ще active', () => {
    expect(forecast(magnesium, [course('2026-10-01', 30)], '2026-10-30').status).toBe('active');
  });

  it('перерва, потім пора', () => {
    const c = [course('2026-07-01', 30)]; // кінець 30.07, старт 29.09
    expect(forecast(magnesium, c, '2026-09-28').status).toBe('break');
    const due = forecast(magnesium, c, '2026-10-14');
    expect(due).toMatchObject({ status: 'due', nextStartDate: '2026-09-29', overdueDays: 15 });
  });

  it('дострокове завершення зсуває прогноз раніше', () => {
    const f = forecast(magnesium, [course('2026-10-01', 30, '2026-10-10')], '2026-10-14');
    expect(f.status).toBe('break');
    expect(f.nextStartDate).toBe('2026-12-10');
  });

  it('ліміт курсів на рік переносить старт на 1 січня', () => {
    const c = [course('2026-01-05', 30), course('2026-04-05', 30), course('2026-07-05', 30)];
    const f = forecast(magnesium, c, '2026-10-14');
    expect(f.status).toBe('break');
    expect(f.nextStartDate).toBe('2027-01-01');
  });

  it('без ліміту — тільки кінець + перерва', () => {
    const noLimit = { ...magnesium, coursesPerYear: null };
    const c = [course('2026-01-05', 30), course('2026-04-05', 30), course('2026-07-05', 30)];
    expect(forecast(noLimit, c, '2026-10-14').nextStartDate).toBe('2026-10-03');
  });

  it('майбутній запланований курс не вважається поточним', () => {
    const f = forecast(magnesium, [course('2026-07-01', 30), course('2026-11-01', 30)], '2026-10-14');
    expect(f.status).toBe('due');
    expect(f.lastEndDate).toBe('2026-07-30');
  });
});

describe('project', () => {
  it('фактичний курс + прогнозні до кінця горизонту', () => {
    const scheme: DrugScheme = { courseDays: 20, breakDays: 90, coursesPerYear: 3 };
    const p = project(scheme, [course('2026-10-06', 20)], '2026-10-14', '2026-10-01', '2027-03-31');
    expect(p).toEqual([
      { startDate: '2026-10-06', endDate: '2026-10-25', kind: 'actual' },
      { startDate: '2027-01-24', endDate: '2027-02-12', kind: 'forecast' },
    ]);
  });

  it('якщо пора — прогноз стартує сьогодні', () => {
    const scheme: DrugScheme = { courseDays: 30, breakDays: 60, coursesPerYear: null };
    const p = project(scheme, [], '2026-10-14', '2026-10-01', '2026-12-31');
    expect(p[0]).toEqual({ startDate: '2026-10-14', endDate: '2026-11-12', kind: 'forecast' });
  });
});
