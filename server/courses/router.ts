import express, { type NextFunction, type Request, type Response } from 'express';
import type Database from 'better-sqlite3';
import { diffDays, isISODate, todayIn, type ISODate } from './dates';
import { endOf, forecast, plannedEnd, project, type CourseRecord, type DrugScheme } from './forecast';

/**
 * Роутер модуля. Авторизацію робить хост (окремий застосунок або FamilyHub)
 * middleware-ом ПЕРЕД монтуванням: усередині модуля всі запити вже автентифіковані,
 * обидва члени сім'ї бачать і редагують усе.
 */
export interface CoursesRouterOptions {
  db: Database.Database;
  /** Підміняється в тестах */
  today?: () => ISODate;
}

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const KINDS = ['supplement', 'peptide'] as const;

// ---- валідація ----
function int(v: unknown, field: string, min: number): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min) {
    throw new HttpError(400, `${field}: целое число ≥ ${min}`);
  }
  return v;
}
function str(v: unknown, field: string, { required = false } = {}): string {
  if (v === undefined && !required) return '';
  if (typeof v !== 'string' || (required && !v.trim())) throw new HttpError(400, `${field}: нужен текст`);
  return v.trim();
}
function date(v: unknown, field: string): ISODate {
  if (!isISODate(v)) throw new HttpError(400, `${field}: дата в формате YYYY-MM-DD`);
  return v;
}

// ---- рядки з БД ----
interface DrugRow {
  id: number;
  name: string;
  kind: (typeof KINDS)[number];
  course_days: number;
  break_days: number;
  courses_per_year: number | null;
  notes: string;
  archived_at: string | null;
}
interface PrescriptionRow {
  id: number;
  drug_id: number;
  person_id: string;
  dosage: string;
}
interface CourseRow {
  id: number;
  prescription_id: number;
  start_date: string;
  planned_end_date: string;
  ended_early_on: string | null;
}

const scheme = (d: DrugRow): DrugScheme => ({
  courseDays: d.course_days,
  breakDays: d.break_days,
  coursesPerYear: d.courses_per_year,
});
const toRecord = (c: CourseRow): CourseRecord => ({
  startDate: c.start_date,
  plannedEndDate: c.planned_end_date,
  endedEarlyOn: c.ended_early_on,
});
const drugDto = (d: DrugRow) => ({
  id: d.id,
  name: d.name,
  kind: d.kind,
  courseDays: d.course_days,
  breakDays: d.break_days,
  coursesPerYear: d.courses_per_year,
  notes: d.notes,
  archived: d.archived_at !== null,
});

export function createCoursesRouter({ db, today = () => todayIn() }: CoursesRouterOptions) {
  const r = express.Router();
  r.use(express.json());

  const q = {
    people: db.prepare('SELECT id, name FROM people ORDER BY name'),
    drugs: db.prepare('SELECT * FROM drugs ORDER BY name'),
    drug: db.prepare('SELECT * FROM drugs WHERE id = ?'),
    prescriptions: db.prepare('SELECT * FROM prescriptions'),
    prescriptionsOfDrug: db.prepare('SELECT * FROM prescriptions WHERE drug_id = ?'),
    prescription: db.prepare('SELECT * FROM prescriptions WHERE id = ?'),
    courses: db.prepare('SELECT * FROM courses ORDER BY start_date'),
    coursesOf: db.prepare('SELECT * FROM courses WHERE prescription_id = ? ORDER BY start_date'),
    course: db.prepare('SELECT * FROM courses WHERE id = ?'),
  };

  /** Усі дані одним проходом, згруповані для розрахунків. */
  function load(personFilter: string | undefined) {
    const drugs = new Map((q.drugs.all() as DrugRow[]).map((d) => [d.id, d]));
    const coursesBy = new Map<number, CourseRow[]>();
    for (const c of q.courses.all() as CourseRow[]) {
      coursesBy.set(c.prescription_id, [...(coursesBy.get(c.prescription_id) ?? []), c]);
    }
    const prescriptions = (q.prescriptions.all() as PrescriptionRow[]).filter(
      (p) => !drugs.get(p.drug_id)!.archived_at && (!personFilter || p.person_id === personFilter),
    );
    return { drugs, coursesBy, prescriptions };
  }

  function personParam(req: Request): string | undefined {
    const p = req.query.person;
    return typeof p === 'string' && p !== 'all' ? p : undefined;
  }

  /** Перетин з наявними курсами цього призначення. */
  function assertNoOverlap(prescriptionId: number, start: ISODate, end: ISODate, exceptId?: number) {
    const clash = (q.coursesOf.all(prescriptionId) as CourseRow[]).find(
      (c) => c.id !== exceptId && c.start_date <= end && endOf(toRecord(c)) >= start,
    );
    if (clash) {
      throw new HttpError(409, `Пересекается с курсом ${clash.start_date} — ${endOf(toRecord(clash))}`);
    }
  }

  function writePrescriptions(drugId: number, list: unknown) {
    if (!Array.isArray(list)) throw new HttpError(400, 'prescriptions: массив');
    const people = new Set((q.people.all() as { id: string }[]).map((p) => p.id));
    const wanted = list.map((p, i) => {
      const personId = str(p?.personId, `prescriptions[${i}].personId`, { required: true });
      if (!people.has(personId)) throw new HttpError(400, `Неизвестный человек: ${personId}`);
      return { personId, dosage: str(p?.dosage, `prescriptions[${i}].dosage`) };
    });
    // Видаляємо лише ті призначення, яких більше немає, щоб не втратити історію курсів інших
    const keep = new Set(wanted.map((w) => w.personId));
    for (const p of q.prescriptionsOfDrug.all(drugId) as PrescriptionRow[]) {
      if (!keep.has(p.person_id)) db.prepare('DELETE FROM prescriptions WHERE id = ?').run(p.id);
    }
    const upsert = db.prepare(`INSERT INTO prescriptions (drug_id, person_id, dosage) VALUES (?, ?, ?)
      ON CONFLICT(drug_id, person_id) DO UPDATE SET dosage = excluded.dosage`);
    for (const w of wanted) upsert.run(drugId, w.personId, w.dosage);
  }

  // ---------- люди ----------
  r.get('/people', (_req, res) => {
    res.json(q.people.all());
  });

  // ---------- довідник препаратів ----------
  r.get('/drugs', (_req, res) => {
    const all = q.prescriptions.all() as PrescriptionRow[];
    res.json(
      (q.drugs.all() as DrugRow[]).map((d) => ({
        ...drugDto(d),
        prescriptions: all
          .filter((p) => p.drug_id === d.id)
          .map((p) => ({ id: p.id, personId: p.person_id, dosage: p.dosage })),
      })),
    );
  });

  r.post('/drugs', (req, res) => {
    const b = req.body ?? {};
    const kind = b.kind;
    if (!KINDS.includes(kind)) throw new HttpError(400, `kind: ${KINDS.join(' | ')}`);
    const id = db.transaction(() => {
      const info = db
        .prepare(`INSERT INTO drugs (name, kind, course_days, break_days, courses_per_year, notes)
                  VALUES (?, ?, ?, ?, ?, ?)`)
        .run(
          str(b.name, 'name', { required: true }),
          kind,
          int(b.courseDays, 'courseDays', 1),
          int(b.breakDays, 'breakDays', 0),
          b.coursesPerYear == null ? null : int(b.coursesPerYear, 'coursesPerYear', 1),
          str(b.notes, 'notes'),
        );
      const drugId = Number(info.lastInsertRowid);
      writePrescriptions(drugId, b.prescriptions ?? []);
      return drugId;
    })();
    res.status(201).json(drugDto(q.drug.get(id) as DrugRow));
  });

  r.patch('/drugs/:id', (req, res) => {
    const id = Number(req.params.id);
    const current = q.drug.get(id) as DrugRow | undefined;
    if (!current) throw new HttpError(404, 'Препарат не найден');
    const b = req.body ?? {};
    db.transaction(() => {
      const next = {
        name: b.name === undefined ? current.name : str(b.name, 'name', { required: true }),
        kind: b.kind === undefined ? current.kind : b.kind,
        course_days: b.courseDays === undefined ? current.course_days : int(b.courseDays, 'courseDays', 1),
        break_days: b.breakDays === undefined ? current.break_days : int(b.breakDays, 'breakDays', 0),
        courses_per_year:
          b.coursesPerYear === undefined
            ? current.courses_per_year
            : b.coursesPerYear === null
              ? null
              : int(b.coursesPerYear, 'coursesPerYear', 1),
        notes: b.notes === undefined ? current.notes : str(b.notes, 'notes'),
        archived_at:
          b.archived === undefined ? current.archived_at : b.archived ? new Date().toISOString() : null,
      };
      if (!KINDS.includes(next.kind)) throw new HttpError(400, `kind: ${KINDS.join(' | ')}`);
      db.prepare(`UPDATE drugs SET name=@name, kind=@kind, course_days=@course_days, break_days=@break_days,
                  courses_per_year=@courses_per_year, notes=@notes, archived_at=@archived_at WHERE id=@id`)
        .run({ ...next, id });
      if (b.prescriptions !== undefined) writePrescriptions(id, b.prescriptions);
    })();
    res.json(drugDto(q.drug.get(id) as DrugRow));
  });

  // ---------- огляд: статус і прогноз по кожному призначенню ----------
  r.get('/overview', (req, res) => {
    const t = today();
    const { drugs, coursesBy, prescriptions } = load(personParam(req));
    res.json({
      today: t,
      items: prescriptions.map((p) => {
        const d = drugs.get(p.drug_id)!;
        return {
          prescriptionId: p.id,
          personId: p.person_id,
          dosage: p.dosage,
          drug: drugDto(d),
          forecast: forecast(scheme(d), (coursesBy.get(p.id) ?? []).map(toRecord), t),
        };
      }),
    });
  });

  // ---------- план для діаграми ----------
  r.get('/plan', (req, res) => {
    const t = today();
    const from = date(req.query.from, 'from');
    const to = date(req.query.to, 'to');
    if (to < from) throw new HttpError(400, 'to раньше from');
    const { drugs, coursesBy, prescriptions } = load(personParam(req));
    res.json({
      today: t,
      from,
      to,
      rows: prescriptions.map((p) => {
        const d = drugs.get(p.drug_id)!;
        return {
          prescriptionId: p.id,
          personId: p.person_id,
          drugName: d.name,
          courses: project(scheme(d), (coursesBy.get(p.id) ?? []).map(toRecord), t, from, to),
        };
      }),
    });
  });

  // ---------- курси ----------
  /** Старт кількох курсів однією датою: { startDate, prescriptionIds: number[] } */
  r.post('/courses', (req, res) => {
    const b = req.body ?? {};
    const start = date(b.startDate, 'startDate');
    if (!Array.isArray(b.prescriptionIds) || b.prescriptionIds.length === 0) {
      throw new HttpError(400, 'prescriptionIds: непустой массив');
    }
    const created = db.transaction(() =>
      (b.prescriptionIds as unknown[]).map((raw, i) => {
        const pid = int(raw, `prescriptionIds[${i}]`, 1);
        const p = q.prescription.get(pid) as PrescriptionRow | undefined;
        if (!p) throw new HttpError(404, `Назначение ${pid} не найдено`);
        const d = q.drug.get(p.drug_id) as DrugRow;
        const end = plannedEnd(start, d.course_days);
        assertNoOverlap(pid, start, end);
        const info = db
          .prepare('INSERT INTO courses (prescription_id, start_date, planned_end_date) VALUES (?, ?, ?)')
          .run(pid, start, end);
        return q.course.get(info.lastInsertRowid) as CourseRow;
      }),
    )();
    res.status(201).json(created);
  });

  /** Виправити дату старту або завершити достроково (endedEarlyOn: null — скасувати дострокове). */
  r.patch('/courses/:id', (req, res) => {
    const id = Number(req.params.id);
    const c = q.course.get(id) as CourseRow | undefined;
    if (!c) throw new HttpError(404, 'Курс не найден');
    const b = req.body ?? {};
    const start = b.startDate === undefined ? c.start_date : date(b.startDate, 'startDate');
    // Тривалість зафіксована в самому курсі: зміна схеми в довіднику її не чіпає
    const courseDays = diffDays(c.start_date, c.planned_end_date) + 1;
    const plannedEndDate = plannedEnd(start, courseDays);
    const endedEarlyOn =
      b.endedEarlyOn === undefined ? c.ended_early_on : b.endedEarlyOn === null ? null : date(b.endedEarlyOn, 'endedEarlyOn');
    if (endedEarlyOn !== null && (endedEarlyOn < start || endedEarlyOn >= plannedEndDate)) {
      throw new HttpError(400, 'Дата досрочного завершения должна быть между стартом и плановым концом');
    }
    if (endedEarlyOn !== null && endedEarlyOn > today()) {
      throw new HttpError(400, 'Завершить досрочно можно только сегодняшней или прошедшей датой');
    }
    assertNoOverlap(c.prescription_id, start, endedEarlyOn ?? plannedEndDate, id);
    db.prepare('UPDATE courses SET start_date = ?, planned_end_date = ?, ended_early_on = ? WHERE id = ?').run(
      start,
      plannedEndDate,
      endedEarlyOn,
      id,
    );
    res.json(q.course.get(id));
  });

  /** Видалити помилково створений курс. */
  r.delete('/courses/:id', (req, res) => {
    const info = db.prepare('DELETE FROM courses WHERE id = ?').run(Number(req.params.id));
    if (info.changes === 0) throw new HttpError(404, 'Курс не найден');
    res.status(204).end();
  });

  r.get('/prescriptions/:id/courses', (req, res) => {
    res.json(q.coursesOf.all(Number(req.params.id)));
  });

  r.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err instanceof Error && /UNIQUE constraint failed: drugs.name/.test(err.message)) {
      return res.status(409).json({ error: 'Препарат с таким названием уже есть' });
    }
    console.error(err);
    res.status(500).json({ error: 'Внутренняя ошибка' });
  });

  return r;
}
