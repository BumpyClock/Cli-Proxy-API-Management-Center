/**
 * Pure geometry for horizontally scrolling tab strips: which edges hide more items,
 * and where to scroll so a chosen item is fully visible. React-free for unit tests.
 */

export type OverflowEdges = 'none' | 'start' | 'end' | 'both';

type StripMetrics = { scrollLeft: number; scrollWidth: number; clientWidth: number };
type ItemMetrics = { offsetLeft: number; offsetWidth: number };

/** Sub-pixel layouts report fractional overflow; ignore anything below this many pixels. */
const EDGE_TOLERANCE = 2;

export function overflowEdges({
  scrollLeft,
  scrollWidth,
  clientWidth,
}: StripMetrics): OverflowEdges {
  const maxScroll = scrollWidth - clientWidth;
  if (maxScroll <= EDGE_TOLERANCE) return 'none';
  const hiddenStart = scrollLeft > EDGE_TOLERANCE;
  const hiddenEnd = scrollLeft < maxScroll - EDGE_TOLERANCE;
  if (hiddenStart && hiddenEnd) return 'both';
  if (hiddenStart) return 'start';
  return hiddenEnd ? 'end' : 'none';
}

/**
 * Returns the scrollLeft that reveals `item` clear of the faded edges, or null when it is
 * already visible. `inset` matches the fade width so the item is not left under the fade.
 */
export function scrollLeftToReveal(
  item: ItemMetrics,
  strip: StripMetrics,
  inset: number
): number | null {
  const maxScroll = Math.max(0, strip.scrollWidth - strip.clientWidth);
  const visibleStart = strip.scrollLeft + inset;
  const visibleEnd = strip.scrollLeft + strip.clientWidth - inset;
  const itemEnd = item.offsetLeft + item.offsetWidth;
  let next: number | null = null;
  if (item.offsetLeft < visibleStart) next = item.offsetLeft - inset;
  else if (itemEnd > visibleEnd) next = itemEnd - strip.clientWidth + inset;
  if (next === null) return null;
  return Math.max(0, Math.min(maxScroll, Math.round(next)));
}
