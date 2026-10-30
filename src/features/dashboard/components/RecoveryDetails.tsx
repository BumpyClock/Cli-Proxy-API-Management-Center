import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CredentialRow } from '../types';
import { credentialRecovery } from './formatters';
import styles from './RecoveryDetails.module.scss';

const MAX_MODEL_NAMES = 3;

interface RecoveryDetailsProps {
  row: CredentialRow;
  now: number;
  /** Class for each line, so the host list keeps its own type. */
  lineClassName?: string;
}

/**
 * Why a credential is limited and when that may change. Affected models are named; long
 * lists show the first few with an inline "+N more" that reveals the rest in place.
 */
export function RecoveryDetails({ row, now, lineClassName }: RecoveryDetailsProps) {
  const { t, i18n } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const info = credentialRecovery(t, row, now, i18n.language);
  if (!info.cooldown && !info.deadline) return null;

  const models = info.cooldown?.models ?? [];
  const shown = expanded ? models : models.slice(0, MAX_MODEL_NAMES);
  const hidden = models.length - shown.length;

  return (
    <>
      {info.cooldown && (
        <span className={lineClassName}>
          {info.cooldown.label}
          {models.length > 0 && (
            <>
              {t('dashboard.list_colon')}
              {shown.join(', ')}
              {models.length > MAX_MODEL_NAMES && (
                <>
                  {' '}
                  <button
                    type="button"
                    className={styles.more}
                    aria-expanded={expanded}
                    aria-label={
                      expanded
                        ? t('dashboard.models_fewer_label')
                        : t('dashboard.models_more_label', { count: hidden })
                    }
                    onClick={() => setExpanded((value) => !value)}
                  >
                    {expanded
                      ? t('dashboard.models_fewer')
                      : t('dashboard.models_more', { count: hidden })}
                  </button>
                </>
              )}
            </>
          )}
          {info.cooldown.cause && ` (${info.cooldown.cause})`}
        </span>
      )}
      {info.deadline && <span className={lineClassName}>{info.deadline}</span>}
    </>
  );
}
