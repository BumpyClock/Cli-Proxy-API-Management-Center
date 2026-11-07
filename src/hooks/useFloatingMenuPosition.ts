import { useCallback, useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react';
import { space } from '@/design-system';

const GAP = space['6'];
const MARGIN = space['8'];

// Keep items focusable while measuring without flashing an unpositioned menu.
export const UNPOSITIONED_MENU_STYLE: CSSProperties = {
  top: 0,
  right: 0,
  opacity: 0,
  pointerEvents: 'none',
};

export function resolveFloatingMenuPosition(
  trigger: Pick<DOMRect, 'top' | 'bottom' | 'right'>,
  menu: { width: number; height: number },
  viewport: { width: number; height: number }
): CSSProperties {
  const clamp = (value: number, max: number) => Math.max(0, Math.min(value, max));
  const available = Math.max(0, viewport.height - MARGIN * 2);
  const below = clamp(viewport.height - trigger.bottom - GAP - MARGIN, available);
  const above = clamp(trigger.top - GAP - MARGIN, available);
  const placeBelow = menu.height <= below || below >= above;
  const right = Math.max(
    MARGIN,
    Math.min(viewport.width - trigger.right, viewport.width - menu.width - MARGIN)
  );
  return {
    right,
    maxHeight: placeBelow ? below : above,
    ...(placeBelow
      ? { top: Math.max(MARGIN, Math.min(trigger.bottom + GAP, viewport.height - MARGIN)) }
      : {
          bottom: Math.max(
            MARGIN,
            Math.min(viewport.height - trigger.top + GAP, viewport.height - MARGIN)
          ),
        }),
  };
}

/** Position a body-portalled menu, including after scrolling or resizing its anchor. */
export function useFloatingMenuPosition(
  open: boolean,
  triggerRef: RefObject<HTMLElement | null>,
  menuRef: RefObject<HTMLElement | null>
): CSSProperties | null {
  const [style, setStyle] = useState<CSSProperties | null>(null);
  const position = useCallback(() => {
    const trigger = triggerRef.current;
    const menu = menuRef.current;
    if (!trigger || !menu) return;
    setStyle(
      resolveFloatingMenuPosition(
        trigger.getBoundingClientRect(),
        {
          width: menu.offsetWidth,
          height: menu.scrollHeight + menu.offsetHeight - menu.clientHeight,
        },
        { width: window.innerWidth, height: window.innerHeight }
      )
    );
  }, [menuRef, triggerRef]);

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

  return open ? style : null;
}
