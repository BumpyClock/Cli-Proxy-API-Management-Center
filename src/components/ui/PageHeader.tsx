import type { ReactNode } from 'react';
import styles from './PageHeader.module.scss';

export interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  titleId?: string;
  variant?: 'default' | 'hero';
  /**
   * Phones: always put actions on their own row under the title. For pages whose action count
   * changes between tabs, so the content below keeps one position.
   */
  stackActionsOnPhone?: boolean;
}

export function PageHeader({
  title,
  description,
  meta,
  actions,
  children,
  className,
  titleId,
  variant = 'default',
  stackActionsOnPhone = false,
}: PageHeaderProps) {
  return (
    <header
      className={[
        styles.header,
        variant === 'hero' ? styles.heroHeader : undefined,
        stackActionsOnPhone ? styles.stackActions : undefined,
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className={styles.heading}>
        <h1 id={titleId} className={variant === 'hero' ? styles.hero : undefined} tabIndex={-1}>
          {title}
        </h1>
        {description && <div className={styles.description}>{description}</div>}
        {meta && <div className={styles.meta}>{meta}</div>}
      </div>
      {actions && <div className={styles.actions}>{actions}</div>}
      {children && <div className={styles.detail}>{children}</div>}
    </header>
  );
}
