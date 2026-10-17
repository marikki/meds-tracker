import { useEffect, useState, type FormEvent } from 'react';
import { CoursesModule } from './features/courses';
import { OfflineBanner } from './OfflineBanner';

/** Оболонка лише окремого застосунку: вхід + модуль. У FamilyHub не переїжджає. */
type Me = { id: string; name: string };

const ME_CACHE_KEY = 'meds-tracker:me';

function loadCachedMe(): Me | undefined {
  try {
    const raw = localStorage.getItem(ME_CACHE_KEY);
    return raw ? (JSON.parse(raw) as Me) : undefined;
  } catch {
    return undefined;
  }
}

function saveMe(me: Me | null) {
  if (me) localStorage.setItem(ME_CACHE_KEY, JSON.stringify(me));
  else localStorage.removeItem(ME_CACHE_KEY);
}

export function App() {
  const cachedMe = loadCachedMe();
  const [me, setMe] = useState<Me | null | undefined>(cachedMe ?? undefined);

  useEffect(() => {
    fetch('/api/auth/me')
      .then(async (r) => {
        if (r.ok) {
          const next = (await r.json()) as Me;
          saveMe(next);
          setMe(next);
          return;
        }
        if (r.status === 401 || r.status === 403) {
          saveMe(null);
          setMe(null);
        }
      })
      .catch(() => {
        if (!cachedMe) setMe(null);
      });
  }, []);

  if (me === undefined) return null;
  if (me === null)
    return (
      <>
        <OfflineBanner />
        <Login onDone={(m) => { saveMe(m); setMe(m); }} />
      </>
    );
  return (
    <>
      <OfflineBanner />
      <CoursesModule apiBase="/api/courses" currentPersonId={me.id} />
    </>
  );
}

function Login({ onDone }: { onDone: (me: Me) => void }) {
  const [error, setError] = useState('');

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ user: form.get('user'), password: form.get('password') }),
    });
    const body = await res.json();
    if (res.ok) onDone(body);
    else setError(body.error);
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-5">
      <h1 className="text-3xl font-bold tracking-tight">Курсы</h1>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm text-muted">
          Имя
          <input name="user" autoComplete="username" required className="h-11 rounded-xl border border-line bg-surface px-3 text-base text-ink" />
        </label>
        <label className="flex flex-col gap-1 text-sm text-muted">
          Пароль
          <input name="password" type="password" autoComplete="current-password" required className="h-11 rounded-xl border border-line bg-surface px-3 text-base text-ink" />
        </label>
        {error && <p className="text-sm text-due-ink">{error}</p>}
        <button className="h-12 rounded-xl bg-accent font-semibold text-white">Войти</button>
      </form>
    </main>
  );
}
