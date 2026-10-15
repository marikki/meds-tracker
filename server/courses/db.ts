import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { migrate } from './migrations';

/** Відкриває окремий файл бази модуля. FamilyHub викличе це саме так зі своїм шляхом. */
export function openMedsDb(path: string): Database.Database {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  migrate(db);
  return db;
}

/** Синхронізує список людей (id + ім'я) з тим, що знає застосунок-хост. */
export function upsertPeople(db: Database.Database, people: { id: string; name: string }[]): void {
  const stmt = db.prepare(
    'INSERT INTO people (id, name) VALUES (@id, @name) ON CONFLICT(id) DO UPDATE SET name = excluded.name',
  );
  db.transaction(() => people.forEach((p) => stmt.run(p)))();
}
