import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { IconChevronRight } from '@/components/ui/icons';
import { QUICK_START_STEPS } from '../workbenchLayout';
import styles from './QuickStartSteps.module.scss';
import { iconSize } from '@/design-system';

export function QuickStartSteps() {
  const { t } = useTranslation();
  return (
    <section className={styles.setup} aria-labelledby="quick-start-steps">
      <h2 id="quick-start-steps" className={styles.title}>
        {t('redesign.providers.setupTitle')}
      </h2>
      <ol className={styles.list}>
        {QUICK_START_STEPS.map((step, index) => (
          <li key={step.to}>
            <Link className={styles.stepLink} to={step.to}>
              <span className={styles.number} aria-hidden="true">
                {index + 1}
              </span>
              <span className={styles.label}>{t(step.labelKey)}</span>
              <span className={styles.destination}>{t(step.destinationKey)}</span>
              <IconChevronRight
                size={iconSize['16']}
                aria-hidden="true"
                className={styles.chevron}
              />
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
