import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { animate } from 'motion/mini';
import { actionBarMotion } from '@/design-system';
import { Button } from '@/components/ui/Button';
import { prefersReducedMotion } from '@/hooks/motion';
import { useActionBarHeightVar } from '@/hooks/useActionBarHeightVar';
import styles from './BatchActionBar.module.scss';

const BASE_TRANSFORM = 'translateX(-50%)';
const HIDDEN_TRANSFORM = `translateX(-50%) translateY(${actionBarMotion.hiddenOffset}px)`;

export type BatchActionBarProps = {
  selectionCount: number;
  selectablePageCount: number;
  selectableFilteredCount: number;
  disableControls: boolean;
  batchStatusDisabled: boolean;
  onSelectPage: () => void;
  onSelectFiltered: () => void;
  onInvertPage: () => void;
  onDeselectAll: () => void;
  onDownload: () => void;
  onEnable: () => void;
  onDisable: () => void;
  onDelete: () => void;
};

/**
 * 悬浮批量操作条：portal 到 body 的玻璃工具栏。
 * - 选中数 >0 时上浮入场（强减速），清零后加速退场再卸载（时长与曲线见 actionBarMotion）；
 * - reduced-motion 下只做透明度淡入淡出（保留 translateX(-50%) 基础变换，防止错位半宽）；
 * - 实时高度写入 --auth-files-action-bar-height 供页面底部留白。
 */
export function BatchActionBar(props: BatchActionBarProps) {
  const {
    selectionCount,
    selectablePageCount,
    selectableFilteredCount,
    disableControls,
    batchStatusDisabled,
    onSelectPage,
    onSelectFiltered,
    onInvertPage,
    onDeselectAll,
    onDownload,
    onEnable,
    onDisable,
    onDelete,
  } = props;
  const { t } = useTranslation();

  const [visible, setVisible] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const animationRef = useRef<ReturnType<typeof animate> | null>(null);
  const selectionCountRef = useRef(selectionCount);
  const previousCountRef = useRef(0);

  useActionBarHeightVar(containerRef, '--auth-files-action-bar-height', visible);

  useEffect(() => {
    selectionCountRef.current = selectionCount;
    if (selectionCount > 0) {
      setVisible(true);
    }
  }, [selectionCount]);

  useLayoutEffect(() => {
    if (!visible) return;
    const currentCount = selectionCount;
    const previousCount = previousCountRef.current;
    const el = containerRef.current;
    if (!el) return;

    animationRef.current?.stop();
    animationRef.current = null;

    const reduced = prefersReducedMotion();

    if (currentCount > 0 && previousCount === 0) {
      if (reduced) {
        el.style.transform = BASE_TRANSFORM;
        animationRef.current = animate(
          el,
          { opacity: [0, 1] },
          {
            ...actionBarMotion.reducedEnter,
            onComplete: () => {
              el.style.opacity = '1';
            },
          }
        );
      } else {
        animationRef.current = animate(
          el,
          { transform: [HIDDEN_TRANSFORM, BASE_TRANSFORM], opacity: [0, 1] },
          {
            ...actionBarMotion.enter,
            onComplete: () => {
              el.style.transform = BASE_TRANSFORM;
              el.style.opacity = '1';
            },
          }
        );
      }
    } else if (currentCount === 0 && previousCount > 0) {
      const finishExit = () => {
        if (selectionCountRef.current === 0) {
          setVisible(false);
        }
      };
      if (reduced) {
        el.style.transform = BASE_TRANSFORM;
        animationRef.current = animate(
          el,
          { opacity: [1, 0] },
          { ...actionBarMotion.reducedExit, onComplete: finishExit }
        );
      } else {
        animationRef.current = animate(
          el,
          { transform: [BASE_TRANSFORM, HIDDEN_TRANSFORM], opacity: [1, 0] },
          { ...actionBarMotion.exit, onComplete: finishExit }
        );
      }
    }

    previousCountRef.current = currentCount;
  }, [visible, selectionCount]);

  useEffect(
    () => () => {
      animationRef.current?.stop();
      animationRef.current = null;
    },
    []
  );

  if (!visible || typeof document === 'undefined') return null;

  return createPortal(
    <div className={styles.container} ref={containerRef}>
      <div
        className={styles.bar}
        role="toolbar"
        aria-label={t('auth_files.batch_toolbar_label')}
        aria-orientation="horizontal"
      >
        <div className={styles.left}>
          <span className={styles.count} aria-live="polite">
            {t('auth_files.batch_selected', { count: selectionCount })}
          </span>
          <Button
            variant="secondary"
            size="sm"
            onClick={onSelectPage}
            disabled={selectablePageCount === 0}
          >
            {t('auth_files.batch_select_page')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={onSelectFiltered}
            disabled={selectableFilteredCount === 0}
          >
            {t('auth_files.batch_select_filtered')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onInvertPage}
            disabled={selectablePageCount === 0}
          >
            {t('auth_files.batch_invert_page')}
          </Button>
          <Button variant="ghost" size="sm" onClick={onDeselectAll}>
            {t('auth_files.batch_deselect')}
          </Button>
        </div>
        <div className={styles.right}>
          <Button
            variant="secondary"
            size="sm"
            onClick={onDownload}
            disabled={disableControls || selectionCount === 0}
          >
            {t('auth_files.batch_download')}
          </Button>
          <Button size="sm" onClick={onEnable} disabled={batchStatusDisabled}>
            {t('auth_files.batch_enable')}
          </Button>
          <Button variant="secondary" size="sm" onClick={onDisable} disabled={batchStatusDisabled}>
            {t('auth_files.batch_disable')}
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={onDelete}
            disabled={disableControls || selectionCount === 0}
          >
            {t('common.delete')}
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
}
