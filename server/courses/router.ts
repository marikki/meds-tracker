import express, { type NextFunction, type Request, type Response } from 'express';
import type Database from 'better-sqlite3';
import { addDays, diffDays, isISODate, todayIn, type ISODate } from './dates';
import { endOf, FOREVER, forecast, plannedEnd, project, type CourseRecord, type DrugScheme } from './forecast';

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
function bool(v: unknown, field: string): boolean {
  if (typeof v !== 'boolean') throw new HttpError(400, `${field}: true | false`);
  return v;
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
  group_id: number | null;
  after_drug_id: number | null;
  after_group_id: number | null;
  open_ended: number;
  manual_repeat: number;
  check_name: string | null;
  check_from_days: number | null;
  check_to_days: number | null;
}
interface GroupRow {
  id: number;
  name: string;
  course_days: number;
  break_days: number;
  courses_per_year: number | null;
  after_drug_id: number | null;
  after_group_id: number | null;
  open_ended: number;
  manual_repeat: number;
  notes: string;
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
  planned_end_date: string | null;
  ended_early_on: string | null;
}
interface CheckRow {
  id: number;
  course_id: number;
  name: string;
  due_from: string | null;
  due_to: string | null;
  done_on: string | null;
  result: string;
  note: string;
}

/** Схема для відповіді й розрахунку: courseDays = null — без строку */
type SchemeRow = Pick<DrugRow, 'course_days' | 'break_days' | 'courses_per_year' | 'open_ended' | 'manual_repeat'>;
const scheme = (d: SchemeRow): DrugScheme => ({
  courseDays: d.open_ended ? null : d.course_days,
  breakDays: d.break_days,
  coursesPerYear: d.courses_per_year,
  manualRepeat: d.manual_repeat === 1,
});
/** Кінець курсу для показу: FOREVER (без строку, ще йде) → «…» */
const endText = (c: CourseRow) => (endOf(toRecord(c)) === FOREVER ? '…' : endOf(toRecord(c)));
const toRecord = (c: CourseRow): CourseRecord => ({
  startDate: c.start_date,
  plannedEndDate: c.planned_end_date,
  endedEarlyOn: c.ended_early_on,
});
const drugDto = (d: DrugRow) => ({
  id: d.id,
  name: d.name,
  kind: d.kind,
  ...scheme(d),
  notes: d.notes,
  archived: d.archived_at !== null,
  groupId: d.group_id,
  afterDrugId: d.after_drug_id,
  afterGroupId: d.after_group_id,
  check:
    d.check_name === null
      ? null
      : { name: d.check_name, fromDays: d.check_from_days!, toDays: d.check_to_days! },
});
const groupDto = (g: GroupRow, drugIds: number[]) => ({
  id: g.id,
  name: g.name,
  ...scheme(g),
  afterDrugId: g.after_drug_id,
  afterGroupId: g.after_group_id,
  notes: g.notes,
  drugIds,
});

/**
 * Схема з тіла запиту; поля, яких немає, беруться з current.
 * courseDays: null — без строку (course_days лишається як був, щоб повернути при знятті прапорця).
 */
function readScheme(b: Record<string, unknown>, current?: SchemeRow) {
  const open = b.courseDays === undefined && current ? current.open_ended === 1 : b.courseDays === null;
  return {
    open_ended: open ? 1 : 0,
    manual_repeat:
      b.manualRepeat === undefined ? (current?.manual_repeat ?? 0) : bool(b.manualRepeat, 'manualRepeat') ? 1 : 0,
    course_days:
      (b.courseDays === undefined || b.courseDays === null) && current
        ? current.course_days
        : b.courseDays === null
          ? 1
          : int(b.courseDays, 'courseDays', 1),
    break_days: b.breakDays === undefined && current ? current.break_days : int(b.breakDays, 'breakDays', 0),
    courses_per_year:
      b.coursesPerYear === undefined && current
        ? current.courses_per_year
        : b.coursesPerYear == null
          ? null
          : int(b.coursesPerYear, 'coursesPerYear', 1),
  };
}

/** Контроль аналізом з тіла запиту: { name, fromDays, toDays } | null; немає поля — як був. */
function readCheck(b: Record<string, unknown>, current?: DrugRow) {
  if (b.check === undefined) {
    return {
      check_name: current?.check_name ?? null,
      check_from_days: current?.check_from_days ?? null,
      check_to_days: current?.check_to_days ?? null,
    };
  }
  if (b.check === null) return { check_name: null, check_from_days: null, check_to_days: null };
  const c = b.check as Record<string, unknown>;
  const from = int(c.fromDays, 'check.fromDays', 0);
  const to = int(c.toDays, 'check.toDays', from);
  return { check_name: str(c.name, 'check.name', { required: true }), check_from_days: from, check_to_days: to };
}

const checkDto = (c: CheckRow) => ({
  id: c.id,
  name: c.name,
  dueFrom: c.due_from,
  dueTo: c.due_to,
  doneOn: c.done_on,
  result: c.result,
  note: c.note,
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
    groups: db.prepare('SELECT * FROM drug_groups ORDER BY name'),
    group: db.prepare('SELECT * FROM drug_groups WHERE id = ?'),
    membersOf: db.prepare('SELECT id FROM drugs WHERE group_id = ? ORDER BY name'),
    checks: db.prepare('SELECT * FROM checks ORDER BY id'),
    checksOf: db.prepare('SELECT * FROM checks WHERE course_id = ? ORDER BY id'),
    check: db.prepare('SELECT * FROM checks WHERE id = ?'),
  };

  /**
   * Аналіз, який чекає на здачу в межах курсу: збережений незданий,
   * а якщо курс ще без жодного аналізу — перший за схемою препарату (id = null).
   */
  function pendingCheck(d: DrugRow, c: CourseRow, checks: CheckRow[]) {
    const open = checks.find((x) => x.done_on === null);
    if (open) return { id: open.id, courseId: c.id, name: open.name, dueFrom: open.due_from, dueTo: open.due_to };
    if (checks.length > 0 || d.check_name === null) return null;
    return {
      id: null,
      courseId: c.id,
      name: d.check_name,
      dueFrom: addDays(c.start_date, d.check_from_days!),
      dueTo: addDays(c.start_date, d.check_to_days!),
    };
  }

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
    const groups = new Map((q.groups.all() as GroupRow[]).map((g) => [g.id, g]));
    // Призначення будь-якого препарату (і архівного теж): drug|person → id
    const prescriptionOf = new Map(
      (q.prescriptions.all() as PrescriptionRow[]).map((p) => [`${p.drug_id}|${p.person_id}`, p.id]),
    );

    /** Курси попередника цієї людини: препарату або всіх препаратів комплексу. */
    function blockers(d: DrugRow, personId: string): CourseRecord[] {
      const ids = d.after_drug_id
        ? [d.after_drug_id]
        : d.after_group_id
          ? [...drugs.values()].filter((x) => x.group_id === d.after_group_id).map((x) => x.id)
          : [];
      return ids.flatMap((id) => {
        const pid = prescriptionOf.get(`${id}|${personId}`);
        return pid === undefined ? [] : (coursesBy.get(pid) ?? []).map(toRecord);
      });
    }

    /** Що показувати як «после …»: назва препарату чи комплексу */
    function after(d: DrugRow) {
      if (d.after_drug_id) {
        const x = drugs.get(d.after_drug_id);
        return x ? { kind: 'drug' as const, id: x.id, name: x.name } : null;
      }
      if (d.after_group_id) {
        const g = groups.get(d.after_group_id);
        return g ? { kind: 'group' as const, id: g.id, name: g.name } : null;
      }
      return null;
    }

    const group = (d: DrugRow) => {
      const g = d.group_id ? groups.get(d.group_id) : undefined;
      return g ? { id: g.id, name: g.name } : null;
    };

    const checksBy = new Map<number, CheckRow[]>();
    for (const c of q.checks.all() as CheckRow[]) checksBy.set(c.course_id, [...(checksBy.get(c.course_id) ?? []), c]);

    return { drugs, coursesBy, checksBy, prescriptions, blockers, after, group };
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
      throw new HttpError(409, `Пересекается с курсом ${clash.start_date} — ${endText(clash)}`);
    }
  }

  /** COLLATE NOCASE у SQLite не враховує регістр лише для латиниці, тому кирилицю порівнюємо тут. */
  function assertUniqueName(name: string, exceptId?: number) {
    const key = name.toLocaleLowerCase();
    const clash = (q.drugs.all() as DrugRow[]).find((d) => d.id !== exceptId && d.name.toLocaleLowerCase() === key);
    if (clash) throw new HttpError(409, 'Препарат с таким названием уже есть');
  }

  /**
   * «Починати після» з тіла запиту: { afterDrugId } або { afterGroupId }, не обидва.
   * self — сам препарат чи комплекс, на який посилатися не можна (і на свій комплекс теж).
   */
  function readAfter(
    b: Record<string, unknown>,
    current: { after_drug_id: number | null; after_group_id: number | null },
    self: { drugId?: number; groupId?: number | null },
  ) {
    const afterDrug = b.afterDrugId === undefined ? current.after_drug_id : b.afterDrugId === null ? null : int(b.afterDrugId, 'afterDrugId', 1);
    const afterGroup = b.afterGroupId === undefined ? current.after_group_id : b.afterGroupId === null ? null : int(b.afterGroupId, 'afterGroupId', 1);
    // Нове значення одного поля скидає інше, щоб клієнту не треба було явно передавати null
    const next = {
      after_drug_id: b.afterGroupId != null && b.afterDrugId === undefined ? null : afterDrug,
      after_group_id: b.afterDrugId != null && b.afterGroupId === undefined ? null : afterGroup,
    };
    if (next.after_drug_id !== null && next.after_group_id !== null) {
      throw new HttpError(400, 'Укажите либо препарат, либо комплекс');
    }
    if (next.after_drug_id !== null) {
      const d = q.drug.get(next.after_drug_id) as DrugRow | undefined;
      if (!d) throw new HttpError(400, 'Препарат для «после» не найден');
      if (d.id === self.drugId || (self.groupId != null && d.group_id === self.groupId)) {
        throw new HttpError(400, 'Нельзя начинать после самого себя');
      }
    }
    if (next.after_group_id !== null) {
      if (!q.group.get(next.after_group_id)) throw new HttpError(400, 'Комплекс для «после» не найден');
      if (next.after_group_id === self.groupId) throw new HttpError(400, 'Нельзя начинать после самого себя');
    }
    return next;
  }

  /** Копіює схему і «починати після» комплексу в усі його препарати. */
  function syncGroup(groupId: number) {
    const g = q.group.get(groupId) as GroupRow;
    db.prepare(`UPDATE drugs SET course_days = ?, break_days = ?, courses_per_year = ?, open_ended = ?,
                manual_repeat = ?, after_drug_id = ?, after_group_id = ? WHERE group_id = ?`)
      .run(g.course_days, g.break_days, g.courses_per_year, g.open_ended, g.manual_repeat,
        g.after_drug_id, g.after_group_id, groupId);
  }

  function writeMembers(groupId: number, list: unknown) {
    if (!Array.isArray(list)) throw new HttpError(400, 'drugIds: массив');
    const ids = list.map((v, i) => int(v, `drugIds[${i}]`, 1));
    for (const id of ids) if (!q.drug.get(id)) throw new HttpError(400, `Препарат ${id} не найден`);
    db.prepare('UPDATE drugs SET group_id = NULL WHERE group_id = ?').run(groupId);
    const add = db.prepare('UPDATE drugs SET group_id = ? WHERE id = ?');
    for (const id of ids) add.run(groupId, id);
  }

  function assertUniqueGroupName(name: string, exceptId?: number) {
    const key = name.toLocaleLowerCase();
    const clash = (q.groups.all() as GroupRow[]).find((g) => g.id !== exceptId && g.name.toLocaleLowerCase() === key);
    if (clash) throw new HttpError(409, 'Комплекс с таким названием уже есть');
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
      const name = str(b.name, 'name', { required: true });
      assertUniqueName(name);
      const after = readAfter(b, { after_drug_id: null, after_group_id: null }, {});
      const info = db
        .prepare(`INSERT INTO drugs (name, kind, course_days, break_days, courses_per_year, open_ended, manual_repeat,
                    notes, after_drug_id, after_group_id, check_name, check_from_days, check_to_days)
                  VALUES (@name, @kind, @course_days, @break_days, @courses_per_year, @open_ended, @manual_repeat,
                    @notes, @after_drug_id, @after_group_id, @check_name, @check_from_days, @check_to_days)`)
        .run({ name, kind, ...readScheme(b), notes: str(b.notes, 'notes'), ...after, ...readCheck(b) });
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
        ...readScheme(b, current),
        ...readAfter(b, current, { drugId: id, groupId: current.group_id }),
        ...readCheck(b, current),
        notes: b.notes === undefined ? current.notes : str(b.notes, 'notes'),
        archived_at:
          b.archived === undefined ? current.archived_at : b.archived ? new Date().toISOString() : null,
      };
      if (!KINDS.includes(next.kind)) throw new HttpError(400, `kind: ${KINDS.join(' | ')}`);
      assertUniqueName(next.name, id);
      db.prepare(`UPDATE drugs SET name=@name, kind=@kind, course_days=@course_days, break_days=@break_days,
                  courses_per_year=@courses_per_year, open_ended=@open_ended, manual_repeat=@manual_repeat,
                  after_drug_id=@after_drug_id, after_group_id=@after_group_id,
                  check_name=@check_name, check_from_days=@check_from_days, check_to_days=@check_to_days,
                  notes=@notes, archived_at=@archived_at WHERE id=@id`)
        .run({ ...next, id });
      if (b.prescriptions !== undefined) writePrescriptions(id, b.prescriptions);
      // У комплексі схема і порядок задаються комплексом — повертаємо їх, що б не прийшло
      if (current.group_id) syncGroup(current.group_id);
    })();
    res.json(drugDto(q.drug.get(id) as DrugRow));
  });

  // ---------- комплекси ----------
  r.get('/groups', (_req, res) => {
    res.json(
      (q.groups.all() as GroupRow[]).map((g) =>
        groupDto(g, (q.membersOf.all(g.id) as { id: number }[]).map((d) => d.id)),
      ),
    );
  });

  /** { name, courseDays, breakDays, coursesPerYear, afterDrugId | afterGroupId, notes, drugIds[] } */
  r.post('/groups', (req, res) => {
    const b = req.body ?? {};
    const id = db.transaction(() => {
      const name = str(b.name, 'name', { required: true });
      assertUniqueGroupName(name);
      const info = db
        .prepare(`INSERT INTO drug_groups (name, course_days, break_days, courses_per_year, open_ended, manual_repeat,
                    after_drug_id, after_group_id, notes)
                  VALUES (@name, @course_days, @break_days, @courses_per_year, @open_ended, @manual_repeat,
                    @after_drug_id, @after_group_id, @notes)`)
        .run({
          name,
          ...readScheme(b),
          ...readAfter(b, { after_drug_id: null, after_group_id: null }, {}),
          notes: str(b.notes, 'notes'),
        });
      const groupId = Number(info.lastInsertRowid);
      writeMembers(groupId, b.drugIds ?? []);
      // Перевіряємо «після» ще раз: тепер відомо, які препарати в комплексі
      readAfter({}, q.group.get(groupId) as GroupRow, { groupId });
      syncGroup(groupId);
      return groupId;
    })();
    res.status(201).json(groupDto(q.group.get(id) as GroupRow, (q.membersOf.all(id) as { id: number }[]).map((d) => d.id)));
  });

  r.patch('/groups/:id', (req, res) => {
    const id = Number(req.params.id);
    const current = q.group.get(id) as GroupRow | undefined;
    if (!current) throw new HttpError(404, 'Комплекс не найден');
    const b = req.body ?? {};
    db.transaction(() => {
      const name = b.name === undefined ? current.name : str(b.name, 'name', { required: true });
      assertUniqueGroupName(name, id);
      if (b.drugIds !== undefined) writeMembers(id, b.drugIds);
      db.prepare(`UPDATE drug_groups SET name=@name, course_days=@course_days, break_days=@break_days,
                  courses_per_year=@courses_per_year, open_ended=@open_ended, manual_repeat=@manual_repeat,
                  after_drug_id=@after_drug_id, after_group_id=@after_group_id,
                  notes=@notes WHERE id=@id`)
        .run({
          id,
          name,
          ...readScheme(b, current),
          ...readAfter(b, current, { groupId: id }),
          notes: b.notes === undefined ? current.notes : str(b.notes, 'notes'),
        });
      syncGroup(id);
    })();
    res.json(groupDto(q.group.get(id) as GroupRow, (q.membersOf.all(id) as { id: number }[]).map((d) => d.id)));
  });

  /** Розформувати: препарати лишаються з поточною схемою, курси не чіпаємо. */
  r.delete('/groups/:id', (req, res) => {
    const info = db.prepare('DELETE FROM drug_groups WHERE id = ?').run(Number(req.params.id));
    if (info.changes === 0) throw new HttpError(404, 'Комплекс не найден');
    res.status(204).end();
  });

  // ---------- огляд: статус і прогноз по кожному призначенню ----------
  r.get('/overview', (req, res) => {
    const t = today();
    const { drugs, coursesBy, checksBy, prescriptions, blockers, after, group } = load(personParam(req));
    res.json({
      today: t,
      items: prescriptions.map((p) => {
        const d = drugs.get(p.drug_id)!;
        // Аналіз показуємо лише в курсі, що йде: після кінця курсу контроль уже не актуальний
        const active = (coursesBy.get(p.id) ?? []).find((c) => c.start_date <= t && endOf(toRecord(c)) >= t);
        return {
          prescriptionId: p.id,
          personId: p.person_id,
          dosage: p.dosage,
          drug: drugDto(d),
          group: group(d),
          after: after(d),
          forecast: forecast(scheme(d), (coursesBy.get(p.id) ?? []).map(toRecord), t, blockers(d, p.person_id)),
          check: active ? pendingCheck(d, active, checksBy.get(active.id) ?? []) : null,
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
    const { drugs, coursesBy, prescriptions, blockers, group } = load(personParam(req));
    res.json({
      today: t,
      from,
      to,
      rows: prescriptions.map((p) => {
        const d = drugs.get(p.drug_id)!;
        return {
          prescriptionId: p.id,
          personId: p.person_id,
          drugId: d.id,
          drugName: d.name,
          group: group(d),
          courses: project(scheme(d), (coursesBy.get(p.id) ?? []).map(toRecord), t, from, to, blockers(d, p.person_id)),
        };
      }),
    });
  });

  // ---------- курси ----------
  /**
   * Старт кількох курсів однією датою: { startDate, prescriptionIds: number[], endDate? }.
   * endDate — фактичний кінець замість схеми: для минулого курсу заднім числом
   * або щоб дописати препарат комплексу до вже наявного курсу.
   */
  r.post('/courses', (req, res) => {
    const b = req.body ?? {};
    const start = date(b.startDate, 'startDate');
    const givenEnd = b.endDate === undefined ? null : date(b.endDate, 'endDate');
    if (givenEnd !== null && givenEnd < start) throw new HttpError(400, 'Окончание раньше старта');
    if (!Array.isArray(b.prescriptionIds) || b.prescriptionIds.length === 0) {
      throw new HttpError(400, 'prescriptionIds: непустой массив');
    }
    const created = db.transaction(() =>
      (b.prescriptionIds as unknown[]).map((raw, i) => {
        const pid = int(raw, `prescriptionIds[${i}]`, 1);
        const p = q.prescription.get(pid) as PrescriptionRow | undefined;
        if (!p) throw new HttpError(404, `Назначение ${pid} не найдено`);
        const d = q.drug.get(p.drug_id) as DrugRow;
        const end = givenEnd ?? plannedEnd(start, scheme(d).courseDays);
        assertNoOverlap(pid, start, end ?? FOREVER);
        const info = db
          .prepare('INSERT INTO courses (prescription_id, start_date, planned_end_date) VALUES (?, ?, ?)')
          .run(pid, start, end);
        return q.course.get(info.lastInsertRowid) as CourseRow;
      }),
    )();
    res.status(201).json(created);
  });

  /**
   * Виправити дату старту або завершити достроково (endedEarlyOn: null — скасувати дострокове).
   * endDate — задати кінець напряму (правка історії): стає плановим кінцем, дострокове скидається.
   */
  r.patch('/courses/:id', (req, res) => {
    const id = Number(req.params.id);
    const c = q.course.get(id) as CourseRow | undefined;
    if (!c) throw new HttpError(404, 'Курс не найден');
    const b = req.body ?? {};
    const start = b.startDate === undefined ? c.start_date : date(b.startDate, 'startDate');
    if (b.endDate !== undefined) {
      const end = date(b.endDate, 'endDate');
      if (end < start) throw new HttpError(400, 'Окончание раньше старта');
      assertNoOverlap(c.prescription_id, start, end, id);
      db.prepare('UPDATE courses SET start_date = ?, planned_end_date = ?, ended_early_on = NULL WHERE id = ?').run(
        start,
        end,
        id,
      );
      return res.json(q.course.get(id));
    }
    // Тривалість зафіксована в самому курсі: зміна схеми в довіднику її не чіпає; null — без строку
    const courseDays = c.planned_end_date === null ? null : diffDays(c.start_date, c.planned_end_date) + 1;
    const plannedEndDate = plannedEnd(start, courseDays);
    const endedEarlyOn =
      b.endedEarlyOn === undefined ? c.ended_early_on : b.endedEarlyOn === null ? null : date(b.endedEarlyOn, 'endedEarlyOn');
    if (endedEarlyOn !== null && (endedEarlyOn < start || (plannedEndDate !== null && endedEarlyOn >= plannedEndDate))) {
      throw new HttpError(400, 'Дата досрочного завершения должна быть между стартом и плановым концом');
    }
    if (endedEarlyOn !== null && endedEarlyOn > today()) {
      throw new HttpError(400, 'Завершить досрочно можно только сегодняшней или прошедшей датой');
    }
    assertNoOverlap(c.prescription_id, start, endedEarlyOn ?? plannedEndDate ?? FOREVER, id);
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

  // ---------- аналізи ----------
  /**
   * Здали аналіз у межах курсу: { name, doneOn, result?, note?, next?: { fromDays, toDays } | null }.
   * Закриває незданий контроль курсу (або перший за схемою); next — призначити наступний від дати здачі.
   */
  r.post('/courses/:id/checks', (req, res) => {
    const c = q.course.get(Number(req.params.id)) as CourseRow | undefined;
    if (!c) throw new HttpError(404, 'Курс не найден');
    const b = req.body ?? {};
    const name = str(b.name, 'name', { required: true });
    const doneOn = date(b.doneOn, 'doneOn');
    if (doneOn > today()) throw new HttpError(400, 'Дата анализа не может быть в будущем');
    if (doneOn < c.start_date) throw new HttpError(400, 'Дата анализа раньше начала курса');
    const result = str(b.result, 'result');
    const note = str(b.note, 'note');
    const next = b.next == null ? null : (b.next as Record<string, unknown>);
    const nextFrom = next ? int(next.fromDays, 'next.fromDays', 1) : 0;
    const nextTo = next ? int(next.toDays, 'next.toDays', nextFrom) : 0;

    const p = q.prescription.get(c.prescription_id) as PrescriptionRow;
    const d = q.drug.get(p.drug_id) as DrugRow;
    const pending = pendingCheck(d, c, q.checksOf.all(c.id) as CheckRow[]);
    const id = db.transaction(() => {
      let id: number;
      if (pending?.id) {
        db.prepare('UPDATE checks SET name = ?, done_on = ?, result = ?, note = ? WHERE id = ?')
          .run(name, doneOn, result, note, pending.id);
        id = pending.id;
      } else {
        id = Number(
          db.prepare(`INSERT INTO checks (course_id, name, due_from, due_to, done_on, result, note)
                      VALUES (?, ?, ?, ?, ?, ?, ?)`)
            .run(c.id, name, pending?.dueFrom ?? null, pending?.dueTo ?? null, doneOn, result, note).lastInsertRowid,
        );
      }
      if (next) {
        db.prepare('INSERT INTO checks (course_id, name, due_from, due_to) VALUES (?, ?, ?, ?)')
          .run(c.id, name, addDays(doneOn, nextFrom), addDays(doneOn, nextTo));
      }
      return id;
    })();
    res.status(201).json(checkDto(q.check.get(id) as CheckRow));
  });

  /** Видалити результат, внесений помилково, або скасувати призначений контроль. */
  r.delete('/checks/:id', (req, res) => {
    const info = db.prepare('DELETE FROM checks WHERE id = ?').run(Number(req.params.id));
    if (info.changes === 0) throw new HttpError(404, 'Анализ не найден');
    res.status(204).end();
  });

  /** Історія курсів препарату (?drug=) чи комплексу (?group=), від нових до старих */
  r.get('/history', (req, res) => {
    const drugId = req.query.drug === undefined ? null : Number(req.query.drug);
    const groupId = req.query.group === undefined ? null : Number(req.query.group);
    if (!Number.isInteger(drugId ?? groupId)) throw new HttpError(400, 'Укажите drug или group');
    const rows = db
      .prepare(
        `SELECT c.*, p.person_id, p.drug_id, d.name AS drug_name FROM courses c
         JOIN prescriptions p ON p.id = c.prescription_id
         JOIN drugs d ON d.id = p.drug_id
         WHERE ${drugId !== null ? 'd.id = ?' : 'd.group_id = ?'}
         ORDER BY c.start_date DESC`,
      )
      .all(drugId ?? groupId) as (CourseRow & { person_id: string; drug_id: number; drug_name: string })[];
    res.json({
      today: today(),
      courses: rows.map((c) => ({
        id: c.id,
        prescriptionId: c.prescription_id,
        personId: c.person_id,
        drugId: c.drug_id,
        drugName: c.drug_name,
        startDate: c.start_date,
        // null — курс без строку, ще йде
        endDate: endOf(toRecord(c)) === FOREVER ? null : endOf(toRecord(c)),
        // Лише здані: призначений контроль видно на «Сегодня»
        checks: (q.checksOf.all(c.id) as CheckRow[]).filter((x) => x.done_on !== null).map(checkDto),
      })),
    });
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
