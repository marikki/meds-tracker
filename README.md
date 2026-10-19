# meds-tracker

Трекер курсів добавок і пептидів на двох. Окремий застосунок, який потім стане
модулем «Медицина» у FamilyHub.

Стек той самий, що у FamilyHub: React 19 + TS + Tailwind v4 + Vite,
Express 5 + TS (esbuild → `dist/server.cjs`), SQLite (better-sqlite3, WAL), JWT у cookie.

## Структура

```
server/
  server.ts            точка входу окремого застосунку (у FamilyHub не переїжджає)
  auth.ts              вхід за паролями з ENV (у FamilyHub не переїжджає)
  courses/             ← МОДУЛЬ, переноситься у FamilyHub як є
    index.ts           публічний API: createCoursesRouter, openMedsDb, upsertPeople
    router.ts          REST-ендпоінти
    forecast.ts        розрахунок статусу і прогнозу (чисті функції)
    dates.ts           дати YYYY-MM-DD без часових поясів
    migrations.ts      схема, облік у таблиці meds_migrations
    db.ts
    *.test.ts
src/
  App.tsx              вхід + модуль (у FamilyHub не переїжджає)
  features/courses/    ← МОДУЛЬ фронту, переноситься як є
data/meds.db           база (bind-том, не в git)
```

## Правила прогнозу

Усі межі включні.

- Курс N днів зі старту S закінчується в S + N − 1.
- Перерва B днів — це B повних днів між курсами: наступний старт = кінець + B + 1.
- Дострокове завершення замінює кінець курсу, тож прогноз зсувається раніше.
- Ліміт «курсів на рік» рахує курси за датою старту в календарному році.
  Якщо рік вичерпано, старт переноситься на 1 січня наступного.
- Статуси `active` / `due` / `break` не зберігаються, а обчислюються з дат.
  «Сьогодні» рахується в Europe/Kyiv.

## API (`/api/courses`)

| Метод | Шлях | Що робить |
|---|---|---|
| GET | `/people` | люди |
| GET / POST | `/drugs` | довідник з призначеннями |
| PATCH | `/drugs/:id` | змінити схему, дозування, архівувати (`archived: true`) |
| GET | `/overview?person=all\|<id>` | статус і прогноз по кожному призначенню |
| GET | `/plan?from=&to=&person=` | фактичні та прогнозні курси для діаграми (вкладка «План») |
| POST | `/courses` | `{ startDate, prescriptionIds[] }` — старт кількох курсів однією датою |
| PATCH | `/courses/:id` | `{ startDate?, endedEarlyOn? }` — виправити старт / завершити достроково |
| DELETE | `/courses/:id` | видалити помилковий курс |
| GET | `/prescriptions/:id/courses` | історія курсів |

## Локально

```bash
cp .env.example .env     # заповнити
npm install
npm test
set -a && . ./.env && set +a && npm run dev    # api :3004, фронт :5173
```

## Деплой на VPS

```bash
git clone git@github.com:marikki/meds-tracker.git && cd meds-tracker
cp .env.example .env && nano .env
mkdir -p data && sudo chown 1000:1000 data     # контейнер працює від користувача node (uid 1000)
docker compose up -d --build

# зона ліміту спроб входу (один раз на сервер; на поточному VPS уже є)
printf '%s\n' 'limit_req_zone "$binary_remote_addr$host" zone=login:10m rate=5r/m;' 'limit_req_status 429;' \
  | sudo tee /etc/nginx/conf.d/login-ratelimit.conf
sudo cp nginx/meds.marikkish.com.conf /etc/nginx/sites-available/
sudo ln -s /etc/nginx/sites-available/meds.marikkish.com.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d meds.marikkish.com
```

DNS: A-запис `meds.marikkish.com` на IP VPS.

### Користувачі

Задаються в `.env` парами `PASSWORD_<ЛОГІН>` / `NAME_<ЛОГІН>`; у форму входу вводиться логін
латиницею (`marina`), а не відображуване ім'я. Додати нового — на сервері:

```bash
./scripts/add-user.sh kostya Костя
```

Скрипт генерує пароль, дописує його в `.env` (попередній зберігає як `.env.bak-*`),
перестворює контейнер і один раз показує логін і пароль.

Бекап: `scripts/backup.sh` у cron, щодня. Копію за межі VPS ще треба налаштувати (TODO в скрипті).

## Інтеграція у FamilyHub (потім)

1. Скопіювати `server/courses/` і `src/features/courses/`.
2. У `server.ts` FamilyHub:
   ```ts
   const medsDb = openMedsDb('data/meds.db');
   upsertPeople(medsDb, /* користувачі FamilyHub */);
   app.use('/api/medicine/courses', requireAuth, createCoursesRouter({ db: medsDb }));
   ```
3. У розділі «Медицина»: `<CoursesModule apiBase="/api/medicine/courses" currentPersonId={user.id} />`.
4. Перенести файл `data/meds.db` у том FamilyHub. Дані не мігруються.

Умова: id людей тут = id користувачів у FamilyHub.
