import { useEffect, useLayoutEffect, useRef } from 'react';

/**
 * Keeps keyboard users in place when a poll or a Retry removes the control they are on.
 *
 * Regions opt in with `data-focus-rescue="<heading id>"`. When the focused element inside
 * such a region leaves the DOM and focus has fallen back to the page, focus moves to that
 * heading, which now describes the result, and the heading is scrolled into view (the
 * scroll containers' scroll-padding keeps it clear of the floating header). Focus the user
 * placed elsewhere is left alone.
 * Call it from the page that renders the regions; the check runs after every render.
 */
export function useFocusRescue(): void {
  const lastRef = useRef<{ element: HTMLElement; targetId: string } | null>(null);

  useEffect(() => {
    const onFocusIn = (event: FocusEvent) => {
      const element = event.target instanceof HTMLElement ? event.target : null;
      const targetId = element?.closest<HTMLElement>('[data-focus-rescue]')?.dataset.focusRescue;
      lastRef.current = element && targetId ? { element, targetId } : null;
    };
    document.addEventListener('focusin', onFocusIn);
    return () => document.removeEventListener('focusin', onFocusIn);
  }, []);

  useLayoutEffect(() => {
    const last = lastRef.current;
    if (!last || last.element.isConnected) return;
    lastRef.current = null;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    const target = document.getElementById(last.targetId);
    if (!target) return;
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: 'nearest' });
  });
}
