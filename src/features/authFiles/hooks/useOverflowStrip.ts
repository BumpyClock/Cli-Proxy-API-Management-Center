import { useEffect, useState, type RefObject } from 'react';
import { overflowEdges, scrollLeftToReveal, type OverflowEdges } from '../overflowEdges';

/** Fade width in px; the strip styles use the same value for the mask and scroll padding. */
export const OVERFLOW_FADE_PX = 28;
const ACTIVE_ITEM_SELECTOR = '[aria-pressed="true"], [aria-current="page"]';

/**
 * Tracks which edges of a horizontal strip hide items (for the edge fade) and scrolls the
 * active item into view whenever `activeKey` or the item set changes.
 */
export function useOverflowStrip(
  ref: RefObject<HTMLElement | null>,
  activeKey: string,
  layoutKey: string
): OverflowEdges {
  const [edges, setEdges] = useState<OverflowEdges>('none');

  useEffect(() => {
    const strip = ref.current;
    if (!strip) return;
    const update = () => setEdges(overflowEdges(strip));
    update();
    strip.addEventListener('scroll', update, { passive: true });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(strip);
    Array.from(strip.children).forEach((child) => observer?.observe(child));
    return () => {
      strip.removeEventListener('scroll', update);
      observer?.disconnect();
    };
  }, [ref, layoutKey]);

  useEffect(() => {
    const strip = ref.current;
    const active = strip?.querySelector<HTMLElement>(ACTIVE_ITEM_SELECTOR);
    if (!strip || !active) return;
    // Set scrollLeft directly: scrollIntoView could also scroll the page vertically.
    const next = scrollLeftToReveal(active, strip, OVERFLOW_FADE_PX);
    if (next !== null) strip.scrollLeft = next;
  }, [ref, activeKey, layoutKey]);

  return edges;
}
