import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconChevronDown, IconSlidersHorizontal } from '@/components/ui/icons';
import { Select } from '@/components/ui/Select';
import { SelectionCheckbox } from '@/components/ui/SelectionCheckbox';
import type { ProviderSortBy, SortDir } from '../types';
import styles from './ProviderResourceToolbar.module.scss';
import { iconSize, iconStroke } from '@/design-system';

/** Short visible direction words: alphabetical for names, low/high for numeric sorts. */
const DIRECTION_LABEL_KEYS: Record<'alpha' | 'value', Record<SortDir, string>> = {
  alpha: {
    asc: 'providersPage.toolbar.sort.dirAlphaAsc',
    desc: 'providersPage.toolbar.sort.dirAlphaDesc',
  },
  value: {
    asc: 'providersPage.toolbar.sort.dirValueAsc',
    desc: 'providersPage.toolbar.sort.dirValueDesc',
  },
};

const getSortDirectionLabelKey = (sortBy: ProviderSortBy, sortDir: SortDir): string =>
  DIRECTION_LABEL_KEYS[sortBy === 'name' ? 'alpha' : 'value'][sortDir];

function SortDirectionIcon({ dir }: { dir: SortDir }) {
  const paths =
    dir === 'asc'
      ? ['m3 8 4-4 4 4', 'M7 4v16', 'M11 12h4', 'M11 16h7', 'M11 20h10']
      : ['m3 16 4 4 4-4', 'M7 20V4', 'M11 4h10', 'M11 8h7', 'M11 12h4'];
  return (
    <svg
      width={iconSize['14']}
      height={iconSize['14']}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={iconStroke.default}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {paths.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

interface ProviderResourceToolbarProps {
  sortBy: ProviderSortBy;
  sortDir: SortDir;
  onSortBy: (value: ProviderSortBy) => void;
  onSortDir: (value: SortDir) => void;
  availableModels: ReadonlyArray<string>;
  selectedModels: ReadonlySet<string>;
  onSelectedModelsChange: (next: Set<string>) => void;
}

export function ProviderResourceToolbar({
  sortBy,
  sortDir,
  onSortBy,
  onSortDir,
  availableModels,
  selectedModels,
  onSelectedModelsChange,
}: ProviderResourceToolbarProps) {
  const { t } = useTranslation();
  const [filterOpen, setFilterOpen] = useState(false);
  const sortLabelId = useId();
  const containerRef = useRef<HTMLDivElement>(null);

  const sortOptions = useMemo(
    () => [
      { value: 'name', label: t('providersPage.toolbar.sort.name') },
      { value: 'priority', label: t('providersPage.toolbar.sort.priority') },
      {
        value: 'recent-success',
        label: t('providersPage.toolbar.sort.recentSuccess'),
      },
    ],
    [t]
  );

  useEffect(() => {
    if (!filterOpen) return;
    const onClickOutside = (e: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setFilterOpen(false);
      }
    };
    document.addEventListener('pointerdown', onClickOutside);
    return () => document.removeEventListener('pointerdown', onClickOutside);
  }, [filterOpen]);

  const toggleModel = (name: string) => {
    const next = new Set(selectedModels);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    onSelectedModelsChange(next);
  };

  const selectAll = () => onSelectedModelsChange(new Set(availableModels));
  const clearAll = () => onSelectedModelsChange(new Set());

  const filterLabel =
    selectedModels.size === 0
      ? t('providersPage.toolbar.filter.allModels')
      : t('providersPage.toolbar.filter.selectedModels', {
          selected: selectedModels.size,
          total: availableModels.length,
        });

  const sortFieldLabel =
    sortOptions.find((option) => option.value === sortBy)?.label ?? sortOptions[0].label;
  const directionName = t('providersPage.toolbar.sort.directionButton', {
    field: sortFieldLabel,
    direction:
      sortDir === 'asc'
        ? t('providersPage.toolbar.sort.directionAsc')
        : t('providersPage.toolbar.sort.directionDesc'),
  });

  return (
    <div className={styles.root}>
      <div className={styles.sortGroup}>
        <span className={styles.label} id={sortLabelId}>
          {t('providersPage.toolbar.sortBy')}
        </span>
        <Select
          value={sortBy}
          options={sortOptions}
          onChange={(value) => onSortBy(value as ProviderSortBy)}
          ariaLabelledBy={sortLabelId}
          size="sm"
        />
        <button
          type="button"
          className={styles.dirBtn}
          onClick={() => onSortDir(sortDir === 'asc' ? 'desc' : 'asc')}
          aria-label={directionName}
          title={directionName}
          data-sort-dir={sortDir}
        >
          <SortDirectionIcon dir={sortDir} />
          <span>{t(getSortDirectionLabelKey(sortBy, sortDir))}</span>
        </button>
      </div>

      <div className={styles.filterGroup} ref={containerRef}>
        <button
          type="button"
          className={styles.filterTrigger}
          onClick={() => setFilterOpen((v) => !v)}
          disabled={availableModels.length === 0}
        >
          <IconSlidersHorizontal size={iconSize['14']} />
          <span>{filterLabel}</span>
          <IconChevronDown size={iconSize['12']} />
        </button>
        {filterOpen ? (
          <div className={styles.filterPanel}>
            <div className={styles.filterToolbar}>
              <button
                type="button"
                className={styles.filterToolbarBtn}
                onClick={selectAll}
                disabled={availableModels.length === 0}
              >
                {t('providersPage.toolbar.filter.selectAll')}
              </button>
              <button
                type="button"
                className={styles.filterToolbarBtn}
                onClick={clearAll}
                disabled={selectedModels.size === 0}
              >
                {t('providersPage.toolbar.filter.clear')}
              </button>
            </div>
            {availableModels.length === 0 ? (
              <div className={styles.filterEmpty}>{t('providersPage.toolbar.filter.empty')}</div>
            ) : (
              <ul className={styles.filterList}>
                {availableModels.map((name) => (
                  <li key={name} className={styles.filterItem}>
                    <SelectionCheckbox
                      checked={selectedModels.has(name)}
                      onChange={() => toggleModel(name)}
                      label={<span className={styles.filterItemLabel}>{name}</span>}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
