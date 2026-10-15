import { useEffect, useState, type FormEvent } from 'react';
import { CoursesModule } from './features/courses';

/** Оболонка лише окремого застосунку: вхід + модуль. У FamilyHub не переїжджає. */
type Me = { id: string; name: string };

export function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => (r.ok ? r.json() : null))
      .then(setMe)
      .catch(() => setMe(null));
  }, []);

  if (me === undefined) return null;
  if (me === null) return <Login onDone={setMe} />;
  return <CoursesModule apiBase="/api/courses" currentPersonId={me.id} />;
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
