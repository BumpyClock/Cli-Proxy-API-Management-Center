import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { IconChevronDown, IconEye, IconPencil, IconTrash2 } from '@/components/ui/icons';
import { menuFocusTarget } from '@/utils/menuFocus';
import styles from './ProviderRowActions.module.scss';

const MENU_OFFSET = 6;
// Measured before it is placed. Opacity, not visibility: hidden items cannot take focus, and
// `.btn` transitions would keep them hidden past the first frame.
const UNPOSITIONED_STYLE: CSSProperties = { top: 0, right: 0, opacity: 0, pointerEvents: 'none' };
const VIEWPORT_MARGIN = 8;

/**
 * Right-aligned under the trigger, flipped above it when the viewport has no room below.
 * Fixed and portalled, because the table scrolls inside an overflow container.
 */
const resolveMenuStyle = (trigger: HTMLElement, menuHeight: number): CSSProperties => {
  const rect = trigger.getBoundingClientRect();
  const right = Math.max(VIEWPORT_MARGIN, window.innerWidth - rect.right);
  const fitsBelow = rect.bottom + MENU_OFFSET + menuHeight + VIEWPORT_MARGIN <= window.innerHeight;
  return fitsBelow || rect.top < menuHeight + MENU_OFFSET + VIEWPORT_MARGIN
    ? { top: rect.bottom + MENU_OFFSET, right }
    : { bottom: window.innerHeight - rect.top + MENU_OFFSET, right };
};

interface ProviderRowActionItemsProps {
  disableMutations: boolean;
  onView: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

/** Menu items, in order; the destructive action sits apart after a separator. */
export function ProviderRowActionItems({
  disableMutations,
  onView,
  onEdit,
  onDelete,
}: ProviderRowActionItemsProps) {
  const { t } = useTranslation();
  return (
    <>
      <Button variant="ghost" role="menuitem" tabIndex={-1} onClick={onView}>
        <IconEye size={15} aria-hidden="true" />
        {t('redesign.providers.menuViewDetails')}
      </Button>
      <Button
        variant="ghost"
        role="menuitem"
        tabIndex={-1}
        disabled={disableMutations}
        onClick={onEdit}
      >
        <IconPencil size={15} aria-hidden="true" />
        {t('providersPage.actions.edit')}
      </Button>
      <span className={styles.separator} role="separator" />
      <Button
        variant="ghost"
        role="menuitem"
        tabIndex={-1}
        className={styles.danger}
        disabled={disableMutations}
        onClick={onDelete}
      >
        <IconTrash2 size={15} aria-hidden="true" />
        {t('providersPage.actions.delete')}
      </Button>
    </>
  );
}

interface ProviderRowActionsProps {
  /** Visible, non-secret resource name for accessible labels. */
  name: string;
  disableMutations?: boolean;
  onView: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

export function ProviderRowActions({
  name,
  disableMutations = false,
  onView,
  onEdit,
  onDelete,
}: ProviderRowActionsProps) {
  const { t } = useTranslation();
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // First item for click/Enter/ArrowDown, last for ArrowUp.
  const openFocusRef = useRef<'first' | 'last'>('first');
  const pendingFocusRef = useRef(false);
  const label = t('redesign.providers.rowActions', { name });

  const menuItems = () =>
    Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? []
    );

  const openMenu = (focus: 'first' | 'last') => {
    openFocusRef.current = focus;
    pendingFocusRef.current = true;
    setOpen(true);
  };
  const closeMenu = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    setMenuStyle(null);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  const position = useCallback(() => {
    if (!triggerRef.current || !menuRef.current) return;
    setMenuStyle(resolveMenuStyle(triggerRef.current, menuRef.current.offsetHeight));
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    position();
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    return () => {
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', position, true);
    };
  }, [open, position]);

  // Focus the first (or last) item once the positioned menu is visible.
  useEffect(() => {
    if (!menuStyle || !pendingFocusRef.current) return;
    pendingFocusRef.current = false;
    const items = menuItems();
    (openFocusRef.current === 'last' ? items[items.length - 1] : items[0])?.focus();
  }, [menuStyle]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      closeMenu(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [closeMenu, open]);

  const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      openMenu(event.key === 'ArrowUp' ? 'last' : 'first');
    }
  };

  const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeMenu(true);
      return;
    }
    // Tab leaves from the trigger, so focus continues to the control after the row's menu.
    if (event.key === 'Tab') {
      closeMenu(true);
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

  // Focus returns to the trigger before the action runs, so the sheet or confirmation it opens
  // restores focus to a visible control.
  const run = (action: () => void) => () => {
    closeMenu(true);
    action();
  };

  const menu = open ? (
    <div
      ref={menuRef}
      id={menuId}
      role="menu"
      aria-label={label}
      className={styles.menu}
      style={menuStyle ?? UNPOSITIONED_STYLE}
      onKeyDown={handleMenuKeyDown}
    >
      <ProviderRowActionItems
        disableMutations={disableMutations}
        onView={run(onView)}
        onEdit={run(onEdit)}
        onDelete={run(onDelete)}
      />
    </div>
  ) : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={label}
        onClick={() => (open ? closeMenu(false) : openMenu('first'))}
        onKeyDown={handleTriggerKeyDown}
      >
        <span>{t('providersPage.table.actions')}</span>
        <IconChevronDown className={styles.chevron} size={14} aria-hidden="true" />
      </button>
      {menu && typeof document !== 'undefined' ? createPortal(menu, document.body) : null}
    </>
  );
}
