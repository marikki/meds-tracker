import type { Person } from '../types';

export function PersonSwitch({
  people,
  value,
  onChange,
}: {
  people: Person[];
  value: string;
  onChange: (v: string) => void;
}) {
  const options = [{ id: 'all', name: 'Оба' }, ...people];
  return (
    <div role="group" aria-label="Чьи курсы показывать" className="grid gap-1 rounded-xl bg-track p-1"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={value === o.id}
          onClick={() => onChange(o.id)}
          className={`h-10 rounded-lg text-[15px] ${
            value === o.id ? 'bg-surface font-semibold text-ink shadow-sm' : 'font-medium text-muted'
          }`}
        >
          {o.name}
        </button>
      ))}
    </div>
  );
}
