import { useTranslation } from 'react-i18next';
import type { PluginQuotaMetric, PluginQuotaState } from '@/types';
import { useNow } from '@/hooks/useNow';
import { buildResetDisplay } from '@/utils/quota';
import { QuotaMeter } from '../../components/QuotaMeter';
import { QuotaResetLabel } from '../../components/QuotaResetLabel';
import type { QuotaBodyProps } from '../../types';

const formatMetric = (metric: PluginQuotaMetric, language: string): string => {
  const options: Intl.NumberFormatOptions =
    metric.format === 'currency' && metric.currency
      ? { style: 'currency', currency: metric.currency }
      : { maximumFractionDigits: 2 };
  const value = new Intl.NumberFormat(language, options).format(metric.value);
  return metric.unit ? `${value} ${metric.unit}` : value;
};

export function PluginQuotaBody({ quota, classes }: QuotaBodyProps<PluginQuotaState>) {
  const { t, i18n } = useTranslation();
  const now = useNow();
  if (!quota.subscription && !quota.summary.length && !quota.groups.length) {
    return <div className={classes.quotaMessage}>{t('plugin_quota.empty_data')}</div>;
  }
  return (
    <>
      {(quota.subscription || quota.summary.length > 0) && (
        <div className={classes.codexPlan}>
          {quota.subscription && (
            <span className={classes.codexPlanItem}>
              <span className={classes.codexPlanLabel}>{t('plugin_quota.plan_label')}</span>
              <span className={classes.codexPlanValue}>{quota.subscription}</span>
            </span>
          )}
          {quota.summary.map((metric) => (
            <span key={metric.key} className={classes.codexPlanItem}>
              <span className={classes.codexPlanLabel}>{metric.label}</span>
              <span className={classes.codexPlanValue}>{formatMetric(metric, i18n.language)}</span>
            </span>
          ))}
        </div>
      )}
      {quota.groups.map((group) => (
        <div key={group.id} className={classes.antigravityQuotaGroup}>
          {group.label && (
            <div className={classes.antigravityQuotaGroupHeader}>
              <span className={classes.antigravityQuotaGroupTitle}>{group.label}</span>
            </div>
          )}
          {group.buckets.map((bucket, index) => {
            const reset = buildResetDisplay(null, bucket.resetAtMs, now, i18n.language);
            return (
              <div key={bucket.id} className={classes.quotaRow}>
                <div className={classes.quotaRowHeader}>
                  <span className={classes.quotaModel} title={bucket.description}>
                    {bucket.label || t('plugin_quota.limit')}
                  </span>
                  <div className={classes.quotaMeta}>
                    <span className={classes.quotaPercent}>
                      {bucket.remainingPercent === null
                        ? t('plugin_quota.not_reported')
                        : t('plugin_quota.remaining_percent', { percent: bucket.remainingPercent })}
                    </span>
                    {reset && <QuotaResetLabel display={reset} classes={classes} soon={false} />}
                  </div>
                </div>
                <QuotaMeter percent={bucket.remainingPercent} classes={classes} index={index} />
              </div>
            );
          })}
        </div>
      ))}
    </>
  );
}
