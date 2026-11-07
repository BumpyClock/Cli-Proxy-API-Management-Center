import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/Table';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { ProviderStatusBar } from '@/components/providers/ProviderStatusBar';
import {
  getOpenAIProviderRecentStatusData,
  getOpenAIProviderTotalStats,
  getProviderRecentStatusData,
  getProviderTotalStats,
  getProviderUsageKey,
  type ProviderRecentUsageMap,
} from '@/components/providers/utils';
import type { OpenAIProviderConfig } from '@/types';
import type { StatusBarData } from '@/utils/recentRequests';
import type { ProviderResource } from '../types';
import { isMultiProtocolSponsorBrand } from '../sponsorDefinitions';
import {
  getProviderHealth,
  getResourceActionName,
  PROVIDER_TABLE_COLUMN_WIDTHS,
  type ProviderHealth,
} from '../workbenchLayout';
import { ProviderRowActions } from './ProviderRowActions';
import styles from './ProviderResourceTable.module.scss';
import statusBarStyles from './providerStatusBar.module.scss';

interface ProviderResourceTableProps {
  resources: ProviderResource[];
  selectedId?: string | null;
  disableMutations?: boolean;
  usageByProvider?: ProviderRecentUsageMap;
  onView: (resource: ProviderResource) => void;
  onEdit: (resource: ProviderResource) => void;
  onDelete: (resource: ProviderResource) => void;
  onToggleDisabled?: (resource: ProviderResource, disabled: boolean) => void;
}

/** Backend success/failed totals, reported separately from the per-bucket history. */
const resolveTotalStats = (
  resource: ProviderResource,
  usageByProvider: ProviderRecentUsageMap
): { success: number; failure: number } => {
  if (resource.brand === 'openaiCompatibility') {
    return getOpenAIProviderTotalStats(resource.raw as OpenAIProviderConfig, usageByProvider);
  }
  return getProviderTotalStats(
    usageByProvider,
    getProviderUsageKey(resource.brand),
    resource.apiKey ?? undefined,
    resource.baseUrl ?? undefined
  );
};

const HEALTH_LABEL_KEYS: Record<ProviderHealth, string> = {
  active: 'providersPage.status.active',
  disabled: 'providersPage.status.disabled',
  failing: 'providersPage.status.failing',
};

const HEALTH_CLASS: Record<ProviderHealth, string> = {
  active: styles.healthActive,
  disabled: styles.healthDisabled,
  failing: styles.healthFailing,
};

const isSponsorResource = (resource: ProviderResource): boolean =>
  isMultiProtocolSponsorBrand(resource.brand);

const resolveStatusBarData = (
  resource: ProviderResource,
  usageByProvider: ProviderRecentUsageMap
): StatusBarData => {
  if (resource.brand === 'openaiCompatibility') {
    return getOpenAIProviderRecentStatusData(resource.raw as OpenAIProviderConfig, usageByProvider);
  }
  return getProviderRecentStatusData(
    usageByProvider,
    getProviderUsageKey(resource.brand),
    resource.apiKey ?? undefined,
    resource.baseUrl ?? undefined
  );
};

export function ProviderResourceTable({
  resources,
  selectedId,
  disableMutations,
  usageByProvider,
  onView,
  onEdit,
  onDelete,
  onToggleDisabled,
}: ProviderResourceTableProps) {
  const { t } = useTranslation();

  const renderMetric = (key: string, label: string, value: number) => (
    <span key={key} className={styles.metric}>
      <span className={styles.metricLabel}>{label}</span>
      <span className={styles.metricValue}>{value}</span>
    </span>
  );

  const renderFlagTag = (key: string, label: string) => (
    <span key={key} className={styles.flagTag} title={label}>
      {label}
    </span>
  );

  const renderProtocolSummary = (r: ProviderResource) =>
    (r.flags.protocols ?? [])
      .map((protocol) => t(`providersPage.sponsor.protocols.${protocol}`))
      .join(' / ');

  const renderModelsSummary = (r: ProviderResource) => {
    const items: ReactNode[] = [];
    if (isSponsorResource(r)) {
      (r.flags.protocols ?? []).forEach((protocol) => {
        items.push(renderFlagTag(protocol, t(`providersPage.sponsor.protocols.${protocol}`)));
      });
      return <div className={styles.metricsCell}>{items}</div>;
    }
    if (r.brand === 'openaiCompatibility') {
      items.push(
        renderMetric('models', t('providersPage.table.metrics.models'), r.modelCount),
        renderMetric('keys', t('providersPage.table.metrics.keys'), r.apiKeyEntryCount),
        renderMetric('headers', t('providersPage.table.metrics.headers'), r.headerCount)
      );
    } else {
      items.push(
        renderMetric('models', t('providersPage.table.metrics.models'), r.modelCount),
        renderMetric('headers', t('providersPage.table.metrics.headers'), r.headerCount)
      );
      if ((r.brand === 'codex' || r.brand === 'xai') && r.flags.websockets) {
        items.push(renderFlagTag('ws', t('providersPage.table.websocketsTag')));
      }
      if (r.brand === 'claude' && r.flags.cloakEnabled) {
        items.push(renderFlagTag('cloak', t('providersPage.table.cloakTag')));
      }
      if (r.brand === 'claude' && r.flags.claudeCodeCliProfile) {
        items.push(renderFlagTag('cli-profile', t('providersPage.table.cliProfileTag')));
      }
    }
    return <div className={styles.metricsCell}>{items}</div>;
  };

  /**
   * Status reads as three aligned parts: the Enabled switch (control), one health word, then a
   * compact recent-request figure. The per-bucket bar only appears once there are requests.
   */
  const renderStatus = (r: ProviderResource) => {
    const name = getResourceActionName(r);
    const toggleLabel = r.disabled
      ? t('redesign.providers.rowEnable', { name })
      : t('redesign.providers.rowDisable', { name });
    const tracked = usageByProvider && !isSponsorResource(r) ? usageByProvider : null;
    const statusData = tracked ? resolveStatusBarData(r, tracked) : null;
    // Health and the bar read the bucketed window; the figure keeps the backend totals, which
    // may cover more than the buckets, so a key with traffic never reads "No recent requests".
    const recent = statusData
      ? { success: statusData.totalSuccess, failure: statusData.totalFailure }
      : null;
    const totals = tracked ? resolveTotalStats(r, tracked) : null;
    const health = getProviderHealth(r.disabled, recent);
    const hasBuckets = recent !== null && recent.success + recent.failure > 0;
    const hasTotals = totals !== null && totals.success + totals.failure > 0;
    return (
      <div className={styles.statusCell}>
        <div className={styles.statusLine}>
          {onToggleDisabled ? (
            <span
              className={styles.toggleWrap}
              title={toggleLabel}
              onClick={(e) => e.stopPropagation()}
            >
              <ToggleSwitch
                checked={!r.disabled}
                disabled={disableMutations}
                onChange={(value) => onToggleDisabled(r, !value)}
                ariaLabel={toggleLabel}
              />
            </span>
          ) : null}
          <span className={`${styles.health} ${HEALTH_CLASS[health]}`} data-health={health}>
            <span className={styles.healthDot} aria-hidden="true" />
            <span className={styles.statusText}>{t(HEALTH_LABEL_KEYS[health])}</span>
          </span>
        </div>
        {totals ? (
          <div className={styles.requests}>
            <span className={styles.requestFigure}>
              {hasTotals
                ? t('providersPage.table.requestSummary', {
                    success: totals.success,
                    failure: totals.failure,
                  })
                : hasBuckets && recent
                  ? t('providersPage.table.requestSummary', {
                      success: recent.success,
                      failure: recent.failure,
                    })
                  : t('providersPage.table.noRecentRequests')}
            </span>
            {hasBuckets && statusData ? (
              <div className={styles.statusBarWrap}>
                <ProviderStatusBar statusData={statusData} styles={statusBarStyles} />
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  };

  const renderPrimary = (r: ProviderResource) => {
    if (isSponsorResource(r)) {
      return (
        <div className={styles.primaryCell}>
          <span className={styles.primaryName} title={r.name ?? r.identifier ?? undefined}>
            {r.name ?? r.identifier}
          </span>
          <span className={styles.primarySub}>
            {r.apiKeyPreview ?? t('providersPage.status.notConfigured')}
          </span>
        </div>
      );
    }
    if (r.brand === 'openaiCompatibility') {
      const extra = r.apiKeyEntryCount > 1 ? ` · +${r.apiKeyEntryCount - 1}` : '';
      return (
        <div className={styles.primaryCell}>
          <span className={styles.primaryName} title={r.name ?? r.identifier ?? undefined}>
            {r.name ?? r.identifier}
          </span>
          <span className={styles.primarySub}>{(r.apiKeyPreview ?? '—') + extra}</span>
        </div>
      );
    }
    return (
      <div className={styles.primaryCell}>
        <span className={styles.primaryName}>{r.apiKeyPreview ?? '—'}</span>
        {r.authIndex ? <span className={styles.primarySub}>auth: {r.authIndex}</span> : null}
      </div>
    );
  };

  const renderBaseUrl = (r: ProviderResource) => {
    const value = isSponsorResource(r)
      ? renderProtocolSummary(r)
      : r.brand === 'claude' && !r.baseUrl
        ? `https://api.anthropic.com ${t('providersPage.status.defaultSuffix')}`
        : (r.baseUrl ?? t('providersPage.status.notSet'));
    return (
      <span className={styles.baseUrl} title={value}>
        {value}
      </span>
    );
  };

  return (
    <Table
      className={styles.providerTable}
      cols={PROVIDER_TABLE_COLUMN_WIDTHS.map((width, i) => (
        <col key={i} style={width === null ? undefined : { width: `${width}px` }} />
      ))}
    >
      <TableHeader>
        <TableRow>
          <TableHead>{t('providersPage.table.key')}</TableHead>
          <TableHead>{t('providersPage.table.baseUrl')}</TableHead>
          <TableHead>{t('providersPage.table.prefix')}</TableHead>
          <TableHead>{t('providersPage.table.models')}</TableHead>
          <TableHead>{t('providersPage.table.status')}</TableHead>
          <TableHead alignRight className={styles.actionsHead}>
            {t('providersPage.table.actions')}
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {resources.map((resource) => (
          <TableRow key={resource.id} selected={resource.id === selectedId}>
            <TableCell data-label={t('providersPage.table.key')}>
              {renderPrimary(resource)}
            </TableCell>
            <TableCell data-label={t('providersPage.table.baseUrl')}>
              {renderBaseUrl(resource)}
            </TableCell>
            <TableCell data-label={t('providersPage.table.prefix')}>
              {resource.prefix ? (
                <span className={styles.chip} title={resource.prefix}>
                  {resource.prefix}
                </span>
              ) : (
                <span className={styles.baseUrl}>{t('providersPage.status.none')}</span>
              )}
            </TableCell>
            <TableCell data-label={t('providersPage.table.models')}>
              {renderModelsSummary(resource)}
            </TableCell>
            <TableCell data-label={t('providersPage.table.status')}>
              {renderStatus(resource)}
            </TableCell>
            <TableCell
              alignRight
              className={[
                styles.actionsCell,
                resource.id === selectedId ? styles.actionsCellSelected : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <ProviderRowActions
                name={getResourceActionName(resource)}
                disableMutations={disableMutations}
                onView={() => onView(resource)}
                onEdit={() => onEdit(resource)}
                onDelete={() => onDelete(resource)}
              />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
