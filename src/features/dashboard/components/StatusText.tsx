import styles from './StatusText.module.scss';

export type StatusTone = 'critical' | 'warning' | 'neutral';

interface StatusTextProps {
  tone: StatusTone;
  children: React.ReactNode;
  className?: string;
}

/**
 * A status word set in the dashboard's label type (mono, uppercase, tracked), coloured by
 * severity. No pill, no dot: the word carries the meaning and colour only reinforces it.
 * Healthy items get no status label at all; only exceptions are marked.
 */
export function StatusText({ tone, children, className }: StatusTextProps) {
  return (
    <span className={[styles.status, styles[tone], className].filter(Boolean).join(' ')}>
      {children}
    </span>
  );
}
