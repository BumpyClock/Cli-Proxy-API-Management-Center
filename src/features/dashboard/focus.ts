/**
 * After an async action whose control can unmount on success (Retry on a source that
 * recovers), keep keyboard users in place: if focus fell back to the page, move it to
 * the heading of the region that now shows the result.
 */
export function restoreFocusIfLost(targetId: string): void {
  // A short timeout (not rAF, which stalls in background tabs) lets the data update commit.
  window.setTimeout(() => {
    const active = document.activeElement;
    if (active && active !== document.body) return;
    document.getElementById(targetId)?.focus();
  }, 60);
}
