import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useFloatingMenuPosition, UNPOSITIONED_MENU_STYLE } from '@/hooks/useFloatingMenuPosition';
import { Button } from '@/components/ui/Button';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { SelectionCheckbox } from '@/components/ui/SelectionCheckbox';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import {
  IconAlertTriangle,
  IconCheckCircle2,
  IconChevronDown,
  IconDownload,
  IconInfo,
  IconModelCluster,
  IconRefreshCw,
  IconSettings,
  IconTrash2,
  IconX,
} from '@/components/ui/icons';
import { ProviderStatusBar } from '@/components/providers/ProviderStatusBar';
import type { AuthFileItem } from '@/types';
import { statusBarDataFromRecentRequests } from '@/utils/recentRequests';
import { formatFileSize } from '@/utils/format';
import {
  getAuthFileStatusMessage,
  getModifiedTimeParts,
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
import { resolveAuthFileQuotaType, summarizeRequestActivity } from '@/features/authFiles/logic';
import type { AuthFileStatusBarData } from '@/features/authFiles/hooks/useAuthFilesStatusBarCache';
import { AuthFileQuotaSection } from '@/features/authFiles/components/AuthFileQuotaSection';
import { AuthFileCooldownSection } from './AuthFileCooldownSection';
import styles from './AuthFileCard.module.scss';
import { menuFocusTarget } from '@/utils/menuFocus';
import { iconSize } from '@/design-system';

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

/**
 * One comparison-table row per credential. Below 1100px the row becomes a compact card:
 * identity, exceptional status, the request summary, quota, the enable toggle and actions stay
 * visible; file metadata moves behind the Details disclosure.
 */
export function AuthFileCard(props: AuthFileCardProps) {
  const { t, i18n } = useTranslation();
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
  const modified = getModifiedTimeParts(file, i18n.language);
  const activity = summarizeRequestActivity(
    { success: successCount, failure: failureCount },
    statusData
  );
  const windowText = t(
    activity.kind === 'active' && activity.windowHasSignal
      ? 'redesign.authFiles.recentRate'
      : 'redesign.authFiles.recentNone',
    { minutes: activity.windowMinutes }
  );

  // The toggle already states enabled/disabled; a chip only marks states the toggle cannot show.
  const problem = isProblemAuthFile(file);
  const statusChipKey = file.disabled
    ? 'redesign.authFiles.disabled'
    : problem
      ? 'redesign.authFiles.problem'
      : null;
  const showWarning = Boolean(rawStatusMessage && hasStatusWarning);
  const cooldownRecords = file.cooldownSnapshot?.records;
  const hasCooldownContent =
    file.cooldownSnapshot !== undefined && (cooldownRecords === null || !!cooldownRecords?.length);
  const statusQuiet = !statusChipKey && !showWarning && !hasCooldownContent;
  // Cards print the switch state beside the switch, so a lone "Disabled" chip would repeat it.
  const statusRepeatsSwitch =
    !isRuntimeOnly && file.disabled === true && !showWarning && !hasCooldownContent;

  const detailsBaseId = useId();
  const updatedDetailId = `${detailsBaseId}-updated`;
  const actionsMenuId = `${detailsBaseId}-actions`;
  const [detailsOpen, setDetailsOpen] = useState(false);

  // A long warning is clamped in the desktop table; a visible toggle reveals the rest, so the
  // full message never depends on hovering the title.
  const warningId = `${detailsBaseId}-warning`;
  const warningTextRef = useRef<HTMLSpanElement>(null);
  const [warningExpanded, setWarningExpanded] = useState(false);
  const [warningClamped, setWarningClamped] = useState(false);
  useLayoutEffect(() => {
    const text = warningTextRef.current;
    if (!text || warningExpanded) return;
    const measure = () => setWarningClamped(text.scrollHeight > text.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(text);
    return () => observer.disconnect();
  }, [rawStatusMessage, showWarning, warningExpanded]);

  const [actionsOpen, setActionsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // Which item receives focus when the menu opens: first for click/Enter/ArrowDown, last for ArrowUp.
  const openFocusRef = useRef<'first' | 'last'>('first');
  const pendingFocusRef = useRef(false);
  const menuStyle = useFloatingMenuPosition(actionsOpen, triggerRef, menuRef);

  const menuItems = () =>
    Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? []
    );
  const openActions = (focus: 'first' | 'last') => {
    openFocusRef.current = focus;
    pendingFocusRef.current = true;
    setActionsOpen(true);
  };
  const closeActions = (restoreFocus: boolean) => {
    setActionsOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!menuStyle || !pendingFocusRef.current) return;
    pendingFocusRef.current = false;
    const items = menuItems();
    (openFocusRef.current === 'last' ? items[items.length - 1] : items[0])?.focus();
  }, [menuStyle]);

  useEffect(() => {
    if (!actionsOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setActionsOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [actionsOpen]);

  const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      openActions(event.key === 'ArrowUp' ? 'last' : 'first');
    }
  };
  const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeActions(true);
      return;
    }
    if (event.key === 'Tab') {
      closeActions(true);
      return;
    }
    const items = menuItems();
    const target = menuFocusTarget(
      event.key,
      items.indexOf(document.activeElement as HTMLButtonElement),
      items.length
    );
    if (target === null) return;
    event.preventDefault();
    items[target]?.focus();
  };
  // Close the menu once an action runs and return focus to its trigger, so dialogs opened by
  // the action restore focus to a visible control. Disabled buttons do not dispatch clicks.
  const handleActionsClick = (event: MouseEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest('button')) closeActions(true);
  };

  const actionsMenu = (
    <div
      ref={menuRef}
      id={actionsMenuId}
      className={styles.actions}
      role="menu"
      aria-label={t('redesign.authFiles.actionsFor', { name: identity.primary })}
      hidden={!actionsOpen}
      style={menuStyle ?? UNPOSITIONED_MENU_STYLE}
      onClick={handleActionsClick}
      onKeyDown={handleMenuKeyDown}
    >
      {showModelsButton && (
        <Button
          variant="ghost"
          role="menuitem"
          tabIndex={-1}
          onClick={() => onShowModels(file)}
          disabled={disableControls}
        >
          <IconModelCluster size={iconSize['15']} />
          {t('auth_files.models_button')}
        </Button>
      )}
      {!isRuntimeOnly && showManualRefreshButton && (
        <Button
          variant="ghost"
          role="menuitem"
          tabIndex={-1}
          onClick={() => onManualRefresh(file)}
          disabled={
            disableControls ||
            file.disabled ||
            statusUpdating[file.name] === true ||
            isManualRefreshing
          }
        >
          {isManualRefreshing ? (
            <LoadingSpinner size={iconSize['14']} />
          ) : (
            <IconRefreshCw size={iconSize['15']} />
          )}
          {t('auth_files.manual_refresh_button')}
        </Button>
      )}
      {!isRuntimeOnly && (
        <>
          <Button
            variant="ghost"
            role="menuitem"
            tabIndex={-1}
            onClick={() => onDownload(file.name)}
            disabled={disableControls}
          >
            <IconDownload size={iconSize['15']} />
            {t('auth_files.download_button')}
          </Button>
          <Button
            variant="ghost"
            role="menuitem"
            tabIndex={-1}
            onClick={() => onOpenPrefixProxyEditor(file)}
            disabled={disableControls || isManualRefreshing}
          >
            <IconSettings size={iconSize['15']} />
            {t('auth_files.prefix_proxy_button')}
          </Button>
          <span className={styles.menuSeparator} role="separator" />
          <Button
            variant="ghost"
            role="menuitem"
            tabIndex={-1}
            className={styles.menuDanger}
            onClick={() => onDelete(file.name)}
            disabled={disableControls || deleting === file.name || isManualRefreshing}
          >
            {deleting === file.name ? (
              <LoadingSpinner size={iconSize['14']} />
            ) : (
              <IconTrash2 size={iconSize['15']} />
            )}
            {t('auth_files.delete_button')}
          </Button>
        </>
      )}
    </div>
  );

  const requestSummary =
    activity.kind === 'idle' ? (
      <span className={styles.requestsIdle} title={windowText}>
        <span aria-hidden="true">{t('redesign.authFiles.requestsNone')}</span>
        <span className={styles.srOnly}>{windowText}</span>
      </span>
    ) : (
      <span
        className={styles.requestsFigure}
        title={t('redesign.authFiles.requestsTotal', {
          success: activity.success,
          failure: activity.failure,
        })}
      >
        <span>{t('redesign.authFiles.requestsOk', { count: activity.success })}</span>
        <span className={styles.requestsSep} aria-hidden="true">
          ·
        </span>
        <span className={activity.failure > 0 ? styles.countFailLive : undefined}>
          {t('redesign.authFiles.requestsFailed', { count: activity.failure })}
        </span>
      </span>
    );

  return (
    <tr
      className={[
        styles.row,
        compact ? styles.rowCompact : '',
        selected ? styles.rowSelected : '',
        detailsOpen ? styles.rowExpanded : '',
      ]
        .filter(Boolean)
        .join(' ')}
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
        <h3 className={styles.identity}>
          <span
            className={`${styles.account} ${identity.kind === 'fileName' ? styles.accountMono : ''}`}
            title={identity.primary}
          >
            {identity.primary}
          </span>
          <span className={styles.srOnly}>, {typeLabel}</span>
        </h3>
        <p className={styles.subline}>
          <span
            className={styles.providerBadge}
            aria-hidden="true"
            style={{
              backgroundColor: typeColor.bg,
              color: typeColor.text,
              ...(typeColor.border ? { border: typeColor.border } : {}),
            }}
          >
            {typeLabel}
          </span>
          {isRuntimeOnly && (
            <span className={styles.runtimeLabel}>{t('auth_files.type_virtual')}</span>
          )}
          {identity.secondary && (
            <span className={styles.fileName} title={identity.fullName}>
              {identity.secondary}
            </span>
          )}
        </p>

        {!compact && noteValue && (
          <p className={styles.note} title={noteValue}>
            {noteValue}
          </p>
        )}
      </td>
      <td
        className={
          statusQuiet
            ? styles.statusQuiet
            : statusRepeatsSwitch
              ? styles.statusRepeatsSwitch
              : undefined
        }
        data-label={t('common.status')}
      >
        {statusChipKey ? (
          <span
            className={`${styles.state} ${file.disabled ? styles.stateDisabled : styles.stateProblem}`}
          >
            {file.disabled ? (
              <IconX size={iconSize['13']} />
            ) : (
              <IconAlertTriangle size={iconSize['13']} />
            )}
            {t(statusChipKey)}
          </span>
        ) : (
          <span className={styles.stateQuiet}>
            <IconCheckCircle2 size={iconSize['14']} className={styles.stateQuietIcon} />
            {t('redesign.authFiles.status_ok')}
          </span>
        )}
        {showWarning && (
          <div className={styles.warning} title={rawStatusMessage}>
            <IconInfo className={styles.warningIcon} size={iconSize['14']} />
            <span
              ref={warningTextRef}
              id={warningId}
              className={warningExpanded ? styles.warningFull : undefined}
            >
              {rawStatusMessage}
            </span>
          </div>
        )}
        {showWarning && (warningClamped || warningExpanded) && (
          <button
            type="button"
            className={styles.warningToggle}
            aria-expanded={warningExpanded}
            aria-controls={warningId}
            onClick={() => setWarningExpanded((open) => !open)}
          >
            {t(warningExpanded ? 'auth_files.warning_show_less' : 'auth_files.warning_show_more')}
          </button>
        )}

        <AuthFileCooldownSection snapshot={file.cooldownSnapshot} />
        {/* Cards keep freshness visible; the desktop table has its own Updated column. */}
        {modified && (
          <p className={styles.cardUpdated}>
            {t('redesign.authFiles.updated')}{' '}
            <time dateTime={modified.iso} title={modified.iso}>
              {modified.label}
            </time>
          </p>
        )}
      </td>
      <td className={styles.requestsCell} data-label={t('auth_files.card_requests')}>
        <div className={styles.health}>
          {requestSummary}
          {activity.kind === 'active' && activity.windowHasSignal && (
            <div className={styles.recent} title={windowText}>
              <ProviderStatusBar statusData={statusData} styles={styles} />
              <span className={styles.srOnly}>{windowText}</span>
            </div>
          )}
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
          <span className={`${styles.unreported} ${styles.quotaUnreported}`}>
            {t('redesign.authFiles.notReported')}
          </span>
        )}
      </td>
      <td className={styles.detailCell} data-label={t('redesign.authFiles.updated')}>
        <div id={updatedDetailId} className={styles.metaRow}>
          {modified ? (
            <time className={styles.modified} dateTime={modified.iso} title={modified.iso}>
              {modified.label}
            </time>
          ) : (
            <span className={styles.unreported}>{t('redesign.authFiles.notReported')}</span>
          )}
          {file.size ? (
            <span className={styles.metaMetric}>
              <span className={styles.metaMetricLabel}>{t('auth_files.file_size')}</span>
              <span>{formatFileSize(file.size)}</span>
            </span>
          ) : null}
          {priorityValue !== undefined && (
            <span className={styles.metaMetric} title={t('auth_files.priority_hint')}>
              <span className={styles.metaMetricLabel}>{t('auth_files.priority_display')}</span>
              <span>{priorityValue}</span>
            </span>
          )}
          {weightValue !== undefined && (
            <span className={styles.metaMetric} title={t('auth_files.weight_tooltip')}>
              <span className={styles.metaMetricLabel}>{t('auth_files.weight_display')}</span>
              <span>{weightValue}</span>
            </span>
          )}
        </div>
      </td>
      <td data-label={t('auth_files.status_toggle_label')}>
        {!isRuntimeOnly && (
          <div className={styles.toggleWithState}>
            {/* Cards drop the "Enabled" column header, so phones show the switch state in words.
                The switch itself announces its state, so the word is hidden from assistive tech. */}
            <span className={styles.toggleState} aria-hidden="true">
              {t(file.disabled ? 'redesign.authFiles.disabled' : 'redesign.authFiles.enabled')}
            </span>
            <ToggleSwitch
              ariaLabel={t('auth_files.card_toggle', { name: file.name })}
              checked={!file.disabled}
              disabled={disableControls || statusUpdating[file.name] === true || isManualRefreshing}
              onChange={(value) => onToggleStatus(file, value)}
            />
          </div>
        )}
      </td>
      <td className={styles.actionsCell} data-label={t('redesign.authFiles.actions')}>
        <div className={styles.rowActions}>
          <button
            ref={triggerRef}
            type="button"
            className={styles.actionsTrigger}
            aria-haspopup="menu"
            aria-expanded={actionsOpen}
            aria-controls={actionsOpen ? actionsMenuId : undefined}
            aria-label={t('redesign.authFiles.actionsFor', { name: identity.primary })}
            onClick={() => (actionsOpen ? closeActions(false) : openActions('first'))}
            onKeyDown={handleTriggerKeyDown}
          >
            <span>{t('redesign.authFiles.actions')}</span>
            <IconChevronDown className={styles.disclosureChevron} size={iconSize['14']} />
          </button>
          {actionsOpen && typeof document !== 'undefined'
            ? createPortal(actionsMenu, document.body)
            : actionsMenu}
        </div>
        <button
          type="button"
          className={styles.detailsToggle}
          aria-expanded={detailsOpen}
          aria-controls={updatedDetailId}
          aria-label={t('redesign.authFiles.detailsFor', { name: identity.primary })}
          onClick={() => setDetailsOpen((open) => !open)}
        >
          <span>{t('redesign.authFiles.details')}</span>
          <IconChevronDown className={styles.disclosureChevron} size={iconSize['14']} />
        </button>
      </td>
    </tr>
  );
}
