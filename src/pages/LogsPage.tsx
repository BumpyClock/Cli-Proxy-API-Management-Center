import { PageHeader } from '@/components/ui/PageHeader';
import { useDeferredValue, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  RefObject,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { RefreshButton } from '@/components/ui/RefreshButton';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { lockScroll, unlockScroll } from '@/components/ui/scrollLock';
import {
  IconCheck,
  IconChevronDown,
  IconDownload,
  IconEye,
  IconMaximize2,
  IconMinimize2,
  IconSearch,
  IconSlidersHorizontal,
  IconTimer,
  IconTrash2,
  IconX,
} from '@/components/ui/icons';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { useAuthStore, useConfigStore, useNotificationStore } from '@/stores';
import { logsApi, type ErrorLogFile, type LogsQuery } from '@/services/api/logs';
import { copyToClipboard } from '@/utils/clipboard';
import { getErrorMessage } from '@/utils/helpers';
import { downloadBlob } from '@/utils/download';
import { MANAGEMENT_API_PREFIX } from '@/utils/constants';
import { formatUnixTimestamp } from '@/utils/format';
import { resolveTimeZoneLabel } from '@/utils/time/timezone';
import {
  HTTP_METHODS,
  STATUS_GROUPS,
  resolveStatusGroup,
  type HttpMethod,
  type LogState,
  type StatusGroup,
} from './hooks/logTypes';
import { buildLogGrid, resolveStructuredColumns } from './hooks/logColumns';
import { createLogTimeFormatter } from './hooks/logFormat';
import { parseLogLine } from './hooks/logParsing';
import { createLogRequestGuard, createLogRequestQueue } from './hooks/logRequests';
import { errorLogViewerReducer } from './hooks/errorLogViewer';
import { useLogFilters } from './hooks/useLogFilters';
import { isNearBottom, useLogScroller } from './hooks/useLogScroller';
import { LogRowCells } from './LogRowCells';
import styles from './LogsPage.module.scss';
import { iconSize, size } from '@/design-system';

// 初始只渲染最近 100 行，滚动到顶部再逐步加载更多（避免一次性渲染过多导致卡顿）
const INITIAL_DISPLAY_LINES = 100;
const MAX_BUFFER_LINES = 10000;
const LONG_PRESS_MS = 650;
const LONG_PRESS_MOVE_THRESHOLD = 10;

type LogPosition = Pick<LogsQuery, 'after' | 'cursor'>;

const getIncrementalAfter = (after: LogsQuery['after']): LogsQuery['after'] => {
  if (typeof after !== 'number') return after;
  return after > 1 ? after - 1 : undefined;
};

const buildLogsQuery = (incremental: boolean, position: LogPosition): LogsQuery => {
  const params: LogsQuery = { limit: MAX_BUFFER_LINES };
  if (!incremental) return params;

  if (position.cursor) {
    params.cursor = position.cursor;
  }

  const after = getIncrementalAfter(position.after);
  if (after !== undefined) {
    params.after = after;
  }

  return params;
};

const findLineOverlap = (currentLines: string[], incomingLines: string[]): number => {
  const maxOverlap = Math.min(currentLines.length, incomingLines.length);

  for (let size = maxOverlap; size > 0; size -= 1) {
    let matched = true;
    for (let i = 0; i < size; i += 1) {
      if (currentLines[currentLines.length - size + i] !== incomingLines[i]) {
        matched = false;
        break;
      }
    }
    if (matched) return size;
  }

  return 0;
};

const mergeIncrementalLines = (currentLines: string[], incomingLines: string[]): string[] => {
  if (currentLines.length === 0 || incomingLines.length === 0) {
    return [...currentLines, ...incomingLines];
  }

  const overlap = findLineOverlap(currentLines, incomingLines);
  return [...currentLines, ...incomingLines.slice(overlap)];
};

const getErrorPayloadText = (err: unknown): string => {
  if (typeof err !== 'object' || err === null) return '';
  const payloads = [
    (err as { data?: unknown }).data,
    (err as { details?: unknown }).details,
  ].filter((payload) => payload !== undefined);
  return payloads
    .map((payload) => {
      if (typeof payload === 'string') return payload;
      try {
        return JSON.stringify(payload);
      } catch {
        return '';
      }
    })
    .join(' ');
};

const isLoggingToFileDisabledError = (err: unknown): boolean => {
  const text = `${getErrorMessage(err)} ${getErrorPayloadText(err)}`.toLowerCase();
  return text.includes('logging to file disabled');
};

const responseDataToText = async (data: unknown): Promise<string> => {
  if (data instanceof Blob) return data.text();
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  if (typeof data === 'string') return data;
  if (data === undefined || data === null) return '';

  try {
    return JSON.stringify(data, null, 2);
  } catch {
    return String(data);
  }
};

type TabType = 'logs' | 'errors';
const TABS: readonly TabType[] = ['logs', 'errors'];
const tabDomId = (tab: TabType) => `logs-tab-${tab}`;
const LOGS_TAB_PANEL_ID = 'logs-tabpanel';

export interface LogDisplayState {
  hideManagementLogs: boolean;
  showRawLogs: boolean;
}

const DEFAULT_LOG_DISPLAY: LogDisplayState = {
  hideManagementLogs: true,
  showRawLogs: false,
};

/** Display switches that differ from their defaults; the closed Options trigger shows this. */
const countChangedDisplayOptions = (state: LogDisplayState): number =>
  (Object.keys(DEFAULT_LOG_DISPLAY) as Array<keyof LogDisplayState>).filter(
    (key) => state[key] !== DEFAULT_LOG_DISPLAY[key]
  ).length;

export type ActiveLogFilter =
  | { kind: 'method'; value: HttpMethod }
  | { kind: 'status'; value: StatusGroup }
  | { kind: 'path'; value: string };

/** Active structured filters in panel order, so they stay visible while the panel is closed. */
const listActiveLogFilters = (
  methods: readonly HttpMethod[],
  statuses: readonly StatusGroup[],
  paths: readonly string[]
): ActiveLogFilter[] => [
  ...HTTP_METHODS.filter((method) => methods.includes(method)).map((value): ActiveLogFilter => ({
    kind: 'method',
    value,
  })),
  ...STATUS_GROUPS.filter((group) => statuses.includes(group)).map((value): ActiveLogFilter => ({
    kind: 'status',
    value,
  })),
  ...paths.map((value): ActiveLogFilter => ({ kind: 'path', value })),
];

interface ActiveLogFiltersProps {
  methods: readonly HttpMethod[];
  statuses: readonly StatusGroup[];
  paths: readonly string[];
  onRemove: (filter: ActiveLogFilter) => void;
  onClear: () => void;
}

export function ActiveLogFilters({
  methods,
  statuses,
  paths,
  onRemove,
  onClear,
}: ActiveLogFiltersProps) {
  const { t } = useTranslation();
  const filters = listActiveLogFilters(methods, statuses, paths);
  if (filters.length === 0) return null;
  const labelOf = (filter: ActiveLogFilter) =>
    filter.kind === 'status' ? t(`logs.filter_status_${filter.value}`) : filter.value;
  return (
    <div className={styles.activeFilters} role="group" aria-label={t('logs.active_filters_label')}>
      <span className={styles.activeFiltersCount}>
        {t('logs.active_filters_count', { count: filters.length })}
      </span>
      {filters.map((filter) => {
        const label = labelOf(filter);
        return (
          <button
            key={`${filter.kind}:${filter.value}`}
            type="button"
            className={styles.activeFilterChip}
            onClick={() => onRemove(filter)}
            aria-label={t('logs.remove_filter', { filter: label })}
            title={filter.kind === 'path' ? filter.value : undefined}
          >
            <span className={styles.activeFilterText}>{label}</span>
            <IconX size={iconSize['14']} aria-hidden="true" />
          </button>
        );
      })}
      <Button variant="ghost" size="sm" className={styles.activeFiltersClear} onClick={onClear}>
        {t('logs.clear_filters')}
      </Button>
    </div>
  );
}

interface LogsOptionsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
  display: LogDisplayState;
  onHideManagementLogsChange: (value: boolean) => void;
  onShowRawLogsChange: (value: boolean) => void;
  fullscreen: boolean;
  downloadDisabled: boolean;
  clearDisabled: boolean;
  onDownload: () => void;
  onEnterFullscreen: () => void;
  onClear: () => void;
}

const LOGS_OPTIONS_PANEL_ID = 'logs-options-panel';

/**
 * Disclosure for display switches and less frequent actions. Focus stays on the trigger when it
 * opens and Tab continues into the panel; Escape, an outside press or focus leaving closes it,
 * and Escape or any action inside hands focus back to the trigger.
 */
export function LogsOptions({
  open,
  onOpenChange,
  triggerRef,
  display,
  onHideManagementLogsChange,
  onShowRawLogsChange,
  fullscreen,
  downloadDisabled,
  clearDisabled,
  onDownload,
  onEnterFullscreen,
  onClear,
}: LogsOptionsProps) {
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement>(null);
  const changedCount = countChangedDisplayOptions(display);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) onOpenChange(false);
    };
    // Capture phase so the fullscreen Escape handler does not also exit full screen.
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (document.querySelector('.modal-overlay')) return;
      event.stopPropagation();
      onOpenChange(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [open, onOpenChange, triggerRef]);

  const runAndClose = (action: () => void) => () => {
    onOpenChange(false);
    triggerRef.current?.focus();
    action();
  };

  return (
    <div
      ref={rootRef}
      className={styles.options}
      onBlur={(event) => {
        const next = event.relatedTarget as Node | null;
        if (open && next && !event.currentTarget.contains(next)) onOpenChange(false);
      }}
    >
      {/* Shared button styling; a native element because the trigger needs a focus ref. */}
      <button
        ref={triggerRef}
        type="button"
        className={`btn btn-secondary ${styles.optionsTrigger}`}
        aria-expanded={open}
        aria-controls={LOGS_OPTIONS_PANEL_ID}
        onClick={() => onOpenChange(!open)}
      >
        <span>
          {t('logs.options_button')}
          {changedCount > 0 && (
            <>
              <span className={styles.filterPanelCount} aria-hidden="true">
                {changedCount}
              </span>
              <span className={styles.visuallyHidden}>
                {`, ${t('logs.options_changed_count', { count: changedCount })}`}
              </span>
            </>
          )}
          <IconChevronDown size={iconSize['16']} className={styles.filterPanelChevron} />
        </span>
      </button>

      <div
        id={LOGS_OPTIONS_PANEL_ID}
        className={styles.optionsPanel}
        role="region"
        aria-label={t('logs.options_button')}
        hidden={!open}
      >
        <div
          className={styles.optionsSection}
          role="group"
          aria-label={t('logs.display_options_group')}
        >
          <ToggleSwitch
            checked={display.hideManagementLogs}
            onChange={onHideManagementLogsChange}
            labelPosition="left"
            label={t('logs.hide_management_logs', { prefix: MANAGEMENT_API_PREFIX })}
          />
          <ToggleSwitch
            checked={display.showRawLogs}
            onChange={onShowRawLogsChange}
            labelPosition="left"
            label={t('logs.show_raw_logs')}
          />
        </div>
        <div className={styles.optionsSection} role="group" aria-label={t('logs.actions_group')}>
          <Button
            variant="secondary"
            onClick={runAndClose(onDownload)}
            disabled={downloadDisabled}
            className={styles.optionsAction}
            title={t('logs.download_hint')}
          >
            <IconDownload size={iconSize['16']} />
            {t('logs.download_button')}
          </Button>
          {!fullscreen && (
            <Button
              variant="secondary"
              onClick={runAndClose(onEnterFullscreen)}
              className={styles.optionsAction}
            >
              <IconMaximize2 size={iconSize['16']} />
              {t('logs.fullscreen_button')}
            </Button>
          )}
        </div>
        {/* Destructive action sits below a divider and always confirms first. */}
        <div className={styles.optionsDanger}>
          <Button
            variant="danger-outline"
            onClick={runAndClose(onClear)}
            disabled={clearDisabled}
            className={styles.optionsAction}
          >
            <IconTrash2 size={iconSize['16']} />
            {t('logs.clear_button')}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function LogsPage() {
  const { t, i18n } = useTranslation();
  const { showNotification, showConfirmation } = useNotificationStore();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const apiBase = useAuthStore((state) => state.apiBase);
  const managementKey = useAuthStore((state) => state.managementKey);
  const config = useConfigStore((state) => state.config);
  const requestLogEnabled = config?.requestLog ?? false;
  const loggingToFileEnabled = config?.loggingToFile ?? false;
  const cpaNeedsFileLogging = !loggingToFileEnabled;
  const [fileLoggingRequired, setFileLoggingRequired] = useState(false);
  const showFileLoggingRequired = cpaNeedsFileLogging || fileLoggingRequired;

  const [activeTab, setActiveTab] = useState<TabType>('logs');
  const [logState, setLogState] = useState<LogState>({ buffer: [], visibleFrom: 0 });
  const [loading, setLoading] = useState(true);
  const [clearingLogs, setClearingLogs] = useState(false);
  const [error, setError] = useState('');
  const [autoRefresh, setAutoRefresh] = useLocalStorage('logsPage.autoRefresh', false);
  // `?search=claude` (from a dashboard alert) pre-fills the filter, then leaves the URL clean.
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchQuery, setSearchQuery] = useState(() => searchParams.get('search') ?? '');
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [hideManagementLogs, setHideManagementLogs] = useLocalStorage(
    'logsPage.hideManagementLogs',
    true
  );
  const [showRawLogs, setShowRawLogs] = useLocalStorage('logsPage.showRawLogs', false);
  const [structuredFiltersExpanded, setStructuredFiltersExpanded] = useLocalStorage(
    'logsPage.structuredFiltersExpanded',
    false
  );
  const [errorLogs, setErrorLogs] = useState<ErrorLogFile[]>([]);
  const [loadingErrors, setLoadingErrors] = useState(false);
  const [errorLogsError, setErrorLogsError] = useState('');
  const [errorLogViewer, dispatchErrorLogViewer] = useReducer(errorLogViewerReducer, {
    status: 'closed',
  });
  const selectedErrorLog = errorLogViewer.status === 'closed' ? null : errorLogViewer.item;
  const [requestLogId, setRequestLogId] = useState<string | null>(null);
  const [requestLogDownloading, setRequestLogDownloading] = useState(false);
  const [fullscreenLogs, setFullscreenLogs] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const optionsTriggerRef = useRef<HTMLButtonElement>(null);

  const [requests] = useState(() => ({
    session: createLogRequestGuard(),
    logs: createLogRequestQueue(),
    errors: createLogRequestGuard(),
    viewer: createLogRequestGuard(),
  }));
  const longPressRef = useRef<{
    timer: number | null;
    startX: number;
    startY: number;
    fired: boolean;
  } | null>(null);

  // 保存最新游标用于增量获取；新接口优先使用 cursor，旧接口继续使用 after。
  const logPositionRef = useRef<LogPosition>({});

  const resetLogPosition = () => {
    logPositionRef.current = {};
  };

  const updateLogPosition = (
    data: Awaited<ReturnType<typeof logsApi.fetchLogs>>,
    incremental: boolean
  ) => {
    const currentPosition = logPositionRef.current;
    const nextPosition: LogPosition = {};
    if (data.nextCursor) {
      nextPosition.cursor = data.nextCursor;
    }
    if (data.latestAfter !== undefined) {
      nextPosition.after = data.latestAfter;
    } else if (incremental && currentPosition.after !== undefined) {
      nextPosition.after = currentPosition.after;
    }
    logPositionRef.current = nextPosition;
  };

  const disableControls = connectionStatus !== 'connected';
  const autoRefreshDisabled = disableControls || showFileLoggingRequired;
  const clearDisabled = disableControls || clearingLogs || showFileLoggingRequired;

  async function loadLogs(incremental = false) {
    // Queued reloads must read live context, not the render that started the old request.
    if (useAuthStore.getState().connectionStatus !== 'connected') {
      setLoading(false);
      return;
    }

    if (!useConfigStore.getState().config?.loggingToFile) {
      if (!incremental) {
        resetLogPosition();
        setFileLoggingRequired(false);
        setLogState({ buffer: [], visibleFrom: 0 });
        setError('');
        setLoading(false);
      }
      return;
    }

    const request = requests.logs.startRead(incremental);
    if (request === null) return;

    if (!incremental) {
      setLoading(true);
    }
    setError('');

    try {
      const stickToBottom = !incremental || isNearBottom(logViewerRef.current);
      if (stickToBottom) {
        requestScrollToBottom();
      }

      const params = buildLogsQuery(incremental, logPositionRef.current);
      const data = await logsApi.fetchLogs(params);
      if (!requests.logs.isCurrent(request)) return;
      setFileLoggingRequired(false);

      updateLogPosition(data, incremental);

      const newLines = Array.isArray(data.lines) ? data.lines : [];

      if (incremental && data.cursorReset) {
        const buffer = newLines.slice(-MAX_BUFFER_LINES);
        const visibleFrom = Math.max(buffer.length - INITIAL_DISPLAY_LINES, 0);
        setLogState({ buffer, visibleFrom });
      } else if (incremental && newLines.length > 0) {
        // 增量更新：追加新日志并限制缓冲区大小（避免内存与渲染膨胀）
        setLogState((prev) => {
          const prevRenderedCount = prev.buffer.length - prev.visibleFrom;
          const combined = mergeIncrementalLines(prev.buffer, newLines);
          const dropCount = Math.max(combined.length - MAX_BUFFER_LINES, 0);
          const buffer = dropCount > 0 ? combined.slice(dropCount) : combined;
          let visibleFrom = Math.max(prev.visibleFrom - dropCount, 0);

          // 若用户停留在底部（跟随最新日志），则保持“渲染窗口”大小不变，避免无限增长
          if (stickToBottom) {
            visibleFrom = Math.max(buffer.length - prevRenderedCount, 0);
          }

          return { buffer, visibleFrom };
        });
      } else if (!incremental) {
        // 全量加载：默认只渲染最后 100 行，向上滚动再展开更多
        const buffer = newLines.slice(-MAX_BUFFER_LINES);
        const visibleFrom = Math.max(buffer.length - INITIAL_DISPLAY_LINES, 0);
        setLogState({ buffer, visibleFrom });
      }
    } catch (err: unknown) {
      if (!requests.logs.isCurrent(request)) return;
      console.error('Failed to load logs:', err);
      if (isLoggingToFileDisabledError(err)) {
        if (!incremental) {
          resetLogPosition();
          setFileLoggingRequired(true);
          setLogState({ buffer: [], visibleFrom: 0 });
          setError('');
        }
        return;
      }
      if (!incremental) {
        setError(getErrorMessage(err) || t('logs.load_error'));
      }
    } finally {
      if (requests.logs.isCurrent(request)) {
        if (!incremental) setLoading(false);
        if (requests.logs.finish(request)) void loadLogs(false);
      }
    }
  }

  useHeaderRefresh(() => loadLogs(false));

  const clearLogs = async () => {
    if (cpaNeedsFileLogging) {
      showNotification(t('logs.cpa_file_logging_required'), 'warning');
      return;
    }
    if (fileLoggingRequired) {
      showNotification(t('logs.file_logging_required'), 'warning');
      return;
    }
    const session = requests.session.capture();
    showConfirmation({
      title: t('logs.clear_confirm_title'),
      message: t('logs.clear_confirm'),
      variant: 'danger',
      confirmText: t('logs.clear_button'),
      onConfirm: async () => {
        if (!requests.session.isCurrent(session)) return;
        if (useAuthStore.getState().connectionStatus !== 'connected') return;
        if (!useConfigStore.getState().config?.loggingToFile) return;
        const request = requests.logs.startClear();
        if (request === null) return;
        setClearingLogs(true);
        setLoading(false);
        setError('');
        let clearFailed = false;
        try {
          await logsApi.clearLogs();
          if (!requests.logs.isCurrent(request)) return;
          setLogState({ buffer: [], visibleFrom: 0 });
          resetLogPosition();
          setFileLoggingRequired(false);
          showNotification(t('logs.clear_success'), 'success');
        } catch (err: unknown) {
          if (!requests.logs.isCurrent(request)) return;
          clearFailed = true;
          const message = getErrorMessage(err);
          showNotification(
            `${t('notification.delete_failed')}${message ? `: ${message}` : ''}`,
            'error'
          );
        } finally {
          if (requests.logs.isCurrent(request)) {
            setClearingLogs(false);
            // Clear superseded the old read; recover it even when deletion fails.
            if (requests.logs.finish(request, clearFailed)) void loadLogs(false);
          }
        }
      },
    });
  };

  const downloadLogs = () => {
    const text = logState.buffer.join('\n');
    downloadBlob({ filename: 'logs.txt', blob: new Blob([text], { type: 'text/plain' }) });
    showNotification(t('logs.download_success'), 'success');
  };

  const loadErrorLogs = async () => {
    if (useAuthStore.getState().connectionStatus !== 'connected') {
      setLoadingErrors(false);
      return;
    }
    const request = requests.errors.invalidate();
    setLoadingErrors(true);
    setErrorLogsError('');
    try {
      const res = await logsApi.fetchErrorLogs();
      if (!requests.errors.isCurrent(request)) return;
      // API 返回 { files: [...] }
      setErrorLogs(Array.isArray(res.files) ? res.files : []);
    } catch (err: unknown) {
      if (!requests.errors.isCurrent(request)) return;
      console.error('Failed to load error logs:', err);
      setErrorLogs([]);
      const message = getErrorMessage(err);
      setErrorLogsError(
        message ? `${t('logs.error_logs_load_error')}: ${message}` : t('logs.error_logs_load_error')
      );
    } finally {
      if (requests.errors.isCurrent(request)) setLoadingErrors(false);
    }
  };

  const downloadErrorLog = async (name: string) => {
    const session = requests.session.capture();
    try {
      const response = await logsApi.downloadErrorLog(name);
      if (!requests.session.isCurrent(session)) return;
      downloadBlob({ filename: name, blob: new Blob([response.data], { type: 'text/plain' }) });
      showNotification(t('logs.error_log_download_success'), 'success');
    } catch (err: unknown) {
      if (!requests.session.isCurrent(session)) return;
      const message = getErrorMessage(err);
      showNotification(
        `${t('notification.download_failed')}${message ? `: ${message}` : ''}`,
        'error'
      );
    }
  };

  const openErrorLog = async (item: ErrorLogFile) => {
    const requestId = requests.viewer.invalidate();
    dispatchErrorLogViewer({ type: 'open', item });

    try {
      const response = await logsApi.downloadErrorLog(item.name);
      const text = await responseDataToText(response.data);
      if (!requests.viewer.isCurrent(requestId)) return;
      dispatchErrorLogViewer({ type: 'ready', text });
    } catch (err: unknown) {
      if (!requests.viewer.isCurrent(requestId)) return;
      const message = getErrorMessage(err);
      dispatchErrorLogViewer({
        type: 'error',
        message: message
          ? `${t('logs.error_log_open_failed')}: ${message}`
          : t('logs.error_log_open_failed'),
      });
    }
  };

  const closeErrorLogViewer = () => {
    requests.viewer.invalidate();
    dispatchErrorLogViewer({ type: 'close' });
  };

  const copySelectedErrorLog = async () => {
    if (errorLogViewer.status !== 'ready' || !errorLogViewer.text) return;
    const session = requests.session.capture();
    const ok = await copyToClipboard(errorLogViewer.text);
    if (!requests.session.isCurrent(session)) return;
    showNotification(
      ok
        ? t('logs.error_log_copy_success')
        : t('logs.copy_failed', { defaultValue: 'Copy failed' }),
      ok ? 'success' : 'error'
    );
  };

  useEffect(() => {
    const resetLogs = () => {
      requests.logs.invalidate();
      logPositionRef.current = {};
      setLogState({ buffer: [], visibleFrom: 0 });
      setLoading(false);
      setClearingLogs(false);
      setError('');
      setFileLoggingRequired(false);
    };
    const resetErrors = () => {
      requests.errors.invalidate();
      setErrorLogs([]);
      setLoadingErrors(false);
      setErrorLogsError('');
    };
    const invalidateSession = () => {
      requests.session.invalidate();
      requests.logs.invalidate();
      requests.errors.invalidate();
      requests.viewer.invalidate();
      if (longPressRef.current?.timer) window.clearTimeout(longPressRef.current.timer);
      longPressRef.current = null;
    };

    // Store subscriptions invalidate synchronously, before a response can beat effect cleanup.
    const unsubscribeAuth = useAuthStore.subscribe((next, previous) => {
      if (
        next.apiBase === previous.apiBase &&
        next.managementKey === previous.managementKey &&
        next.connectionStatus === previous.connectionStatus &&
        next.isAuthenticated === previous.isAuthenticated
      )
        return;
      invalidateSession();
      resetLogs();
      resetErrors();
      dispatchErrorLogViewer({ type: 'close' });
      setRequestLogId(null);
      setRequestLogDownloading(false);
    });
    const unsubscribeConfig = useConfigStore.subscribe((next, previous) => {
      if (next.config?.loggingToFile !== previous.config?.loggingToFile) resetLogs();
      if (next.config?.requestLog !== previous.config?.requestLog) resetErrors();
    });
    return () => {
      unsubscribeAuth();
      unsubscribeConfig();
      invalidateSession();
    };
  }, [requests]);

  useEffect(() => {
    if (connectionStatus === 'connected') {
      resetLogPosition();
      setFileLoggingRequired(false);
      loadLogs(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionStatus, apiBase, managementKey, loggingToFileEnabled]);

  useEffect(() => {
    if (activeTab !== 'errors') return;
    if (connectionStatus !== 'connected') return;
    void loadErrorLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, connectionStatus, apiBase, managementKey, requestLogEnabled]);

  useEffect(() => {
    if (!autoRefresh || connectionStatus !== 'connected' || showFileLoggingRequired) {
      return;
    }
    const id = window.setInterval(() => {
      loadLogs(true);
    }, 8000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh, connectionStatus, showFileLoggingRequired]);

  const visibleLines = useMemo(
    () => logState.buffer.slice(logState.visibleFrom),
    [logState.buffer, logState.visibleFrom]
  );

  const trimmedSearchQuery = deferredSearchQuery.trim();
  const isSearching = trimmedSearchQuery.length > 0;
  const baseLines = isSearching ? logState.buffer : visibleLines;

  const parsedSearchLines = useMemo(() => {
    let working = baseLines;

    if (hideManagementLogs) {
      working = working.filter((line) => !line.includes(MANAGEMENT_API_PREFIX));
    }

    if (trimmedSearchQuery) {
      const queryLowered = trimmedSearchQuery.toLowerCase();
      working = working.filter((line) => line.toLowerCase().includes(queryLowered));
    }

    return working.map((line) => parseLogLine(line));
  }, [baseLines, hideManagementLogs, trimmedSearchQuery]);

  const filters = useLogFilters({ parsedLines: parsedSearchLines });
  const { clearStructuredFilters } = filters;
  useEffect(() => {
    const requested = searchParams.get('search');
    if (requested === null) return;
    setSearchQuery(requested);
    clearStructuredFilters();
    const next = new URLSearchParams(searchParams);
    next.delete('search');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams, clearStructuredFilters]);
  const structuredFiltersPanelId = 'logs-structured-filters';
  const structuredFilterCount =
    filters.methodFilters.length + filters.statusFilters.length + filters.pathFilters.length;
  const removeActiveFilter = (filter: ActiveLogFilter) => {
    if (filter.kind === 'method') filters.toggleMethodFilter(filter.value);
    else if (filter.kind === 'status') filters.toggleStatusFilter(filter.value);
    else filters.togglePathFilter(filter.value);
  };

  const { filteredParsedLines, filteredLines, removedCount } = useMemo(() => {
    const filteredParsed = parsedSearchLines.filter((line) => {
      if (
        filters.methodFilterSet.size > 0 &&
        (!line.method || !filters.methodFilterSet.has(line.method))
      ) {
        return false;
      }

      const statusGroup = resolveStatusGroup(line.statusCode);
      if (
        filters.statusFilterSet.size > 0 &&
        (!statusGroup || !filters.statusFilterSet.has(statusGroup))
      ) {
        return false;
      }

      if (filters.pathFilterSet.size > 0 && (!line.path || !filters.pathFilterSet.has(line.path))) {
        return false;
      }

      return true;
    });

    return {
      filteredParsedLines: filteredParsed,
      filteredLines: filteredParsed.map((line) => line.raw),
      removedCount: Math.max(baseLines.length - filteredParsed.length, 0),
    };
  }, [
    baseLines,
    filters.methodFilterSet,
    filters.pathFilterSet,
    filters.statusFilterSet,
    parsedSearchLines,
  ]);

  const parsedVisibleLines = useMemo(
    () => (showRawLogs ? [] : filteredParsedLines),
    [filteredParsedLines, showRawLogs]
  );

  const rawVisibleText = useMemo(() => filteredLines.join('\n'), [filteredLines]);

  // Decided before structured filters so toggling a chip never reshapes the table.
  const structuredColumns = useMemo(
    () => resolveStructuredColumns(parsedSearchLines),
    [parsedSearchLines]
  );
  const formatLogTime = useMemo(() => createLogTimeFormatter(i18n.language), [i18n.language]);
  const logGrid = useMemo(
    () =>
      buildLogGrid(
        structuredColumns,
        parsedSearchLines,
        (line) => formatLogTime(line.timestamp)?.text ?? line.timestamp ?? ''
      ),
    [structuredColumns, parsedSearchLines, formatLogTime]
  );

  const { canLoadMore, handleLogScroll, logViewerRef, requestScrollToBottom } = useLogScroller({
    logState,
    setLogState,
    loading,
    isSearching,
    filteredLineCount: filteredLines.length,
    hasStructuredFilters: filters.hasStructuredFilters,
    showRawLogs,
  });

  const copyLogLine = async (raw: string) => {
    const ok = await copyToClipboard(raw);
    if (ok) {
      showNotification(t('logs.copy_success', { defaultValue: 'Copied to clipboard' }), 'success');
    } else {
      showNotification(t('logs.copy_failed', { defaultValue: 'Copy failed' }), 'error');
    }
  };

  const clearLongPressTimer = () => {
    if (longPressRef.current?.timer) {
      window.clearTimeout(longPressRef.current.timer);
      longPressRef.current.timer = null;
    }
  };

  const startLongPress = (event: ReactPointerEvent<HTMLDivElement>, id?: string) => {
    if (!requestLogEnabled) return;
    if (!id) return;
    if (requestLogId) return;
    clearLongPressTimer();
    longPressRef.current = {
      timer: window.setTimeout(() => {
        setRequestLogId(id);
        if (longPressRef.current) {
          longPressRef.current.fired = true;
          longPressRef.current.timer = null;
        }
      }, LONG_PRESS_MS),
      startX: event.clientX,
      startY: event.clientY,
      fired: false,
    };
  };

  const cancelLongPress = () => {
    clearLongPressTimer();
    longPressRef.current = null;
  };

  const handleLongPressMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = longPressRef.current;
    if (!current || current.timer === null || current.fired) return;
    const deltaX = Math.abs(event.clientX - current.startX);
    const deltaY = Math.abs(event.clientY - current.startY);
    if (deltaX > LONG_PRESS_MOVE_THRESHOLD || deltaY > LONG_PRESS_MOVE_THRESHOLD) {
      cancelLongPress();
    }
  };

  const closeRequestLogModal = () => {
    if (requestLogDownloading) return;
    setRequestLogId(null);
  };

  const downloadRequestLog = async (id: string) => {
    const session = requests.session.capture();
    setRequestLogDownloading(true);
    try {
      const response = await logsApi.downloadRequestLogById(id);
      if (!requests.session.isCurrent(session)) return;
      downloadBlob({
        filename: `request-${id}.log`,
        blob: new Blob([response.data], { type: 'text/plain' }),
      });
      showNotification(t('logs.request_log_download_success'), 'success');
      setRequestLogId(null);
    } catch (err: unknown) {
      if (!requests.session.isCurrent(session)) return;
      const message = getErrorMessage(err);
      showNotification(
        `${t('notification.download_failed')}${message ? `: ${message}` : ''}`,
        'error'
      );
    } finally {
      if (requests.session.isCurrent(session)) setRequestLogDownloading(false);
    }
  };

  useEffect(() => {
    return () => {
      if (longPressRef.current?.timer) {
        window.clearTimeout(longPressRef.current.timer);
        longPressRef.current.timer = null;
      }
    };
  }, []);

  // Exit removes the focused exit button; hand focus to the Options trigger that stays mounted.
  const exitFullscreen = () => {
    setFullscreenLogs(false);
    window.requestAnimationFrame(() => optionsTriggerRef.current?.focus());
  };

  const selectTab = (tab: TabType) => {
    if (tab === 'errors') setFullscreenLogs(false);
    setOptionsOpen(false);
    setActiveTab(tab);
  };

  useEffect(() => {
    if (!fullscreenLogs) return;

    document.body.classList.add('logs-fullscreen-active');
    lockScroll();

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (document.querySelector('.modal-overlay')) return;
      setFullscreenLogs(false);
      window.requestAnimationFrame(() => optionsTriggerRef.current?.focus());
    };

    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.classList.remove('logs-fullscreen-active');
      unlockScroll();
    };
  }, [fullscreenLogs]);

  const refreshControls = (
    <div className={styles.refreshGroup}>
      <RefreshButton
        onClick={() => loadLogs(false)}
        label={t('logs.refresh_button')}
        refreshing={loading}
        disabled={disableControls || clearingLogs || cpaNeedsFileLogging}
      />
      <ToggleSwitch
        checked={autoRefresh}
        onChange={(value) => setAutoRefresh(value)}
        disabled={autoRefreshDisabled}
        label={
          <span className={styles.switchLabel}>
            <IconTimer size={iconSize['16']} />
            {/* One unabbreviated name at every width: a bare "Auto" beside a switch is ambiguous. */}
            <span>{t('logs.auto_refresh')}</span>
          </span>
        }
      />
    </div>
  );

  const handleTabKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const index = TABS.indexOf(activeTab);
    let next = -1;
    if (event.key === 'ArrowRight') next = (index + 1) % TABS.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + TABS.length) % TABS.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = TABS.length - 1;
    if (next < 0) return;
    event.preventDefault();
    selectTab(TABS[next]);
    document.getElementById(tabDomId(TABS[next]))?.focus();
  };

  return (
    <div className={styles.container}>
      <PageHeader
        title={t('logs.title')}
        // The Log tab pairs Refresh with Auto refresh; the Error tab has Refresh alone.
        stackActionsOnPhone
        actions={
          fullscreenLogs ? undefined : activeTab === 'logs' ? (
            refreshControls
          ) : (
            // Same header slot on both tabs, so switching tabs never shifts the tab bar.
            <RefreshButton
              onClick={() => void loadErrorLogs()}
              label={t('logs.refresh_error_logs')}
              refreshing={loadingErrors}
              disabled={disableControls}
            />
          )
        }
      />

      <div className={styles.tabBar} role="tablist" aria-label={t('logs.tabs_label')}>
        {TABS.map((tab) => {
          const selected = activeTab === tab;
          return (
            <button
              key={tab}
              id={tabDomId(tab)}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={LOGS_TAB_PANEL_ID}
              tabIndex={selected ? 0 : -1}
              className={`${styles.tabItem} ${selected ? styles.tabActive : ''}`}
              onClick={() => selectTab(tab)}
              onKeyDown={handleTabKeyDown}
            >
              {t(tab === 'logs' ? 'logs.log_content' : 'logs.error_logs_modal_title')}
            </button>
          );
        })}
      </div>

      <div
        id={LOGS_TAB_PANEL_ID}
        className={styles.content}
        role="tabpanel"
        aria-labelledby={tabDomId(activeTab)}
      >
        {activeTab === 'logs' && (
          <Card
            className={[styles.logCard, fullscreenLogs ? styles.logCardFullscreen : '']
              .filter(Boolean)
              .join(' ')}
          >
            {showFileLoggingRequired && (
              <div className="status-badge warning">
                {t(
                  cpaNeedsFileLogging
                    ? 'logs.cpa_file_logging_required'
                    : 'logs.file_logging_required'
                )}
              </div>
            )}
            {error && <div className="error-box">{error}</div>}

            {/* One row: search, structured filters, Options. Refresh lives in the page header;
                full screen hides the header, so it brings refresh and Exit into this toolbar. */}
            <div className={styles.filters}>
              <div className={styles.searchWrapper}>
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={t('logs.search_placeholder')}
                  className={styles.searchInput}
                  aria-label={t('logs.search_label')}
                  rightElement={
                    searchQuery ? (
                      <button
                        type="button"
                        className={styles.searchClear}
                        onClick={() => setSearchQuery('')}
                        title={t('common.clear')}
                        aria-label={t('common.clear')}
                      >
                        <IconX size={iconSize['16']} />
                      </button>
                    ) : (
                      <IconSearch size={iconSize['16']} className={styles.searchIcon} />
                    )
                  }
                />
              </div>

              {/* Full screen hides the structured filter panel; active filters stay listed below. */}
              {!fullscreenLogs && (
                <Button
                  variant="secondary"
                  className={styles.filterPanelToggle}
                  aria-expanded={structuredFiltersExpanded}
                  aria-controls={structuredFiltersPanelId}
                  onClick={() => setStructuredFiltersExpanded((open) => !open)}
                >
                  <IconSlidersHorizontal size={iconSize['16']} />
                  <span className={styles.labelFull}>{t('logs.filter_panel_title')}</span>
                  <span className={styles.labelShort} aria-hidden="true">
                    {t('logs.filter_panel_short')}
                  </span>
                  {structuredFilterCount > 0 && (
                    <>
                      <span className={styles.filterPanelCount} aria-hidden="true">
                        {structuredFilterCount}
                      </span>
                      <span className={styles.visuallyHidden}>
                        {`, ${t('logs.filter_panel_active_count', { count: structuredFilterCount })}`}
                      </span>
                    </>
                  )}
                  <IconChevronDown size={iconSize['16']} className={styles.filterPanelChevron} />
                </Button>
              )}

              <LogsOptions
                open={optionsOpen}
                onOpenChange={setOptionsOpen}
                triggerRef={optionsTriggerRef}
                display={{ hideManagementLogs, showRawLogs }}
                onHideManagementLogsChange={setHideManagementLogs}
                onShowRawLogsChange={setShowRawLogs}
                fullscreen={fullscreenLogs}
                downloadDisabled={logState.buffer.length === 0}
                clearDisabled={clearDisabled}
                onDownload={downloadLogs}
                onEnterFullscreen={() => setFullscreenLogs(true)}
                onClear={clearLogs}
              />

              {fullscreenLogs && (
                <div className={styles.fullscreenBar}>
                  {refreshControls}
                  {/* Phones keep the name for assistive tech and the tooltip; the row has no room. */}
                  <Button
                    variant="secondary"
                    onClick={exitFullscreen}
                    className={styles.exitFullscreen}
                    title={t('logs.exit_fullscreen_button')}
                  >
                    <IconMinimize2 size={iconSize['16']} />
                    <span className={styles.labelFull}>{t('logs.exit_fullscreen_button')}</span>
                  </Button>
                </div>
              )}

              {!fullscreenLogs && (
                <div
                  id={structuredFiltersPanelId}
                  className={styles.structuredFilters}
                  hidden={!structuredFiltersExpanded}
                >
                  <div className={styles.filterChipGroup}>
                    <span className={styles.filterChipLabel}>{t('logs.filter_method')}</span>
                    <div className={styles.filterChipList}>
                      {HTTP_METHODS.map((method) => {
                        const active = filters.methodFilters.includes(method);
                        const count = filters.methodCounts[method] ?? 0;
                        return (
                          <button
                            key={method}
                            type="button"
                            className={styles.filterChip}
                            onClick={() => filters.toggleMethodFilter(method)}
                            disabled={count === 0 && !active}
                            aria-pressed={active}
                          >
                            {active && <IconCheck size={iconSize['14']} aria-hidden="true" />}
                            {method} ({count})
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className={styles.filterChipGroup}>
                    <span className={styles.filterChipLabel}>{t('logs.filter_status')}</span>
                    <div className={styles.filterChipList}>
                      {STATUS_GROUPS.map((statusGroup) => {
                        const active = filters.statusFilters.includes(statusGroup);
                        const count = filters.statusCounts[statusGroup] ?? 0;
                        return (
                          <button
                            key={statusGroup}
                            type="button"
                            className={styles.filterChip}
                            onClick={() => filters.toggleStatusFilter(statusGroup)}
                            disabled={count === 0 && !active}
                            aria-pressed={active}
                          >
                            {active && <IconCheck size={iconSize['14']} aria-hidden="true" />}
                            {t(`logs.filter_status_${statusGroup}`)} ({count})
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className={styles.filterChipGroup}>
                    <span className={styles.filterChipLabel}>{t('logs.filter_path')}</span>
                    <div className={styles.filterChipList}>
                      {filters.pathOptions.length === 0 ? (
                        <span className={styles.filterChipHint}>{t('logs.filter_path_empty')}</span>
                      ) : (
                        filters.pathOptions.map(({ path, count }) => {
                          const active = filters.pathFilters.includes(path);
                          return (
                            <button
                              key={path}
                              type="button"
                              className={styles.filterChip}
                              onClick={() => filters.togglePathFilter(path)}
                              aria-pressed={active}
                              title={path}
                            >
                              {active && <IconCheck size={iconSize['14']} aria-hidden="true" />}
                              <span className={styles.filterChipText}>
                                {path} ({count})
                              </span>
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>

                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={filters.clearStructuredFilters}
                    disabled={!filters.hasStructuredFilters}
                  >
                    {t('logs.clear_filters')}
                  </Button>
                </div>
              )}

              {/* Full screen hides the filter panel, so active filters must stay listed there too. */}
              {(fullscreenLogs || !structuredFiltersExpanded) && (
                <ActiveLogFilters
                  methods={filters.methodFilters}
                  statuses={filters.statusFilters}
                  paths={filters.pathFilters}
                  onRemove={removeActiveFilter}
                  onClear={filters.clearStructuredFilters}
                />
              )}
            </div>

            {loading ? (
              <div className="hint">{t('logs.loading')}</div>
            ) : logState.buffer.length > 0 && filteredLines.length > 0 ? (
              <div
                ref={logViewerRef}
                className={[styles.logPanel, fullscreenLogs ? styles.logPanelFullscreen : '']
                  .filter(Boolean)
                  .join(' ')}
                onScroll={handleLogScroll}
              >
                {canLoadMore && (
                  <div className={styles.loadMoreBanner}>
                    <span>{t('logs.load_more_hint')}</span>
                    <div className={styles.loadMoreStats}>
                      <span>{t('logs.loaded_lines', { count: filteredLines.length })}</span>
                      {removedCount > 0 && (
                        <span className={styles.loadMoreCount}>
                          {t('logs.filtered_lines', { count: removedCount })}
                        </span>
                      )}
                      <span className={styles.loadMoreCount}>
                        {t('logs.hidden_lines', { count: logState.visibleFrom })}
                      </span>
                    </div>
                  </div>
                )}
                {showRawLogs ? (
                  <pre className={styles.rawLog} spellCheck={false}>
                    {rawVisibleText}
                  </pre>
                ) : (
                  <div
                    className={styles.logList}
                    style={
                      {
                        '--log-grid-columns': logGrid.template,
                        '--log-grid-min-width': logGrid.minWidth,
                      } as CSSProperties
                    }
                  >
                    <div className={styles.columnHeader} aria-hidden="true">
                      {['time', 'level', ...structuredColumns, 'message'].map((column) => (
                        <span
                          key={column}
                          className={column === 'latency' ? styles.latency : undefined}
                        >
                          {t(`redesign.settings.logColumns.${column}`)}
                          {/* Structured times are local; raw lines keep their original zone. */}
                          {column === 'time' && ` · ${resolveTimeZoneLabel()}`}
                        </span>
                      ))}
                    </div>
                    {parsedVisibleLines.map((line, index) => {
                      const rowClassNames = [styles.logRow];
                      if (line.level === 'warn') rowClassNames.push(styles.rowWarn);
                      if (line.level === 'error' || line.level === 'fatal')
                        rowClassNames.push(styles.rowError);
                      return (
                        <div
                          key={`${logState.visibleFrom + index}-${line.raw}`}
                          className={rowClassNames.join(' ')}
                          tabIndex={0}
                          role="button"
                          aria-label={t('logs.copy_line_accessible', { line: line.raw })}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              void copyLogLine(line.raw);
                            }
                          }}
                          onClick={(event) => {
                            // Assistive technology activates button roles with synthesized clicks.
                            if (event.detail === 0) void copyLogLine(line.raw);
                          }}
                          onDoubleClick={() => {
                            void copyLogLine(line.raw);
                          }}
                          onPointerDown={(event) => startLongPress(event, line.requestId)}
                          onPointerUp={cancelLongPress}
                          onPointerLeave={cancelLongPress}
                          onPointerCancel={cancelLongPress}
                          onPointerMove={handleLongPressMove}
                          title={t('logs.double_click_copy_hint', {
                            defaultValue: 'Double-click to copy',
                          })}
                        >
                          <LogRowCells
                            line={line}
                            columns={structuredColumns}
                            formatTime={formatLogTime}
                            locale={i18n.language}
                          />
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : logState.buffer.length > 0 ? (
              <EmptyState
                title={t('logs.search_empty_title')}
                description={t('logs.search_empty_desc')}
              />
            ) : showFileLoggingRequired ? (
              <EmptyState
                title={t(
                  cpaNeedsFileLogging
                    ? 'logs.cpa_file_logging_required_title'
                    : 'logs.file_logging_required_title'
                )}
                description={t(
                  cpaNeedsFileLogging
                    ? 'logs.cpa_file_logging_required_desc'
                    : 'logs.file_logging_required_desc'
                )}
              />
            ) : (
              <EmptyState title={t('logs.empty_title')} description={t('logs.empty_desc')} />
            )}
          </Card>
        )}

        {activeTab === 'errors' && (
          <Card>
            <div className="stack">
              <div className="hint">{t('logs.error_logs_description')}</div>

              {requestLogEnabled && (
                <div>
                  <div className="status-badge warning">
                    {t('logs.error_logs_request_log_enabled')}
                  </div>
                </div>
              )}

              {errorLogsError && <div className="error-box">{errorLogsError}</div>}

              <div className={styles.errorPanel}>
                {loadingErrors ? (
                  <div className="hint">{t('common.loading')}</div>
                ) : errorLogs.length === 0 ? (
                  <div className="hint">{t('logs.error_logs_empty')}</div>
                ) : (
                  <div className="item-list">
                    {errorLogs.map((item) => (
                      <div key={item.name} className="item-row">
                        <div className="item-meta">
                          <div className="item-title">{item.name}</div>
                          <div className="item-subtitle">
                            {item.size ? `${(item.size / 1024).toFixed(1)} KB` : ''}{' '}
                            {item.modified ? formatUnixTimestamp(item.modified) : ''}
                          </div>
                        </div>
                        <div className="item-actions">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => {
                              void openErrorLog(item);
                            }}
                            disabled={disableControls}
                          >
                            <span className={styles.buttonContent}>
                              <IconEye size={iconSize['16']} />
                              {t('logs.error_logs_open')}
                            </span>
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => downloadErrorLog(item.name)}
                            disabled={disableControls}
                          >
                            {t('logs.error_logs_download')}
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </Card>
        )}
      </div>

      <Modal
        open={errorLogViewer.status !== 'closed'}
        onClose={closeErrorLogViewer}
        title={selectedErrorLog?.name ?? t('logs.error_log_view_title')}
        width={size['960']}
        footer={
          <>
            <Button variant="secondary" onClick={closeErrorLogViewer}>
              {t('common.close')}
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                void copySelectedErrorLog();
              }}
              disabled={errorLogViewer.status !== 'ready' || !errorLogViewer.text}
            >
              {t('common.copy')}
            </Button>
            <Button
              onClick={() => {
                if (selectedErrorLog) {
                  void downloadErrorLog(selectedErrorLog.name);
                }
              }}
              disabled={errorLogViewer.status === 'closed' || errorLogViewer.status === 'loading'}
            >
              {t('logs.error_logs_download')}
            </Button>
          </>
        }
      >
        <div className={styles.errorLogViewer}>
          {selectedErrorLog && (
            <div className={styles.errorLogViewerMeta}>
              <span>
                {t('logs.error_logs_size')}:{' '}
                {selectedErrorLog.size ? `${(selectedErrorLog.size / 1024).toFixed(1)} KB` : '-'}
              </span>
              <span>
                {t('logs.error_logs_modified')}:{' '}
                {selectedErrorLog.modified ? formatUnixTimestamp(selectedErrorLog.modified) : '-'}
              </span>
            </div>
          )}
          {errorLogViewer.status === 'error' && (
            <div className="error-box">{errorLogViewer.message}</div>
          )}
          {errorLogViewer.status === 'loading' && <div className="hint">{t('common.loading')}</div>}
          {errorLogViewer.status === 'ready' &&
            (errorLogViewer.text ? (
              <pre className={styles.errorLogContent} spellCheck={false}>
                {errorLogViewer.text}
              </pre>
            ) : (
              <div className="hint">{t('logs.error_log_empty_content')}</div>
            ))}
        </div>
      </Modal>

      <Modal
        open={Boolean(requestLogId)}
        onClose={closeRequestLogModal}
        title={t('logs.request_log_download_title')}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={closeRequestLogModal}
              disabled={requestLogDownloading}
            >
              {t('common.cancel')}
            </Button>
            <Button
              onClick={() => {
                if (requestLogId) {
                  void downloadRequestLog(requestLogId);
                }
              }}
              loading={requestLogDownloading}
              disabled={!requestLogId}
            >
              {t('common.confirm')}
            </Button>
          </>
        }
      >
        {requestLogId ? t('logs.request_log_download_confirm', { id: requestLogId }) : null}
      </Modal>
    </div>
  );
}
