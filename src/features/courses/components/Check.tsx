import { Check as CheckIcon } from 'lucide-react';

/**
 * Кругла галочка замість нативного чекбокса. Кладеться всередину <label>,
 * тож підпис рядка працює як зазвичай; сам input лишається для клавіатури й читачів екрана.
 */
export function Check({
  checked,
  onChange,
  disabled,
  tone = 'accent',
}: {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  /** due — у блоці «Пора начинать» */
  tone?: 'accent' | 'due';
}) {
  const on = tone === 'due' ? 'peer-checked:border-due peer-checked:bg-due' : 'peer-checked:border-accent peer-checked:bg-accent';
  return (
    <span className="relative flex shrink-0">
      <input type="checkbox" checked={checked} onChange={onChange} disabled={disabled} className="peer sr-only" />
      <span
        aria-hidden="true"
        className={`flex size-6 items-center justify-center rounded-full border-[1.5px] border-muted/40 bg-surface text-white transition-colors motion-reduce:transition-none ${on} peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent peer-disabled:opacity-40 [&>svg]:scale-50 [&>svg]:opacity-0 [&>svg]:transition-all peer-checked:[&>svg]:scale-100 peer-checked:[&>svg]:opacity-100 motion-reduce:[&>svg]:transition-none`}
      >
        <CheckIcon size={15} strokeWidth={3} />
      </span>
    </span>
  );
}
