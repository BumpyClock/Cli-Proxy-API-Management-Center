import { useEffect, useId, useRef, useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/Input';
import { NativeSelect } from '@/components/ui/NativeSelect';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { IconSearch, IconSlidersHorizontal } from '@/components/ui/icons';
import { MAX_CARD_PAGE_SIZE, MIN_CARD_PAGE_SIZE } from '@/features/authFiles/constants';
import type { ViewOptionsSummary } from '@/features/authFiles/logic';
import type { AuthFilesSortMode, AuthFilesStatusFilterMode } from '@/features/authFiles/uiState';
import styles from './AuthFilesToolbar.module.scss';
import { iconSize } from '@/design-system';

export type AuthFilesToolbarProps = {
  search: string;
  onSearchChange: (value: string) => void;
  statusFilterMode: AuthFilesStatusFilterMode;
  statusFilterOptions: Array<{ value: AuthFilesStatusFilterMode; label: string }>;
  onStatusFilterChange: (mode: AuthFilesStatusFilterMode) => void;
  sortMode: AuthFilesSortMode;
  sortOptions: Array<{ value: string; label: string }>;
  onSortModeChange: (value: string) => void;
  pageSizeInput: string;
  onPageSizeInputChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onPageSizeCommit: (rawValue: string) => void;
  compactMode: boolean;
  onCompactModeChange: (value: boolean) => void;
  viewOptions: ViewOptionsSummary;
};

/**
 * Search, status filter and one labelled "View options" panel holding sort, page size and
 * compact mode. The trigger counts options that differ from their defaults, so a changed sort
 * order never hides behind the closed panel.
 */
export function AuthFilesToolbar(props: AuthFilesToolbarProps) {
  const {
    search,
    onSearchChange,
    statusFilterMode,
    statusFilterOptions,
    onStatusFilterChange,
    sortMode,
    sortOptions,
    onSortModeChange,
    pageSizeInput,
    onPageSizeInputChange,
    onPageSizeCommit,
    compactMode,
    onCompactModeChange,
    viewOptions,
  } = props;
  const { t } = useTranslation();
  const [optionsOpen, setOptionsOpen] = useState(false);
  const optionsRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchHintId = useId();
  const panelId = useId();
  const pageSizeId = useId();

  useEffect(() => {
    if (!optionsOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!optionsRef.current?.contains(event.target as Node)) setOptionsOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOptionsOpen(false);
      triggerRef.current?.focus();
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [optionsOpen]);

  return (
    <div className={styles.toolbar}>
      <div className={styles.searchField}>
        <Input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={t('auth_files.search_placeholder')}
          aria-label={t('auth_files.search_label')}
          aria-describedby={searchHintId}
          rightElement={<IconSearch className={styles.searchIcon} size={iconSize['16']} />}
        />
        <p id={searchHintId} className={styles.searchHint}>
          {t('auth_files.search_hint')}
        </p>
      </div>

      <div className={styles.status}>
        <SegmentedControl
          options={statusFilterOptions.map((option) => ({
            ...option,
            tone: option.value === 'problem' ? ('danger' as const) : undefined,
          }))}
          value={statusFilterMode}
          onChange={onStatusFilterChange}
          ariaLabel={t('auth_files.problem_filter_label')}
          fullWidth
        />
      </div>

      <div
        className={styles.options}
        ref={optionsRef}
        onBlur={(event) => {
          const next = event.relatedTarget as Node | null;
          if (next && !optionsRef.current?.contains(next)) setOptionsOpen(false);
        }}
      >
        <button
          ref={triggerRef}
          type="button"
          className={styles.optionsTrigger}
          aria-expanded={optionsOpen}
          aria-controls={panelId}
          onClick={() => setOptionsOpen((open) => !open)}
        >
          <IconSlidersHorizontal size={iconSize['15']} aria-hidden="true" />
          <span>{t('auth_files.display_options_label')}</span>
          {viewOptions.changedCount > 0 && (
            <>
              <span className={styles.changedBadge} aria-hidden="true">
                {viewOptions.changedCount}
              </span>
              <span className={styles.srOnly}>
                {`, ${t('auth_files.view_options_changed', { count: viewOptions.changedCount })}`}
              </span>
            </>
          )}
        </button>

        <div
          id={panelId}
          className={styles.panel}
          role="group"
          aria-label={t('auth_files.display_options_label')}
          hidden={!optionsOpen}
        >
          <NativeSelect
            className={styles.panelRow}
            label={t('auth_files.sort_label')}
            value={sortMode}
            options={sortOptions}
            onChange={onSortModeChange}
          />
          <div className={styles.panelRow}>
            <label htmlFor={pageSizeId}>{t('auth_files.page_size_label')}</label>
            <input
              id={pageSizeId}
              className={styles.pageSizeInput}
              type="number"
              inputMode="numeric"
              min={MIN_CARD_PAGE_SIZE}
              max={MAX_CARD_PAGE_SIZE}
              step={1}
              value={pageSizeInput}
              onChange={onPageSizeInputChange}
              onBlur={(e) => onPageSizeCommit(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
              }}
            />
          </div>
          <div className={styles.panelRow}>
            <span>{t('auth_files.compact_mode_label')}</span>
            <ToggleSwitch
              checked={compactMode}
              onChange={onCompactModeChange}
              ariaLabel={t('auth_files.compact_mode_label')}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
