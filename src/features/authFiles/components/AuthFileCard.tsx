import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { SelectionCheckbox } from '@/components/ui/SelectionCheckbox';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import {
  IconDownload,
  IconInfo,
  IconModelCluster,
  IconRefreshCw,
  IconSettings,
  IconTrash2,
} from '@/components/ui/icons';
import { ProviderStatusBar } from '@/components/providers/ProviderStatusBar';
import type { AuthFileItem } from '@/types';
import { statusBarDataFromRecentRequests } from '@/utils/recentRequests';
import { formatFileSize } from '@/utils/format';
import {
  formatModified,
  getAuthFileStatusMessage,
  hasAuthFileStatusWarning,
  isProblemAuthFile,
  getTypeColor,
  getTypeLabel,
  isRuntimeOnlyAuthFile,
  normalizeProviderKey,
  supportsAuthFileManualRefresh,
  type AuthFileQuotaFilter,
  type ResolvedTheme,
} from '@/features/authFiles/constants';
import { deriveAuthFileIdentity } from '@/features/authFiles/identity';
import { resolveAuthFileQuotaType } from '@/features/authFiles/logic';
import type { AuthFileStatusBarData } from '@/features/authFiles/hooks/useAuthFilesStatusBarCache';
import { AuthFileQuotaSection } from '@/features/authFiles/components/AuthFileQuotaSection';
import { AuthFileCooldownSection } from './AuthFileCooldownSection';
import styles from './AuthFileCard.module.scss';

export type AuthFileCardProps = {
  file: AuthFileItem;
  compact: boolean;
  selected: boolean;
  resolvedTheme: ResolvedTheme;
  disableControls: boolean;
  deleting: string | null;
  statusUpdating: Record<string, boolean>;
  manualRefreshing: Record<string, boolean>;
  quotaFilterType: AuthFileQuotaFilter;
  statusBarCache: Map<string, AuthFileStatusBarData>;
  onShowModels: (file: AuthFileItem) => void;
  onDownload: (name: string) => void;
  onManualRefresh: (file: AuthFileItem) => void;
  onOpenPrefixProxyEditor: (file: AuthFileItem) => void;
  onDelete: (name: string) => void;
  onToggleStatus: (file: AuthFileItem, enabled: boolean) => void;
  onToggleSelect: (name: string) => void;
};

// Kept as the existing presentation owner; each credential now renders one comparison-table row.
export function AuthFileCard(props: AuthFileCardProps) {
  const { t } = useTranslation();
  const {
    file,
    compact,
    selected,
    resolvedTheme,
    disableControls,
    deleting,
    statusUpdating,
    manualRefreshing,
    quotaFilterType,
    statusBarCache,
    onShowModels,
    onDownload,
    onManualRefresh,
    onOpenPrefixProxyEditor,
    onDelete,
    onToggleStatus,
    onToggleSelect,
  } = props;

  const isRuntimeOnly = isRuntimeOnlyAuthFile(file);
  const providerKey = normalizeProviderKey(String(file.type ?? file.provider ?? 'unknown'));
  const isAistudio = providerKey === 'aistudio';
  const showModelsButton = !isRuntimeOnly || isAistudio;
  const showManualRefreshButton = !isRuntimeOnly && supportsAuthFileManualRefresh(providerKey);
  const isManualRefreshing = manualRefreshing[file.name] === true;
  const typeLabel = getTypeLabel(t, providerKey);
  const typeColor = getTypeColor(providerKey, resolvedTheme);

  const quotaType = resolveAuthFileQuotaType(file, quotaFilterType);
  const showQuotaLayout = Boolean(quotaType) && !isRuntimeOnly;

  const successCount = file.successCount ?? 0;
  const failureCount = file.failureCount ?? 0;
  const authIndexKey = typeof file.authIndex === 'string' ? file.authIndex : null;
  const statusData =
    (authIndexKey && statusBarCache.get(authIndexKey)) ||
    statusBarDataFromRecentRequests(file.recentRequests ?? []);

  const rawStatusMessage = getAuthFileStatusMessage(file);
  const hasStatusWarning = hasAuthFileStatusWarning(file);

  const priorityValue = Number.isSafeInteger(file.priority) ? file.priority : undefined;
  const weightValue = Number.isSafeInteger(file.weight) ? file.weight : undefined;
  const noteValue = typeof file.note === 'string' ? file.note.trim() : '';
  // 主行显示账号（email/项目 ID），文件名降为满卡宽的 mono 副行
  const identity = deriveAuthFileIdentity(file);

  return (
    <tr
      className={`${styles.row} ${compact ? styles.rowCompact : ''} ${selected ? styles.rowSelected : ''}`}
    >
      <td className={styles.selectCell} data-label={t('redesign.authFiles.select')}>
        {!isRuntimeOnly && (
          <SelectionCheckbox
            checked={selected}
            onChange={() => onToggleSelect(file.name)}
            ariaLabel={t('auth_files.card_select', { name: file.name })}
            title={t('auth_files.card_select', { name: file.name })}
          />
        )}
      </td>
      <td data-label={t('redesign.authFiles.credential')}>
        <header className={styles.head}>
          <h3 className={styles.identity}>
            <span
              className={styles.providerBadge}
              style={{
                backgroundColor: typeColor.bg,
                color: typeColor.text,
                ...(typeColor.border ? { border: typeColor.border } : {}),
              }}
            >
              {typeLabel}
            </span>
            <span
              className={`${styles.account} ${identity.kind === 'fileName' ? styles.accountMono : ''}`}
              title={identity.primary}
            >
              {identity.primary}
            </span>
          </h3>
          {isRuntimeOnly && (
            <span className={styles.runtimeLabel}>{t('auth_files.type_virtual')}</span>
          )}
        </header>

        {identity.secondary && (
          <p className={styles.fileName} title={identity.fullName}>
            {identity.secondary}
          </p>
        )}

        {!compact && noteValue && (
          <p className={styles.note} title={noteValue}>
            {noteValue}
          </p>
        )}
      </td>
      <td data-label={t('common.status')}>
        <span className={`${styles.state} ${isProblemAuthFile(file) ? styles.stateProblem : ''}`}>
          {t(
            file.disabled
              ? 'redesign.authFiles.disabled'
              : isProblemAuthFile(file)
                ? 'redesign.authFiles.problem'
                : 'redesign.authFiles.enabled'
          )}
        </span>
        {rawStatusMessage && hasStatusWarning && (
          <div className={styles.warning} title={rawStatusMessage}>
            <IconInfo className={styles.warningIcon} size={14} />
            <span>{rawStatusMessage}</span>
          </div>
        )}

        <AuthFileCooldownSection snapshot={file.cooldownSnapshot} />
      </td>
      <td data-label={t('auth_files.card_requests')}>
        <div className={styles.health}>
          <div className={styles.healthHead}>
            <span className={styles.healthLabel}>{t('auth_files.card_requests')}</span>
            <span className={styles.healthCounts}>
              <span
                className={`${styles.countOk} ${successCount > 0 ? styles.countLive : ''}`}
                title={t('stats.success')}
              >
                {t('stats.success')} {successCount}
              </span>
              <span
                className={`${styles.countFail} ${failureCount > 0 ? styles.countLive : ''}`}
                title={t('stats.failure')}
              >
                {t('stats.failure')} {failureCount}
              </span>
            </span>
          </div>
          <ProviderStatusBar statusData={statusData} styles={styles} />
        </div>
      </td>
      <td data-label={t('redesign.authFiles.quota')}>
        {showQuotaLayout && quotaType ? (
          <AuthFileQuotaSection
            file={file}
            quotaType={quotaType}
            disableControls={disableControls}
            compact
          />
        ) : (
          <span className={styles.unreported}>{t('redesign.authFiles.notReported')}</span>
        )}
      </td>
      <td data-label={t('redesign.authFiles.updated')}>
        <div className={styles.metaRow}>
          <span title={t('auth_files.file_size')}>
            {file.size ? formatFileSize(file.size) : '-'}
          </span>
          <span className={styles.metaDivider} aria-hidden="true">
            ·
          </span>
          <span title={t('auth_files.file_modified')}>{formatModified(file)}</span>
          {priorityValue !== undefined && (
            <>
              <span className={styles.metaDivider} aria-hidden="true">
                ·
              </span>
              <span className={styles.metaPriority} title={t('auth_files.priority_hint')}>
                <span className={styles.metaMetricLabel}>{t('auth_files.priority_display')}</span>
                <span>{priorityValue}</span>
              </span>
            </>
          )}
          {weightValue !== undefined && (
            <>
              <span className={styles.metaDivider} aria-hidden="true">
                ·
              </span>
              <span className={styles.metaWeight} title={t('auth_files.weight_tooltip')}>
                <span className={styles.metaMetricLabel}>{t('auth_files.weight_display')}</span>
                <span>{weightValue}</span>
              </span>
            </>
          )}
        </div>
      </td>
      <td data-label={t('auth_files.status_toggle_label')}>
        {!isRuntimeOnly && (
          <ToggleSwitch
            ariaLabel={t('auth_files.card_toggle', { name: file.name })}
            checked={!file.disabled}
            disabled={disableControls || statusUpdating[file.name] === true || isManualRefreshing}
            onChange={(value) => onToggleStatus(file, value)}
          />
        )}
      </td>
      <td data-label={t('redesign.authFiles.actions')}>
        <details className={styles.rowActions}>
          <summary aria-label={t('redesign.authFiles.actionsFor', { name: identity.primary })}>
            {t('redesign.authFiles.actions')}
          </summary>
          <footer className={styles.actions}>
            <div className={styles.actionsMain}>
              {showModelsButton && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => onShowModels(file)}
                  title={t('auth_files.models_button')}
                  disabled={disableControls}
                >
                  <IconModelCluster size={14} />
                  {t('auth_files.models_button')}
                </Button>
              )}
              {!isRuntimeOnly && (
                <div className={styles.utilityActions}>
                  {showManualRefreshButton && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => onManualRefresh(file)}
                      className={styles.iconButton}
                      title={t('auth_files.manual_refresh_button')}
                      disabled={
                        disableControls ||
                        file.disabled ||
                        statusUpdating[file.name] === true ||
                        isManualRefreshing
                      }
                    >
                      {isManualRefreshing ? (
                        <LoadingSpinner size={14} />
                      ) : (
                        <IconRefreshCw size={15} />
                      )}
                      {t('auth_files.manual_refresh_button')}
                    </Button>
                  )}
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => onDownload(file.name)}
                    className={styles.iconButton}
                    title={t('auth_files.download_button')}
                    disabled={disableControls}
                  >
                    <IconDownload size={15} />
                    {t('auth_files.download_button')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => onOpenPrefixProxyEditor(file)}
                    className={styles.iconButton}
                    title={t('auth_files.prefix_proxy_button')}
                    disabled={disableControls || isManualRefreshing}
                  >
                    <IconSettings size={15} />
                    {t('auth_files.prefix_proxy_button')}
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => onDelete(file.name)}
                    className={styles.iconButton}
                    title={t('auth_files.delete_button')}
                    disabled={disableControls || deleting === file.name || isManualRefreshing}
                  >
                    {deleting === file.name ? (
                      <LoadingSpinner size={14} />
                    ) : (
                      <IconTrash2 size={15} />
                    )}
                    {t('auth_files.delete_button')}
                  </Button>
                </div>
              )}
            </div>
          </footer>
        </details>
      </td>
    </tr>
  );
}
