import type { Person } from '../types';

/** Перша людина у списку — темний бейдж, решта — світлий: відрізняються яскравістю, не лише відтінком. */
export function PersonBadge({ person, primary }: { person: Person; primary: boolean }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
        primary ? 'bg-me text-white' : 'bg-partner text-partner-ink'
      }`}
    >
      {person.name}
    </span>
  );
}
