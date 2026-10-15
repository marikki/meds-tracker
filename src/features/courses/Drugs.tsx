import { ChevronLeft, Plus } from 'lucide-react';
import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import type { CoursesApi } from './api';
import { PersonBadge } from './components/PersonBadge';
import type { Drug, DrugInput, DrugWithPrescriptions, Person } from './types';

const KIND_LABEL: Record<Drug['kind'], string> = { supplement: 'Добавка', peptide: 'Пептид' };

/** «Добавка · курс 30 дн. · перерыв 60 дн. · до 2 в год» */
function schemeText(d: Drug) {
  const parts = [
    KIND_LABEL[d.kind],
    `курс ${d.courseDays} дн.`,
    d.breakDays ? `перерыв ${d.breakDays} дн.` : 'без перерыва',
  ];
  if (d.coursesPerYear) parts.push(`до ${d.coursesPerYear} в год`);
  return parts.join(' · ');
}

const field = 'h-11 rounded-xl border border-line bg-surface px-3 text-base text-ink';
const label = 'flex flex-col gap-1 text-sm text-muted';

export function Drugs({ api, people }: { api: CoursesApi; people: Person[] }) {
  const [drugs, setDrugs] = useState<DrugWithPrescriptions[] | null>(null);
  const [error, setError] = useState('');
  // null — список, 'new' — форма нового препарату, препарат — форма правки
  const [editing, setEditing] = useState<DrugWithPrescriptions | 'new' | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const load = useCallback(() => {
    api.drugs().then(setDrugs, (e: Error) => setError(e.message));
  }, [api]);
  useEffect(load, [load]);

  const byId = useMemo(() => new Map(people.map((p, i) => [p.id, { p, primary: i === 0 }])), [people]);

  if (editing) {
    return (
      <DrugForm
        api={api}
        people={people}
        drug={editing === 'new' ? null : editing}
        onClose={(changed) => {
          setEditing(null);
          if (changed) load();
        }}
      />
    );
  }
  if (error) return <p className="p-5 text-due-ink">{error}</p>;
  if (!drugs) return null;

  const active = drugs.filter((d) => !d.archived);
  const archived = drugs.filter((d) => d.archived);

  const card = (d: DrugWithPrescriptions) => (
    <button
      key={d.id}
      type="button"
      onClick={() => setEditing(d)}
      className="flex w-full flex-col gap-1 rounded-2xl bg-surface px-4 py-3.5 text-left"
    >
      <span className="flex items-start justify-between gap-3">
        <span className="font-semibold">{d.name}</span>
        <span className="flex gap-1">
          {d.prescriptions.map((p) => {
            const b = byId.get(p.personId);
            return b ? <PersonBadge key={p.personId} person={b.p} primary={b.primary} /> : null;
          })}
        </span>
      </span>
      <span className="text-sm text-muted">{schemeText(d)}</span>
      {d.prescriptions.some((p) => p.dosage) && (
        <span className="text-sm text-muted">
          {d.prescriptions
            .filter((p) => p.dosage)
            .map((p) => `${byId.get(p.personId)?.p.name ?? p.personId}: ${p.dosage}`)
            .join(' · ')}
        </span>
      )}
    </button>
  );

  return (
    <div className="flex flex-col gap-5 px-5 pt-6 pb-6">
      <header className="flex items-end justify-between gap-3">
        <h1 className="text-3xl font-bold tracking-tight">Препараты</h1>
        <button
          type="button"
          onClick={() => setEditing('new')}
          className="flex h-10 items-center gap-1 rounded-xl bg-accent px-3 font-semibold text-white"
        >
          <Plus size={18} aria-hidden="true" />
          Добавить
        </button>
      </header>

      <section className="flex flex-col gap-2.5">
        {active.length === 0 && <p className="text-sm text-muted">Пока пусто. Добавьте первый препарат.</p>}
        {active.map(card)}
      </section>

      {archived.length > 0 && (
        <section className="flex flex-col gap-2.5">
          <button
            type="button"
            aria-expanded={showArchived}
            onClick={() => setShowArchived((v) => !v)}
            className="self-start text-sm font-semibold text-muted"
          >
            Архив · {archived.length} {showArchived ? '▴' : '▾'}
          </button>
          {showArchived && <div className="flex flex-col gap-2.5 opacity-70">{archived.map(card)}</div>}
        </section>
      )}
    </div>
  );
}

function DrugForm({
  api,
  people,
  drug,
  onClose,
}: {
  api: CoursesApi;
  people: Person[];
  drug: DrugWithPrescriptions | null;
  onClose: (changed: boolean) => void;
}) {
  const [name, setName] = useState(drug?.name ?? '');
  const [kind, setKind] = useState<Drug['kind']>(drug?.kind ?? 'supplement');
  const [courseDays, setCourseDays] = useState(drug ? String(drug.courseDays) : '');
  const [breakDays, setBreakDays] = useState(drug ? String(drug.breakDays) : '');
  const [coursesPerYear, setCoursesPerYear] = useState(drug?.coursesPerYear ? String(drug.coursesPerYear) : '');
  const [notes, setNotes] = useState(drug?.notes ?? '');
  // personId → дозування; немає ключа — препарат цій людині не призначено
  const [dosages, setDosages] = useState<Record<string, string>>(() =>
    Object.fromEntries((drug?.prescriptions ?? []).map((p) => [p.personId, p.dosage])),
  );
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const togglePerson = (id: string) =>
    setDosages(({ [id]: current, ...rest }) => (current === undefined ? { ...rest, [id]: '' } : rest));

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await action();
      onClose(true);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  function save(e: FormEvent) {
    e.preventDefault();
    // Сервер видаляє зняте призначення разом з усією історією курсів — питаємо явно
    const removed = (drug?.prescriptions ?? []).filter((p) => !(p.personId in dosages));
    if (removed.length > 0) {
      const who = removed.map((p) => people.find((x) => x.id === p.personId)?.name ?? p.personId).join(', ');
      if (!window.confirm(`${who}: история курсов по этому препарату будет удалена безвозвратно. Продолжить?`)) return;
    }
    const input: DrugInput = {
      name,
      kind,
      courseDays: Number(courseDays),
      breakDays: Number(breakDays || 0),
      coursesPerYear: coursesPerYear ? Number(coursesPerYear) : null,
      notes,
      prescriptions: Object.entries(dosages).map(([personId, dosage]) => ({ personId, dosage })),
    };
    run(() => (drug ? api.updateDrug(drug.id, input) : api.createDrug(input)));
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-4 px-5 pt-6 pb-6">
      <header className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => onClose(false)}
          className="flex items-center gap-1 self-start text-sm font-semibold text-accent"
        >
          <ChevronLeft size={18} aria-hidden="true" />
          Препараты
        </button>
        <h1 className="text-3xl font-bold tracking-tight">{drug ? 'Изменить' : 'Новый препарат'}</h1>
      </header>

      <label className={label}>
        Название
        <input value={name} onChange={(e) => setName(e.target.value)} required className={field} />
      </label>

      <div role="group" aria-label="Тип" className="grid grid-cols-2 gap-1 rounded-xl bg-track p-1">
        {(Object.keys(KIND_LABEL) as Drug['kind'][]).map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={kind === k}
            onClick={() => setKind(k)}
            className={`h-10 rounded-lg text-[15px] ${
              kind === k ? 'bg-surface font-semibold text-ink shadow-sm' : 'font-medium text-muted'
            }`}
          >
            {KIND_LABEL[k]}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-2">
        <label className={label}>
          Курс, дней
          <input type="number" inputMode="numeric" min={1} required value={courseDays}
            onChange={(e) => setCourseDays(e.target.value)} className={field} />
        </label>
        <label className={label}>
          Перерыв, дней
          <input type="number" inputMode="numeric" min={0} placeholder="0" value={breakDays}
            onChange={(e) => setBreakDays(e.target.value)} className={field} />
        </label>
        <label className={label}>
          Курсов в год
          <input type="number" inputMode="numeric" min={1} placeholder="—" value={coursesPerYear}
            onChange={(e) => setCoursesPerYear(e.target.value)} className={field} />
        </label>
      </div>

      <fieldset className="flex min-w-0 flex-col gap-2">
        <legend className="mb-1 text-sm text-muted">Кому и дозировка</legend>
        {people.map((p) => {
          const on = p.id in dosages;
          return (
            <div key={p.id} className="flex items-center gap-3 rounded-xl bg-surface px-3 py-2">
              <label className="flex min-w-24 items-center gap-2 font-medium">
                <input type="checkbox" checked={on} onChange={() => togglePerson(p.id)} className="size-5 accent-accent" />
                {p.name}
              </label>
              {on && (
                <input
                  aria-label={`Дозировка: ${p.name}`}
                  placeholder="1 капс. вечером"
                  value={dosages[p.id]}
                  onChange={(e) => setDosages((d) => ({ ...d, [p.id]: e.target.value }))}
                  className={`${field} h-10 min-w-0 flex-1`}
                />
              )}
            </div>
          );
        })}
      </fieldset>

      <label className={label}>
        Заметки
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3}
          className="rounded-xl border border-line bg-surface px-3 py-2 text-base text-ink" />
      </label>

      {error && <p className="text-sm text-due-ink">{error}</p>}

      <button disabled={busy} className="h-12 rounded-xl bg-accent font-semibold text-white disabled:opacity-60">
        {drug ? 'Сохранить' : 'Добавить'}
      </button>
      {drug && (
        <button
          type="button"
          disabled={busy}
          onClick={() => run(() => api.updateDrug(drug.id, { archived: !drug.archived }))}
          className="h-11 rounded-xl border border-line font-semibold text-muted disabled:opacity-60"
        >
          {drug.archived ? 'Вернуть из архива' : 'В архив'}
        </button>
      )}
    </form>
  );
}
