import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { IconChevronLeft, IconFilterAll } from '@/components/ui/icons';
import { NativeSelect } from '@/components/ui/NativeSelect';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import {
  getAuthFileIcon,
  getThemeSurfaceIconBackground,
  getTypeLabel,
  isThemeSurfaceIconProvider,
  type ResolvedTheme,
} from '@/features/authFiles/constants';
import { useOverflowStrip } from '@/features/authFiles/hooks/useOverflowStrip';
import { scrollProviderTabs } from './providerTabsWheel';
import styles from './ProviderTabs.module.scss';

export type ProviderTabsProps = {
  types: string[];
  counts: Record<string, number>;
  active: string;
  resolvedTheme: ResolvedTheme;
  onChange: (type: string) => void;
};

/**
 * Provider filter. Desktop: one scrollable segmented row with brand icons and counts; the edge
 * that hides providers fades and the active provider stays in view. Phones: a labelled native
 * select listing every provider with its count, so nothing wraps or hides.
 */
export function ProviderTabs({
  types,
  counts,
  active,
  resolvedTheme,
  onChange,
}: ProviderTabsProps) {
  const { t } = useTranslation();
  const tabsRef = useRef<HTMLDivElement>(null);
  const overflow = useOverflowStrip(tabsRef, active, types.join('|'));
  const labelOf = (type: string) =>
    type === 'all' ? t('auth_files.filter_all') : getTypeLabel(t, type);

  useEffect(() => {
    const strip = tabsRef.current;
    if (!strip) return;
    const onWheel = (event: WheelEvent) => scrollProviderTabs(strip, event);
    // React delegates wheel events passively; use a local listener to prevent page scrolling.
    strip.addEventListener('wheel', onWheel, { passive: false });
    return () => strip.removeEventListener('wheel', onWheel);
  }, []);

  const options = types.map((type) => {
    const iconSrc = type === 'all' ? null : getAuthFileIcon(type, resolvedTheme);
    const label = labelOf(type);
    const icon =
      type === 'all' ? (
        <IconFilterAll className={styles.glyph} size={15} />
      ) : (
        <span
          className={styles.iconWrap}
          style={
            isThemeSurfaceIconProvider(type)
              ? { background: getThemeSurfaceIconBackground(resolvedTheme) }
              : undefined
          }
        >
          {iconSrc ? (
            <img src={iconSrc} alt="" className={styles.icon} />
          ) : (
            <span className={styles.iconFallback}>{label.slice(0, 1).toUpperCase()}</span>
          )}
        </span>
      );
    return { value: type, label, count: counts[type] ?? 0, icon };
  });

  return (
    <>
      <div className={styles.strip}>
        <SegmentedControl
          options={options}
          value={active}
          onChange={onChange}
          ariaLabel={t('auth_files.provider_filter_label')}
          scrollable
          className={styles.tabs}
          trackRef={tabsRef}
          dataOverflow={overflow}
        />
        {overflow !== 'none' && (
          <button
            type="button"
            className={styles.more}
            aria-label={t('quota_management.pool_more_providers')}
            onClick={() => {
              const strip = tabsRef.current;
              if (!strip) return;
              const atEnd = strip.scrollLeft + strip.clientWidth >= strip.scrollWidth - 2;
              strip.scrollTo({ left: atEnd ? 0 : strip.scrollLeft + strip.clientWidth * 0.75 });
            }}
          >
            <IconChevronLeft size={16} aria-hidden="true" />
          </button>
        )}
      </div>
      <NativeSelect
        className={styles.picker}
        layout="stacked"
        label={t('auth_files.provider_select_label')}
        value={active}
        onChange={onChange}
        options={types.map((type) => ({
          value: type,
          label: `${labelOf(type)} (${counts[type] ?? 0})`,
        }))}
      />
    </>
  );
}
