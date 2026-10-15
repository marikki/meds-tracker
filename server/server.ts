import express from 'express';
import cookieParser from 'cookie-parser';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createAuth, usersFromEnv } from './auth';
import { createCoursesRouter, openMedsDb, upsertPeople } from './courses';

const PORT = Number(process.env.PORT ?? 3004);
const DB_PATH = process.env.DB_PATH ?? resolve('data/meds.db');
const JWT_SECRET = process.env.JWT_SECRET;
const IS_PROD = process.env.NODE_ENV === 'production';

if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.error('JWT_SECRET не задано або коротший за 32 символи');
  process.exit(1);
}
const users = usersFromEnv();
if (users.length === 0) {
  console.error('Немає жодного PASSWORD_* в ENV');
  process.exit(1);
}

const db = openMedsDb(DB_PATH);
upsertPeople(db, users.map(({ id, name }) => ({ id, name })));

const app = express();
app.disable('x-powered-by');
app.use(cookieParser());

const auth = createAuth(JWT_SECRET, users, IS_PROD);
app.use('/api/auth', auth.router);
app.use('/api/courses', auth.requireAuth, createCoursesRouter({ db }));
app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Не найдено' });
});

// Статика фронту (у проді). У dev фронт віддає Vite з проксі на /api.
const clientDir = resolve(process.env.CLIENT_DIR ?? 'dist/client');
if (existsSync(clientDir)) {
  app.use(express.static(clientDir, { index: false, maxAge: '1h' }));
  app.use((req, res, next) => {
    if (req.method !== 'GET') return next();
    res.sendFile(join(clientDir, 'index.html'));
  });
}

const server = app.listen(PORT, () => console.log(`meds-tracker on :${PORT}, db ${DB_PATH}`));

for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => {
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
}
