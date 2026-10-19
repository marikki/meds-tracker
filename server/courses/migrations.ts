import type Database from 'better-sqlite3';

/**
 * Міграції модуля. Лише дописувати в кінець, ніколи не змінювати застосовані.
 * Облік ведеться у власній таблиці meds_migrations, а не в PRAGMA user_version,
 * щоб модуль не конфліктував з іншими міграціями, якщо базу колись підключать через ATTACH.
 */
const migrations: { id: number; name: string; sql: string }[] = [
  {
    id: 1,
    name: 'init',
    sql: `
      CREATE TABLE people (
        id         TEXT PRIMARY KEY,           -- той самий id користувача, що й у FamilyHub
        name       TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE drugs (
        id               INTEGER PRIMARY KEY,
        name             TEXT NOT NULL UNIQUE COLLATE NOCASE,
        kind             TEXT NOT NULL CHECK (kind IN ('supplement', 'peptide')),
        course_days      INTEGER NOT NULL CHECK (course_days > 0),
        break_days       INTEGER NOT NULL CHECK (break_days >= 0),
        courses_per_year INTEGER CHECK (courses_per_year IS NULL OR courses_per_year > 0),
        notes            TEXT NOT NULL DEFAULT '',
        archived_at      TEXT,
        created_at       TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- Призначення: препарат × людина, зі своїм дозуванням
      CREATE TABLE prescriptions (
        id         INTEGER PRIMARY KEY,
        drug_id    INTEGER NOT NULL REFERENCES drugs(id) ON DELETE CASCADE,
        person_id  TEXT    NOT NULL REFERENCES people(id) ON DELETE CASCADE,
        dosage     TEXT    NOT NULL DEFAULT '',
        created_at TEXT    NOT NULL DEFAULT (datetime('now')),
        UNIQUE (drug_id, person_id)
      );

      CREATE TABLE courses (
        id               INTEGER PRIMARY KEY,
        prescription_id  INTEGER NOT NULL REFERENCES prescriptions(id) ON DELETE CASCADE,
        start_date       TEXT NOT NULL,       -- YYYY-MM-DD
        planned_end_date TEXT NOT NULL,       -- фіксується при старті, щоб зміна схеми не переписувала історію
        ended_early_on   TEXT,
        created_at       TEXT NOT NULL DEFAULT (datetime('now')),
        CHECK (planned_end_date >= start_date),
        CHECK (ended_early_on IS NULL OR (ended_early_on >= start_date AND ended_early_on < planned_end_date))
      );
      CREATE INDEX courses_prescription_start ON courses (prescription_id, start_date);
    `,
  },
  {
    id: 2,
    name: 'groups_and_sequence',
    sql: `
      -- Комплекс: препарати, що приймаються разом за однією схемою.
      -- Схема й «починати після» комплексу копіюються в усі його препарати (див. syncGroup у router.ts),
      -- тож прогноз і курси працюють з препаратами як раніше.
      CREATE TABLE drug_groups (
        id               INTEGER PRIMARY KEY,
        name             TEXT NOT NULL,
        course_days      INTEGER NOT NULL CHECK (course_days > 0),
        break_days       INTEGER NOT NULL CHECK (break_days >= 0),
        courses_per_year INTEGER CHECK (courses_per_year IS NULL OR courses_per_year > 0),
        after_drug_id    INTEGER REFERENCES drugs(id) ON DELETE SET NULL,
        after_group_id   INTEGER REFERENCES drug_groups(id) ON DELETE SET NULL,
        notes            TEXT NOT NULL DEFAULT '',
        created_at       TEXT NOT NULL DEFAULT (datetime('now')),
        CHECK (after_drug_id IS NULL OR after_group_id IS NULL)
      );

      ALTER TABLE drugs ADD COLUMN group_id INTEGER REFERENCES drug_groups(id) ON DELETE SET NULL;
      -- «Починати після»: препарат або комплекс, не обидва
      ALTER TABLE drugs ADD COLUMN after_drug_id INTEGER REFERENCES drugs(id) ON DELETE SET NULL;
      ALTER TABLE drugs ADD COLUMN after_group_id INTEGER REFERENCES drug_groups(id) ON DELETE SET NULL;
    `,
  },
  {
    id: 3,
    name: 'open_ended_and_manual_repeat',
    sql: `
      -- «Без строку»: курс іде, доки не завершать (course_days тоді не використовується).
      -- «Не повторювати автоматично»: після курсу прогнозу немає, наступний — за рішенням.
      ALTER TABLE drugs ADD COLUMN open_ended INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE drugs ADD COLUMN manual_repeat INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE drug_groups ADD COLUMN open_ended INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE drug_groups ADD COLUMN manual_repeat INTEGER NOT NULL DEFAULT 0;

      -- Курс без строку не має планового кінця: перебудовуємо таблицю з nullable planned_end_date
      CREATE TABLE courses_new (
        id               INTEGER PRIMARY KEY,
        prescription_id  INTEGER NOT NULL REFERENCES prescriptions(id) ON DELETE CASCADE,
        start_date       TEXT NOT NULL,
        planned_end_date TEXT,                -- NULL — курс без строку
        ended_early_on   TEXT,
        created_at       TEXT NOT NULL DEFAULT (datetime('now')),
        CHECK (planned_end_date IS NULL OR planned_end_date >= start_date),
        CHECK (ended_early_on IS NULL OR (ended_early_on >= start_date
               AND (planned_end_date IS NULL OR ended_early_on < planned_end_date)))
      );
      INSERT INTO courses_new (id, prescription_id, start_date, planned_end_date, ended_early_on, created_at)
        SELECT id, prescription_id, start_date, planned_end_date, ended_early_on, created_at FROM courses;
      DROP TABLE courses;
      ALTER TABLE courses_new RENAME TO courses;
      CREATE INDEX courses_prescription_start ON courses (prescription_id, start_date);
    `,
  },
];

export function migrate(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS meds_migrations (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  const applied = new Set(
    (db.prepare('SELECT id FROM meds_migrations').all() as { id: number }[]).map((r) => r.id),
  );
  const insert = db.prepare('INSERT INTO meds_migrations (id, name) VALUES (?, ?)');
  for (const m of migrations) {
    if (applied.has(m.id)) continue;
    db.transaction(() => {
      db.exec(m.sql);
      insert.run(m.id, m.name);
    })();
  }
}
