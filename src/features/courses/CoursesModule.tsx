import { CalendarDays, House, Pill } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { createApi } from './api';
import { Drugs } from './Drugs';
import { PlanView } from './Plan';
import { Today } from './Today';
import type { Person } from './types';

type Tab = 'today' | 'drugs' | 'plan';

/**
 * Точка входу модуля. Без роутера і глобального стану, тому монтується
 * в будь-яке місце FamilyHub: <CoursesModule apiBase="/api/medicine/courses" currentPersonId={user.id} />
 */
export function CoursesModule({ apiBase, currentPersonId }: { apiBase: string; currentPersonId: string }) {
  const api = useMemo(() => createApi(apiBase), [apiBase]);
  const [tab, setTab] = useState<Tab>('today');
  const [people, setPeople] = useState<Person[]>([]);

  useEffect(() => {
    // Поточний користувач першим: він отримує «свій» темний бейдж
    api.people().then((list) =>
      setPeople([...list].sort((a, b) => Number(b.id === currentPersonId) - Number(a.id === currentPersonId))),
    );
  }, [api, currentPersonId]);

  const tabs = [
    { id: 'today' as const, label: 'Сегодня', Icon: House },
    { id: 'drugs' as const, label: 'Препараты', Icon: Pill },
    { id: 'plan' as const, label: 'План', Icon: CalendarDays },
  ];

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col">
      <main className="flex-1">
        {tab === 'today' && <Today api={api} people={people} />}
        {tab === 'drugs' && <Drugs api={api} people={people} />}
        {tab === 'plan' && <PlanView api={api} people={people} />}
      </main>
      <nav aria-label="Разделы" className="sticky bottom-0 flex border-t border-line bg-surface px-3 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))]">
        {tabs.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            aria-current={tab === id ? 'page' : undefined}
            onClick={() => setTab(id)}
            className={`flex flex-1 flex-col items-center gap-1 py-1 text-xs ${
              tab === id ? 'font-semibold text-accent' : 'font-medium text-muted'
            }`}
          >
            <Icon size={24} aria-hidden="true" />
            {label}
          </button>
        ))}
      </nav>
    </div>
  );
}
