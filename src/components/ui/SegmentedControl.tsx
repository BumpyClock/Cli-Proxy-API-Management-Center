import type { ReactNode, Ref } from 'react';
import styles from './SegmentedControl.module.scss';

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  /** Optional count shown after the label, in tabular numerals. */
  count?: number;
  icon?: ReactNode;
  /** Danger tone colors only the selected segment, for filters such as "Problem". */
  tone?: 'danger';
  disabled?: boolean;
  /** Accessible name when the visible label is not enough (for example, an icon-only option). */
  ariaLabel?: string;
}

interface SegmentedControlProps<T extends string> {
  options: ReadonlyArray<SegmentedOption<T>>;
  value: T;
  onChange: (value: T) => void;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  disabled?: boolean;
  /** Keeps one row and scrolls horizontally instead of wrapping (long provider lists). */
  scrollable?: boolean;
  fullWidth?: boolean;
  className?: string;
  trackRef?: Ref<HTMLDivElement>;
  /** Extra attributes for the track, such as `data-overflow` for edge fades. */
  dataOverflow?: string;
}

/**
 * The one owner of the "choose one of N" selected state: a grey track with a raised segment.
 * Route-level tabs (underline) and multi-select filter chips are different roles and do not
 * use this component.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  ariaLabelledBy,
  disabled = false,
  scrollable = false,
  fullWidth = false,
  className,
  trackRef,
  dataOverflow,
}: SegmentedControlProps<T>) {
  const classes = [
    styles.track,
    scrollable ? styles.scrollable : '',
    fullWidth ? styles.fullWidth : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div
      ref={trackRef}
      className={classes}
      role="group"
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      data-overflow={dataOverflow}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            className={[
              styles.segment,
              selected ? styles.selected : '',
              option.tone === 'danger' ? styles.danger : '',
            ]
              .filter(Boolean)
              .join(' ')}
            aria-pressed={selected}
            aria-label={option.ariaLabel}
            disabled={disabled || option.disabled}
            onClick={() => {
              if (!selected) onChange(option.value);
            }}
          >
            {option.icon}
            <span className={styles.label}>{option.label}</span>
            {option.count !== undefined && <span className={styles.count}>{option.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
