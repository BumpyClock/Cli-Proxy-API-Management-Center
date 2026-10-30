/**
 * Open modal surfaces (sheets and modals), bottom to top.
 *
 * - Only the top surface should handle Tab and Escape (`isTop`).
 * - The app shell (`[data-app-shell]`) and every surface beneath the top are
 *   inert, so keyboard and assistive-technology users stay on the active surface.
 * - Focus returns to the element that opened a surface once it closes. When that
 *   element is gone (for example a sheet that closed together with its
 *   confirmation), focus falls back to the opener of the surface beneath.
 */
interface SurfaceEntry {
  id: number;
  element: () => HTMLElement | null;
  /** Restore candidates, most specific first. */
  openers: HTMLElement[];
}

export interface ModalSurface {
  isTop: () => boolean;
  release: () => void;
}

const stack: SurfaceEntry[] = [];
let nextId = 0;

const setInert = (element: HTMLElement | null | undefined, inert: boolean) => {
  if (!element) return;
  if (inert) element.setAttribute('inert', '');
  else element.removeAttribute('inert');
};

function syncInert(): void {
  setInert(document.querySelector<HTMLElement>('[data-app-shell]'), stack.length > 0);
  stack.forEach((entry, index) => setInert(entry.element(), index < stack.length - 1));
}

function focusFirstAvailable(candidates: HTMLElement[]): boolean {
  for (const candidate of candidates) {
    if (!candidate.isConnected || candidate.closest('[inert]')) continue;
    candidate.focus({ preventScroll: true });
    if (document.activeElement === candidate) return true;
  }
  return false;
}

export function openModalSurface(element: () => HTMLElement | null): ModalSurface {
  if (typeof document === 'undefined') return { isTop: () => true, release: () => {} };
  const id = ++nextId;
  const opener = document.activeElement;
  const entry: SurfaceEntry = {
    id,
    element,
    openers: opener instanceof HTMLElement && opener !== document.body ? [opener] : [],
  };
  stack.push(entry);
  syncInert();
  let released = false;

  return {
    isTop: () => stack[stack.length - 1]?.id === id,
    release: () => {
      if (released) return;
      released = true;
      const index = stack.findIndex((item) => item.id === id);
      if (index === -1) return;
      const wasTop = index === stack.length - 1;
      stack.splice(index, 1);
      setInert(element(), false);
      syncInert();
      if (!wasTop) {
        // A covered surface closed first: the surface above inherits its openers.
        stack[index]?.openers.push(...entry.openers);
        return;
      }
      if (focusFirstAvailable(entry.openers)) return;
      const nextTop = stack[stack.length - 1]?.element();
      nextTop?.focus({ preventScroll: true });
    },
  };
}
