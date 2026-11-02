import { useTranslation } from 'react-i18next';
import type { CopilotQuotaState } from '@/types';
import { useNow } from '@/hooks/useNow';
import { buildResetDisplay } from '@/utils/quota';
import { QuotaMeter } from '../../components/QuotaMeter';
import { QuotaResetLabel } from '../../components/QuotaResetLabel';
import { collectQuotaRowInstants, pickUrgentRowId } from '../../resetSchedule';
import type { QuotaBodyProps } from '../../types';

export function CopilotQuotaBody({ quota, classes }: QuotaBodyProps<CopilotQuotaState>) {
  const { t, i18n } = useTranslation();
  const now = useNow();
  const data = quota.data;
  if (!data) return <div className={classes.quotaMessage}>{t('copilot_quota.empty_data')}</div>;

  const reset = buildResetDisplay(null, data.resetAtMs, now, i18n.resolvedLanguage);
  const urgent = pickUrgentRowId(collectQuotaRowInstants('github-copilot', quota), now) !== null;
  const unknown = t('copilot_quota.unknown');
  const formatCount = (value: number | null) =>
    value === null ? unknown : value.toLocaleString(i18n.resolvedLanguage);

  return (
    <>
      {(data.plan || reset) && (
        <div className={classes.codexPlan}>
          {data.plan && (
            <span className={classes.codexPlanItem}>
              <span className={classes.codexPlanLabel}>{t('copilot_quota.plan')}</span>
              <span className={classes.codexPlanValue}>{data.plan}</span>
            </span>
          )}
          {reset && (
            <span className={classes.codexPlanItem}>
              <span className={classes.codexPlanLabel}>{t('copilot_quota.reset')}</span>
              <QuotaResetLabel display={reset} classes={classes} soon={urgent} />
            </span>
          )}
        </div>
      )}
      {data.resources.map((resource, index) => {
        const label = t(`copilot_quota.${resource.id}`);
        const percent = resource.remainingPercent;
        return (
          <div key={resource.id} className={classes.quotaRow}>
            <div className={classes.quotaRowHeader}>
              <span className={classes.quotaModel}>{label}</span>
              <span className={classes.quotaPercent}>
                {resource.unlimited === true
                  ? t('copilot_quota.unlimited')
                  : percent === null
                    ? unknown
                    : t('copilot_quota.remaining', { percent: Number(percent.toFixed(1)) })}
              </span>
            </div>
            {resource.unlimited !== true && (
              <>
                {(resource.remaining !== null || resource.entitlement !== null) && (
                  <div className={classes.quotaAmount}>
                    {t('copilot_quota.remaining_count', {
                      remaining: formatCount(resource.remaining),
                      entitlement: formatCount(resource.entitlement),
                    })}
                  </div>
                )}
                {percent !== null && (
                  <div
                    role="meter"
                    aria-label={label}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={percent}
                  >
                    <QuotaMeter percent={percent} classes={classes} index={index} />
                  </div>
                )}
              </>
            )}
          </div>
        );
      })}
    </>
  );
}
