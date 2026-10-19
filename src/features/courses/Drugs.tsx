import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import type { CoursesApi } from './api';
import { Check } from './components/Check';
import { PersonBadge } from './components/PersonBadge';
import type { Drug, DrugGroup, DrugInput, DrugWithPrescriptions, GroupInput, Person } from './types';

const KIND_LABEL: Record<Drug['kind'], string> = { supplement: 'Добавка', peptide: 'Пептид' };

type Scheme = Pick<Drug, 'courseDays' | 'breakDays' | 'coursesPerYear'>;
type After = Pick<Drug, 'afterDrugId' | 'afterGroupId'>;

/** «Добавка · курс 30 дн. · перерыв 60 дн. · до 2 в год · после «Витамины B»» */
function schemeText(first: string, s: Scheme, after: string) {
  const parts = [first, `курс ${s.courseDays} дн.`, s.breakDays ? `перерыв ${s.breakDays} дн.` : 'без перерыва'];
  if (s.coursesPerYear) parts.push(`до ${s.coursesPerYear} в год`);
  if (after) parts.push(`после «${after}»`);
  return parts.join(' · ');
}

const field = 'h-11 rounded-xl border border-line bg-surface px-3 text-base text-ink';
const label = 'flex flex-col gap-1 text-sm text-muted';

type Editing = { drug: DrugWithPrescriptions | null } | { group: DrugGroup | null };

export function Drugs({ api, people }: { api: CoursesApi; people: Person[] }) {
  const [drugs, setDrugs] = useState<DrugWithPrescriptions[] | null>(null);
  const [groups, setGroups] = useState<DrugGroup[]>([]);
  const [error, setError] = useState('');
  // null — список; { drug: null } / { group: null } — форма нового
  const [editing, setEditing] = useState<Editing | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const load = useCallback(() => {
    Promise.all([api.drugs(), api.groups()]).then(([d, g]) => {
      setDrugs(d);
      setGroups(g);
    }, (e: Error) => setError(e.message));
  }, [api]);
  useEffect(load, [load]);

  const byId = useMemo(() => new Map(people.map((p, i) => [p.id, { p, primary: i === 0 }])), [people]);

  const onClose = (changed: boolean) => {
    setEditing(null);
    if (changed) load();
  };
  if (editing && drugs) {
    return 'drug' in editing ? (
      <DrugForm api={api} people={people} drug={editing.drug} drugs={drugs} groups={groups} onClose={onClose} />
    ) : (
      <GroupForm api={api} group={editing.group} drugs={drugs} groups={groups} onClose={onClose} />
    );
  }
  if (error) return <p className="p-5 text-due-ink">{error}</p>;
  if (!drugs) return null;

  const afterName = (a: After) =>
    (a.afterDrugId && drugs.find((d) => d.id === a.afterDrugId)?.name) ||
    (a.afterGroupId && groups.find((g) => g.id === a.afterGroupId)?.name) ||
    '';

  const active = drugs.filter((d) => !d.archived);
  const archived = drugs.filter((d) => d.archived);
  // Препарати в комплексі показуються всередині його картки
  const solo = active.filter((d) => !d.groupId || !groups.some((g) => g.id === d.groupId));
  const units = [
    ...groups.map((g) => ({ name: g.name, group: g })),
    ...solo.map((d) => ({ name: d.name, drug: d })),
  ].sort((a, b) => a.name.localeCompare(b.name, 'ru'));

  const card = (d: DrugWithPrescriptions) => (
    <button
      key={d.id}
      type="button"
      onClick={() => setEditing({ drug: d })}
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
      <span className="text-sm text-muted">{schemeText(KIND_LABEL[d.kind], d, afterName(d))}</span>
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

  const groupCard = (g: DrugGroup) => {
    const members = active.filter((d) => d.groupId === g.id);
    const personIds = new Set(members.flatMap((d) => d.prescriptions.map((p) => p.personId)));
    return (
      <div key={`g${g.id}`} className="flex flex-col rounded-2xl bg-surface">
        <button
          type="button"
          onClick={() => setEditing({ group: g })}
          className="flex w-full flex-col gap-1 px-4 pt-3.5 pb-3 text-left"
        >
          <span className="flex items-start justify-between gap-3">
            <span className="font-semibold">{g.name}</span>
            <span className="flex gap-1">
              {people
                .filter((p) => personIds.has(p.id))
                .map((p) => {
                  const b = byId.get(p.id)!;
                  return <PersonBadge key={p.id} person={b.p} primary={b.primary} />;
                })}
            </span>
          </span>
          <span className="text-sm text-muted">{schemeText('Комплекс', g, afterName(g))}</span>
        </button>
        <div className="mx-4 divide-y divide-line border-t border-line">
          {members.length === 0 && <p className="py-2.5 text-sm text-muted">Нет препаратов</p>}
          {members.map((d) => {
            const dosages = d.prescriptions
              .filter((p) => p.dosage)
              .map((p) => `${byId.get(p.personId)?.p.name ?? p.personId}: ${p.dosage}`)
              .join(' · ');
            return (
              <button
                key={d.id}
                type="button"
                onClick={() => setEditing({ drug: d })}
                className="flex w-full items-center gap-2 py-2.5 text-left"
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-[15px] font-medium">{d.name}</span>
                  {dosages && <span className="text-sm text-muted">{dosages}</span>}
                </span>
                <ChevronRight size={18} aria-hidden="true" className="shrink-0 text-muted" />
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-5 px-5 pt-6 pb-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-3xl font-bold tracking-tight">Препараты</h1>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setEditing({ group: null })}
            className="flex h-10 items-center gap-1 rounded-xl border border-line bg-surface px-3 font-semibold text-accent"
          >
            <Plus size={18} aria-hidden="true" />
            Комплекс
          </button>
          <button
            type="button"
            onClick={() => setEditing({ drug: null })}
            className="flex h-10 items-center gap-1 rounded-xl bg-accent px-3 font-semibold text-white"
          >
            <Plus size={18} aria-hidden="true" />
            Препарат
          </button>
        </div>
      </header>

      <section className="flex flex-col gap-2.5">
        {units.length === 0 && <p className="text-sm text-muted">Пока пусто. Добавьте первый препарат.</p>}
        {units.map((u) => ('group' in u ? groupCard(u.group!) : card(u.drug!)))}
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

/** Числа схеми: курс, перерва, курсів на рік (рядки — як у полях форми) */
function SchemeFields({
  value,
  onChange,
}: {
  value: { courseDays: string; breakDays: string; coursesPerYear: string };
  onChange: (v: { courseDays: string; breakDays: string; coursesPerYear: string }) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-2">
      <label className={label}>
        Курс, дней
        <input type="number" inputMode="numeric" min={1} required value={value.courseDays}
          onChange={(e) => onChange({ ...value, courseDays: e.target.value })} className={field} />
      </label>
      <label className={label}>
        Перерыв, дней
        <input type="number" inputMode="numeric" min={0} placeholder="0" value={value.breakDays}
          onChange={(e) => onChange({ ...value, breakDays: e.target.value })} className={field} />
      </label>
      <label className={label}>
        Курсов в год
        <input type="number" inputMode="numeric" min={1} placeholder="—" value={value.coursesPerYear}
          onChange={(e) => onChange({ ...value, coursesPerYear: e.target.value })} className={field} />
      </label>
    </div>
  );
}

const schemeState = (s: Scheme | null) => ({
  courseDays: s ? String(s.courseDays) : '',
  breakDays: s ? String(s.breakDays) : '',
  coursesPerYear: s?.coursesPerYear ? String(s.coursesPerYear) : '',
});
const schemeInput = (s: ReturnType<typeof schemeState>): Scheme => ({
  courseDays: Number(s.courseDays),
  breakDays: Number(s.breakDays || 0),
  coursesPerYear: s.coursesPerYear ? Number(s.coursesPerYear) : null,
});

/** Значення селекта «Начинать после»: '' | 'd:12' | 'g:3' */
const afterValue = (a: After | null) =>
  a?.afterDrugId ? `d:${a.afterDrugId}` : a?.afterGroupId ? `g:${a.afterGroupId}` : '';
const afterInput = (v: string): After => ({
  afterDrugId: v.startsWith('d:') ? Number(v.slice(2)) : null,
  afterGroupId: v.startsWith('g:') ? Number(v.slice(2)) : null,
});

function AfterSelect({
  value,
  onChange,
  drugs,
  groups,
}: {
  value: string;
  onChange: (v: string) => void;
  /** Уже без самого препарату чи препаратів свого комплексу */
  drugs: Drug[];
  groups: DrugGroup[];
}) {
  return (
    <label className={label}>
      Начинать после
      <select value={value} onChange={(e) => onChange(e.target.value)} className={field}>
        <option value="">— не важно</option>
        {groups.length > 0 && (
          <optgroup label="Комплексы">
            {groups.map((g) => <option key={g.id} value={`g:${g.id}`}>{g.name}</option>)}
          </optgroup>
        )}
        <optgroup label="Препараты">
          {drugs.map((d) => <option key={d.id} value={`d:${d.id}`}>{d.name}</option>)}
        </optgroup>
      </select>
      <span className="text-[13px]">Старт не попадёт на его курс — прогноз сдвинется на день после его окончания.</span>
    </label>
  );
}

function DrugForm({
  api,
  people,
  drug,
  drugs,
  groups,
  onClose,
}: {
  api: CoursesApi;
  people: Person[];
  drug: DrugWithPrescriptions | null;
  drugs: DrugWithPrescriptions[];
  groups: DrugGroup[];
  onClose: (changed: boolean) => void;
}) {
  const group = groups.find((g) => g.id === drug?.groupId);
  const [name, setName] = useState(drug?.name ?? '');
  const [kind, setKind] = useState<Drug['kind']>(drug?.kind ?? 'supplement');
  const [scheme, setScheme] = useState(() => schemeState(drug));
  const [after, setAfter] = useState(() => afterValue(drug));
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
      ...schemeInput(scheme),
      ...afterInput(after),
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

      {group ? (
        <p className="rounded-xl bg-accent-soft px-3 py-2.5 text-sm text-accent-ink">
          В комплексе «{group.name}» — схема и «начинать после» задаются в нём.
        </p>
      ) : (
        <>
          <SchemeFields value={scheme} onChange={setScheme} />
          <AfterSelect
            value={after}
            onChange={setAfter}
            drugs={drugs.filter((d) => !d.archived && d.id !== drug?.id)}
            groups={groups}
          />
        </>
      )}

      <fieldset className="flex min-w-0 flex-col gap-2">
        <legend className="mb-1 text-sm text-muted">Кому и дозировка</legend>
        {people.map((p) => {
          const on = p.id in dosages;
          return (
            <div key={p.id} className="flex items-center gap-3 rounded-xl bg-surface px-3 py-2">
              <label className="flex min-w-24 items-center gap-2 font-medium">
                <Check checked={on} onChange={() => togglePerson(p.id)} />
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

function GroupForm({
  api,
  group,
  drugs,
  groups,
  onClose,
}: {
  api: CoursesApi;
  group: DrugGroup | null;
  drugs: DrugWithPrescriptions[];
  groups: DrugGroup[];
  onClose: (changed: boolean) => void;
}) {
  const [name, setName] = useState(group?.name ?? '');
  const [scheme, setScheme] = useState(() => schemeState(group));
  const [after, setAfter] = useState(() => afterValue(group));
  const [notes, setNotes] = useState(group?.notes ?? '');
  const [members, setMembers] = useState<Set<number>>(() => new Set(group?.drugIds ?? []));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Архівні показуємо лише якщо вони вже в комплексі
  const candidates = drugs.filter((d) => !d.archived || members.has(d.id));
  const groupName = (id: number | null) => groups.find((g) => g.id === id)?.name;

  const toggle = (id: number) =>
    setMembers((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

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
    const input: GroupInput = {
      name,
      ...schemeInput(scheme),
      ...afterInput(after),
      notes,
      drugIds: [...members],
    };
    run(() => (group ? api.updateGroup(group.id, input) : api.createGroup(input)));
  }

  function remove() {
    if (window.confirm(`Расформировать комплекс «${group!.name}»? Препараты и история курсов останутся.`)) {
      run(() => api.deleteGroup(group!.id));
    }
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
        <h1 className="text-3xl font-bold tracking-tight">{group ? 'Комплекс' : 'Новый комплекс'}</h1>
        <p className="text-sm text-muted">Препараты, которые принимают вместе: курс начинается и заканчивается одновременно.</p>
      </header>

      <label className={label}>
        Название
        <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Витамины B" className={field} />
      </label>

      <SchemeFields value={scheme} onChange={setScheme} />

      <AfterSelect
        value={after}
        onChange={setAfter}
        drugs={drugs.filter((d) => !d.archived && !members.has(d.id))}
        groups={groups.filter((g) => g.id !== group?.id)}
      />

      <fieldset className="flex min-w-0 flex-col gap-2">
        <legend className="mb-1 text-sm text-muted">
          Препараты · {members.size}
          <span className="block text-[13px]">Схема комплекса заменит их собственную.</span>
        </legend>
        <div className="divide-y divide-line rounded-xl bg-surface px-3">
          {candidates.map((d) => {
            const other = d.groupId !== null && d.groupId !== group?.id ? groupName(d.groupId) : undefined;
            return (
              <label key={d.id} className="flex cursor-pointer items-center gap-3 py-2.5">
                <Check checked={members.has(d.id)} onChange={() => toggle(d.id)} />
                <span className="flex min-w-0 flex-col">
                  <span className="font-medium">{d.name}</span>
                  {other && <span className="text-[13px] text-muted">сейчас в «{other}» — перейдёт сюда</span>}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <label className={label}>
        Заметки
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3}
          className="rounded-xl border border-line bg-surface px-3 py-2 text-base text-ink" />
      </label>

      {error && <p className="text-sm text-due-ink">{error}</p>}

      <button disabled={busy} className="h-12 rounded-xl bg-accent font-semibold text-white disabled:opacity-60">
        {group ? 'Сохранить' : 'Создать'}
      </button>
      {group && (
        <button
          type="button"
          disabled={busy}
          onClick={remove}
          className="h-11 rounded-xl border border-line font-semibold text-muted disabled:opacity-60"
        >
          Расформировать
        </button>
      )}
    </form>
  );
}
