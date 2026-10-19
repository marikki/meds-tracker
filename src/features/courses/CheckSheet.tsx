import { X } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import type { CoursesApi } from './api';
import { Check } from './components/Check';
import { addDays, daysUntil, plural, shortDate } from './format';
import type { OverviewItem, PendingCheck } from './types';
import { unitName } from './units';

const field = 'h-11 min-w-0 rounded-xl border border-line bg-surface px-3 text-base text-ink';
const label = 'flex min-w-0 flex-col gap-1 text-sm text-muted';

/** «30 ноя – 14 дек» або «к 14 дек», якщо вікно в один день */
export function checkWindow(c: PendingCheck, today: string): string {
  if (!c.dueFrom || !c.dueTo) return '';
  return c.dueFrom === c.dueTo
    ? `к ${shortDate(c.dueTo, today)}`
    : `${shortDate(c.dueFrom, today)} – ${shortDate(c.dueTo, today)}`;
}

/** Для блоку «Анализы»: скільки лишилося або наскільки прострочено */
export function checkDeadline(c: PendingCheck, today: string): { text: string; late: boolean } {
  if (!c.dueTo) return { text: '', late: false };
  if (today > c.dueTo) {
    const n = daysUntil(c.dueTo, today);
    return { text: `просрочен на ${n} ${plural(n, ['день', 'дня', 'дней'])}`, late: true };
  }
  return { text: `до ${shortDate(c.dueTo, today)}`, late: false };
}

const weeks = (days: number) => String(Math.round((days / 7) * 10) / 10);

/**
 * Здали аналіз: дата, результат, що сказав лікар, і чи призначено наступний контроль.
 * item — призначення з аналізом, що чекає (item.check).
 */
export function CheckSheet({
  api,
  item,
  personName,
  today,
  onClose,
}: {
  api: CoursesApi;
  item: OverviewItem;
  personName: string;
  today: string;
  onClose: (changed: boolean) => void;
}) {
  const check = item.check!;
  const [name, setName] = useState(check.name);
  const [doneOn, setDoneOn] = useState(today);
  const [result, setResult] = useState('');
  const [note, setNote] = useState('');
  const [next, setNext] = useState(false);
  // Підказка для наступного — вікно зі схеми препарату
  const [fromWeeks, setFromWeeks] = useState(item.drug.check ? weeks(item.drug.check.fromDays) : '');
  const [toWeeks, setToWeeks] = useState(item.drug.check ? weeks(item.drug.check.toDays) : '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const start = item.forecast.activeCourse?.startDate ?? '';
  const fromDays = Math.round(Number(fromWeeks) * 7);
  const toDays = toWeeks ? Math.round(Number(toWeeks) * 7) : fromDays;

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
    run(() =>
      api.addCheck(check.courseId, {
        name,
        doneOn,
        result,
        note,
        next: next ? { fromDays, toDays } : null,
      }),
    );
  }

  function cancel() {
    if (window.confirm(`Отменить анализ ${check.name}? Напоминание исчезнет.`)) run(() => api.deleteCheck(check.id!));
  }

  return (
    <div className="fixed inset-0 z-20 overflow-y-auto bg-ground">
      <form onSubmit={save} className="mx-auto flex min-h-dvh max-w-md flex-col">
        <header className="flex items-start justify-between pt-4 pr-2 pl-5">
          <div>
            <p className="text-sm text-muted">
              {unitName(item)} · {personName}
            </p>
            <h1 className="text-[22px] font-bold">Анализ сдан</h1>
          </div>
          <button type="button" aria-label="Закрыть" onClick={() => onClose(false)}
            className="flex size-11 items-center justify-center text-ink">
            <X size={22} aria-hidden="true" />
          </button>
        </header>

        <main className="flex flex-col gap-4 px-5 pt-4 pb-8">
          <div className="flex flex-col gap-3 rounded-2xl bg-surface p-4">
            <label className={label}>
              Анализ
              <input value={name} required onChange={(e) => setName(e.target.value)} className={field} />
            </label>
            <label className={label}>
              Дата сдачи
              <input type="date" value={doneOn} min={start || undefined} max={today} required
                onChange={(e) => e.target.value && setDoneOn(e.target.value)} className={field} />
            </label>
            <label className={label}>
              Результат
              <input value={result} placeholder="48 нг/мл" onChange={(e) => setResult(e.target.value)} className={field} />
            </label>
            <label className={label}>
              Заметка
              <textarea value={note} rows={3} placeholder="Что сказал врач" onChange={(e) => setNote(e.target.value)}
                className="rounded-xl border border-line bg-surface px-3 py-2 text-base text-ink" />
            </label>
          </div>

          <div className="flex flex-col gap-3 rounded-2xl bg-surface p-4">
            <label className="flex cursor-pointer items-start gap-3">
              <Check checked={next} onChange={() => setNext((v) => !v)} />
              <span className="flex flex-col">
                <span className="font-medium">Следующий контроль</span>
                <span className="text-[13px] text-muted">Если врач назначил повторный анализ</span>
              </span>
            </label>
            {next && (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <label className={label}>
                    Через, недель
                    <input type="number" inputMode="decimal" min={0.1} step="any" required value={fromWeeks}
                      onChange={(e) => setFromWeeks(e.target.value)} className={field} />
                  </label>
                  <label className={label}>
                    До, недель
                    <input type="number" inputMode="decimal" min={Number(fromWeeks) || 0} step="any" value={toWeeks}
                      onChange={(e) => setToWeeks(e.target.value)} className={field} />
                  </label>
                </div>
                {fromDays > 0 && doneOn && (
                  <p className="text-[13px] text-muted">
                    Напомним{' '}
                    {checkWindow({ ...check, dueFrom: addDays(doneOn, fromDays), dueTo: addDays(doneOn, Math.max(toDays, fromDays)) }, today)}
                  </p>
                )}
              </>
            )}
          </div>

          <p className="text-[13px] text-muted">
            Если врач изменил дозировку или срок приёма — поменяйте их в препарате.
          </p>

          {error && <p className="text-sm text-due-ink">{error}</p>}

          <button disabled={busy} className="h-12 rounded-xl bg-accent font-semibold text-white disabled:opacity-60">
            Сохранить
          </button>
          {/* Перший контроль за схемою не збережений — його прибирають у налаштуваннях препарату */}
          {check.id !== null && (
            <button type="button" disabled={busy} onClick={cancel}
              className="h-10 self-center px-3 text-sm font-semibold text-due-ink disabled:opacity-50">
              Анализ не нужен
            </button>
          )}
        </main>
      </form>
    </div>
  );
}
