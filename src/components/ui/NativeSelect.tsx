import { useId, type ReactNode } from 'react';
import { IconChevronDown } from './icons';
import styles from './NativeSelect.module.scss';

export interface NativeSelectOption {
  value: string;
  label: string;
}

interface NativeSelectProps {
  /** Visible label. Always rendered so the control states what it changes. */
  label: ReactNode;
  value: string;
  options: ReadonlyArray<NativeSelectOption>;
  onChange: (value: string) => void;
  className?: string;
  disabled?: boolean;
  /** `inline` puts the label beside the select; `stacked` puts it above, for narrow grids. */
  layout?: 'inline' | 'stacked';
}

/**
 * Labelled native select for compact phone toolbars. The platform picker gives touch,
 * keyboard and screen-reader behavior for free; the label stays visible beside it.
 */
export function NativeSelect({
  label,
  value,
  options,
  onChange,
  className,
  disabled,
  layout = 'inline',
}: NativeSelectProps) {
  const id = useId();
  return (
    <div
      className={[styles.field, layout === 'stacked' ? styles.stacked : '', className ?? '']
        .filter(Boolean)
        .join(' ')}
    >
      <label htmlFor={id}>{label}</label>
      <span className={styles.wrap}>
        <select
          id={id}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <IconChevronDown size={16} className={styles.chevron} aria-hidden="true" />
      </span>
    </div>
  );
}
