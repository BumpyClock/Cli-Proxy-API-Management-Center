import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { IconChevronLeft, IconRefreshCw } from '@/components/ui/icons';
import { useNow } from '@/hooks/useNow';
import type { ResolvedTheme } from '@/types';
import { formatRelativeInstant } from '@/utils/quota';
import { getAuthFileIcon, getTypeLabel } from '@/features/authFiles/constants';
import { QUOTA_TAB_ORDER } from '../constants';
import type { QuotaFileEntry } from '../logic';
import type { QuotaCardState } from '../providers';
import { DAY_MS, type TimelineMode } from '../quotaTimelineModel';
import { buildQuotaPool, quotaPoolPath } from '../quotaPoolModel';
import { getQuotaObservations } from '../providers/registry';
import { selectQuotaWindow, type QuotaWindowObservation } from '../providers/observations';
import styles from './QuotaOverview.module.scss';

interface QuotaOverviewProps {
  entries: QuotaFileEntry[];
  quotaFor: (entry: QuotaFileEntry) => QuotaCardState | undefined;
  resolvedTheme: ResolvedTheme;
  disabled: boolean;
  onRefresh: (entries: QuotaFileEntry[]) => void;
  children: ReactNode;
}

const WIDTH = 1000;
const HEIGHT = 170;

export function QuotaOverview({
  entries,
  quotaFor,
  resolvedTheme,
  disabled,
  onRefresh,
  children,
}: QuotaOverviewProps) {
  const { t, i18n } = useTranslation();
  const now = useNow();
  const [accounts, setAccounts] = useState(false);
  const [mode, setMode] = useState<TimelineMode>('weekly');
  const [offset, setOffset] = useState(0);
  const days = mode === 'weekly' ? 14 : 3;
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(
    start.getDate() - (mode === 'weekly' ? 3 : 0) + offset * (mode === 'weekly' ? 7 : 1)
  );
  const startMs = start.getTime();
  const end = new Date(startMs);
  end.setDate(end.getDate() + days);
  const endMs = end.getTime();
  const dateFormat = new Intl.DateTimeFormat(i18n.language, { month: 'short', day: 'numeric' });
  const tickFormat = new Intl.DateTimeFormat(i18n.language, {
    weekday: 'short',
    day: 'numeric',
  });
  const numberFormat = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 });
  const percent = (value: number) => `${numberFormat.format(value)}%`;
  const groups = useMemo(
    () =>
      QUOTA_TAB_ORDER.map((provider) => ({
        provider,
        entries: entries.filter((entry) => entry.type === provider),
      })).filter((group) => group.entries.length > 0),
    [entries]
  );
  const ticks = Array.from(
    { length: 8 },
    (_, index) => startMs + ((endMs - startMs - 1) * index) / 7
  );
  const nowX = ((now - startMs) / (endMs - startMs)) * WIDTH;

  return (
    <div className={styles.overview}>
      <div className={styles.controls}>
        <div className={styles.viewGroup} role="group" aria-label={t('quota_management.pool_view')}>
          <button type="button" aria-pressed={!accounts} onClick={() => setAccounts(false)}>
            {t('quota_management.pool_remaining')}
          </button>
          <button type="button" aria-pressed={accounts} onClick={() => setAccounts(true)}>
            {t('quota_management.pool_accounts')}
          </button>
        </div>
        {!accounts && (
          <>
            <div
              className={styles.viewGroup}
              role="group"
              aria-label={t('quota_management.pool_window')}
            >
              {(['weekly', 'session'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={mode === value}
                  onClick={() => {
                    setMode(value);
                    setOffset(0);
                  }}
                >
                  {t(`quota_management.windows_mode_${value}`)}
                </button>
              ))}
            </div>
            <span className={styles.assumption}>{t('quota_management.pool_reset_only')}</span>
            <div className={styles.dateNav}>
              <span>
                {dateFormat.format(startMs)} – {dateFormat.format(endMs - DAY_MS)}
              </span>
              <button
                type="button"
                onClick={() => setOffset((value) => value - 1)}
                aria-label={t('quota_management.windows_prev')}
              >
                <IconChevronLeft size={15} />
              </button>
              <button
                type="button"
                onClick={() => setOffset((value) => value + 1)}
                aria-label={t('quota_management.windows_next')}
              >
                <IconChevronLeft size={15} className={styles.nextIcon} />
              </button>
              <button type="button" onClick={() => setOffset(0)} disabled={offset === 0}>
                {t('quota_management.windows_today')}
              </button>
            </div>
          </>
        )}
      </div>

      {accounts ? (
        children
      ) : (
        <>
          <p className={styles.scope}>{t('quota_management.pool_scope')}</p>
          {groups.map(({ provider, entries: providerEntries }) => {
            const windows = providerEntries
              .map((entry) =>
                selectQuotaWindow(
                  getQuotaObservations(provider, quotaFor(entry)),
                  mode === 'session' ? 5 : 14 * 24
                )
              )
              .filter(
                (window): window is QuotaWindowObservation =>
                  window !== null && (mode !== 'session' || window.periodHours === 5)
              );
            const pool = buildQuotaPool(windows, now, endMs);
            const path = quotaPoolPath(pool, startMs, endMs, WIDTH, HEIGHT);
            const loaded = providerEntries.filter(
              (entry) => quotaFor(entry)?.status === 'success'
            ).length;
            const busy = providerEntries.some((entry) => quotaFor(entry)?.status === 'loading');
            const errors = providerEntries.filter(
              (entry) => quotaFor(entry)?.status === 'error'
            ).length;
            const icon = getAuthFileIcon(provider, resolvedTheme);
            const label = getTypeLabel(t, provider);
            const areaStart = Math.max(0, nowX);
            const area = path
              ? `${path} L${WIDTH},${HEIGHT} L${areaStart.toFixed(2)},${HEIGHT} Z`
              : '';
            const resetLabel =
              pool.nextResetAtMs === null
                ? t('quota_management.pool_unknown')
                : formatRelativeInstant(pool.nextResetAtMs, now, i18n.language);

            return (
              <section key={provider} className={styles.panel} data-provider={provider}>
                <header className={styles.panelHeader}>
                  <h2>
                    {icon && <img src={icon} alt="" />} {label}
                  </h2>
                  <span>
                    {t('quota_management.pool_account_count', { count: providerEntries.length })}
                  </span>
                  <button
                    type="button"
                    className={styles.refresh}
                    disabled={disabled || busy}
                    aria-label={t('quota_management.pool_refresh_provider', { provider: label })}
                    onClick={() => onRefresh(providerEntries)}
                  >
                    <IconRefreshCw size={14} />
                    {t('auth_files.quota_refresh_single')}
                  </button>
                </header>
                <div className={styles.stats}>
                  <div className={styles.headline}>
                    <strong>{pool.remaining === null ? '—' : percent(pool.remaining)}</strong>
                    {pool.remaining !== null && (
                      <span>
                        {t('quota_management.pool_of', { capacity: percent(pool.capacity) })}
                      </span>
                    )}
                  </div>
                  <dl className={styles.metrics}>
                    <div>
                      <dt>{t('quota_management.pool_coverage')}</dt>
                      <dd>
                        {pool.measuredCount} / {providerEntries.length}
                      </dd>
                    </div>
                    <div>
                      <dt>{t('quota_management.pool_next_reset')}</dt>
                      <dd>
                        {pool.nextResetGain > 0 && (
                          <span className={styles.gain}>+{percent(pool.nextResetGain)} </span>
                        )}
                        {resetLabel}
                      </dd>
                    </div>
                    <div>
                      <dt>{t('quota_management.pool_forecast')}</dt>
                      <dd>{t('quota_management.pool_no_usage')}</dd>
                    </div>
                  </dl>
                </div>

                {path ? (
                  <div className={styles.plot}>
                    <div className={styles.yAxis} aria-hidden="true">
                      <span>{percent(pool.capacity)}</span>
                      <span>{percent(pool.capacity / 2)}</span>
                      <span>0%</span>
                    </div>
                    <div className={styles.plotBody}>
                      <div className={styles.chartFrame}>
                        <svg
                          className={styles.chart}
                          viewBox={`0 -20 ${WIDTH} ${HEIGHT + 40}`}
                          preserveAspectRatio="none"
                          role="img"
                          aria-label={t('quota_management.pool_chart_label', {
                            provider: label,
                            remaining: percent(pool.remaining ?? 0),
                            count: pool.measuredCount,
                            reset: resetLabel,
                          })}
                        >
                          {[0, HEIGHT / 2, HEIGHT].map((y) => (
                            <line
                              key={y}
                              x1={0}
                              x2={WIDTH}
                              y1={y}
                              y2={y}
                              className={styles.gridLine}
                            />
                          ))}
                          {nowX > 0 && nowX < WIDTH && (
                            <rect
                              x={0}
                              y={0}
                              width={nowX}
                              height={HEIGHT}
                              className={styles.past}
                            />
                          )}
                          <path d={area} className={styles.area} />
                          <path d={path} className={styles.projection} />
                          {nowX >= 0 && nowX <= WIDTH && (
                            <line
                              x1={nowX}
                              x2={nowX}
                              y1={-8}
                              y2={HEIGHT}
                              className={styles.nowLine}
                            />
                          )}
                        </svg>
                        {nowX >= 0 && nowX <= WIDTH && (
                          <>
                            <span
                              className={styles.nowLabel}
                              style={{ left: `${(nowX / WIDTH) * 100}%` }}
                              aria-hidden="true"
                            >
                              {t('quota_management.pool_now')}
                            </span>
                            <i
                              className={styles.current}
                              style={{
                                left: `${(nowX / WIDTH) * 100}%`,
                                top: `${((20 + HEIGHT - ((pool.remaining ?? 0) / pool.capacity) * HEIGHT) / (HEIGHT + 40)) * 100}%`,
                              }}
                              aria-hidden="true"
                            />
                          </>
                        )}
                        {pool.points
                          .filter(
                            (point) =>
                              point.restored > 0 && point.atMs >= startMs && point.atMs < endMs
                          )
                          .map((point, index) => (
                            <span
                              key={point.atMs}
                              className={styles.resetLabel}
                              data-first={index === 0}
                              style={{
                                left: `${((point.atMs - startMs) / (endMs - startMs)) * 100}%`,
                                top: `${((20 + HEIGHT - (point.remaining / pool.capacity) * HEIGHT) / (HEIGHT + 40)) * 100}%`,
                              }}
                              aria-hidden="true"
                            >
                              +{percent(point.restored)}
                            </span>
                          ))}
                      </div>
                      <div className={styles.xAxis} aria-hidden="true">
                        {ticks.map((at) => (
                          <span
                            key={at}
                            style={{ left: `${((at - startMs) / (endMs - startMs)) * 100}%` }}
                          >
                            {tickFormat.format(at)}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className={styles.empty} role="status">
                    {busy
                      ? t('quota_management.pool_loading')
                      : loaded === 0
                        ? t('quota_management.pool_load_prompt')
                        : pool.remaining !== null
                          ? t('quota_management.pool_no_range')
                          : t('quota_management.pool_no_window')}
                    {errors > 0 && (
                      <span className={styles.error}>
                        {t('quota_management.meta_attention', { count: errors })}
                      </span>
                    )}
                    <button type="button" onClick={() => setAccounts(true)}>
                      {t('quota_management.pool_account_details')}
                    </button>
                  </div>
                )}
                <footer className={styles.legend}>
                  <span>
                    <i className={styles.dot} />
                    {t('quota_management.pool_snapshot')}
                  </span>
                  <span>
                    <i className={styles.dash} />
                    {t('quota_management.pool_projection')}
                  </span>
                  <span className={styles.noHistory}>{t('quota_management.pool_no_history')}</span>
                </footer>
              </section>
            );
          })}
        </>
      )}
    </div>
  );
}
