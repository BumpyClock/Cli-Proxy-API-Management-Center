import { useId, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { IconChevronDown } from '@/components/ui/icons';
import type { OAuthConfigLoadError } from '@/features/authFiles/constants';
import { countOAuthRules } from '@/features/authFiles/logic';
import styles from './OAuthConfigPanels.module.scss';

type RuleSet = {
  error: OAuthConfigLoadError;
  rules: Record<string, readonly unknown[] | null | undefined>;
};

export type OAuthRulesSummaryProps = {
  excluded: RuleSet;
  aliases: RuleSet;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  /** The per-provider rule panels (list, diagram, edit and delete), shown when expanded. */
  children: ReactNode;
};

/**
 * One-line totals for the OAuth rule sections; the section tabs above already navigate to them.
 * The per-provider panels stay one disclosure away because the provider overview, the alias
 * diagram and provider deletion live only here.
 */
export function OAuthRulesSummary({
  excluded,
  aliases,
  expanded,
  onExpandedChange,
  children,
}: OAuthRulesSummaryProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const bodyId = useId();

  const describe = (set: RuleSet, ruleCountKey: string, upgradeKey: string) => {
    if (set.error === 'unsupported') return t(upgradeKey);
    if (set.error === 'load') return t('notification.refresh_failed');
    if (set.error === 'loading') return t('common.loading');
    const { providers, rules } = countOAuthRules(set.rules);
    if (providers === 0) return t('auth_files.oauth_rules_none');
    return `${t('auth_files.oauth_rules_providers', { count: providers })} · ${t(ruleCountKey, {
      count: rules,
    })}`;
  };

  const rows = [
    {
      key: 'excluded',
      label: t('redesign.authFiles.disablement'),
      summary: describe(
        excluded,
        'oauth_excluded.model_count',
        'oauth_excluded.upgrade_required_title'
      ),
    },
    {
      key: 'aliases',
      label: t('redesign.authFiles.aliases'),
      summary: describe(
        aliases,
        'oauth_model_alias.model_count',
        'oauth_model_alias.upgrade_required_title'
      ),
    },
  ];

  return (
    <>
      <section className={styles.summary} aria-labelledby={titleId}>
        <h2 id={titleId} className={styles.summaryTitle}>
          {t('auth_files.oauth_rules_title')}
        </h2>
        <dl className={styles.summaryList}>
          {rows.map((row) => (
            <div key={row.key} className={styles.summaryRow}>
              <dt className={styles.summaryLabel}>{row.label}</dt>
              <dd className={styles.summaryCount}>{row.summary}</dd>
            </div>
          ))}
        </dl>
        <button
          type="button"
          className={styles.summaryToggle}
          aria-expanded={expanded}
          aria-controls={expanded ? bodyId : undefined}
          onClick={() => onExpandedChange(!expanded)}
        >
          <span>{t(expanded ? 'auth_files.oauth_rules_hide' : 'auth_files.oauth_rules_show')}</span>
          <IconChevronDown className={styles.summaryChevron} size={14} aria-hidden="true" />
        </button>
      </section>
      {expanded && (
        <div id={bodyId} className={styles.summaryBody}>
          {children}
        </div>
      )}
    </>
  );
}
