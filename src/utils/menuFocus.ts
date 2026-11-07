/** Roving focus target for a menu: index to focus next, or null when the key is not handled. */
export const menuFocusTarget = (key: string, index: number, count: number): number | null => {
  if (count === 0) return null;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  if (key === 'ArrowDown') return index < 0 ? 0 : (index + 1) % count;
  if (key === 'ArrowUp') return index < 0 ? count - 1 : (index - 1 + count) % count;
  return null;
};
