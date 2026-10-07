'use client';

import { cn } from '@f4d/ui/cn';

/** Seleção múltipla em "pílulas" (checkboxes acessíveis estilizados). */
export function ChipGroup<T extends string>({
  legend,
  options,
  value,
  onChange,
  max,
}: {
  legend: string;
  options: { value: T; label: string }[];
  value: readonly T[];
  onChange: (next: T[]) => void;
  max?: number;
}) {
  const toggle = (option: T) =>
    onChange(value.includes(option) ? value.filter((v) => v !== option) : [...value, option]);
  const full = max !== undefined && value.length >= max;

  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-1 text-body font-medium">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const checked = value.includes(option.value);
          return (
            <label
              key={option.value}
              className={cn(
                'cursor-pointer rounded-pill border border-dark px-3 py-1.5 text-sm transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-dark',
                checked ? 'bg-accent' : 'bg-bg hover:bg-surface',
                !checked && full && 'cursor-not-allowed opacity-40',
              )}
            >
              <input
                type="checkbox"
                className="sr-only"
                checked={checked}
                disabled={!checked && full}
                onChange={() => toggle(option.value)}
              />
              {option.label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
