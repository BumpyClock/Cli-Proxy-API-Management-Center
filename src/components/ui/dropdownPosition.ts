import type { CSSProperties } from 'react';
import { size, space, z } from '@/design-system';

export function resolveDropdownStyle(
  rect: Pick<DOMRect, 'top' | 'bottom' | 'left' | 'width'>,
  viewportWidth: number,
  viewportHeight: number,
  preferredMaxHeight: number = size['240']
): CSSProperties {
  const margin = space['8'];
  const offset = space['6'];
  const width = Math.min(rect.width, Math.max(0, viewportWidth - margin * 2));
  const left = Math.min(
    Math.max(rect.left, margin),
    Math.max(margin, viewportWidth - width - margin)
  );
  const below = viewportHeight - rect.bottom - margin - offset;
  const above = rect.top - margin - offset;
  const opensDown = below >= preferredMaxHeight || below >= above;
  const maxHeight = Math.max(0, Math.min(preferredMaxHeight, opensDown ? below : above));
  return {
    position: 'fixed',
    left,
    width,
    maxHeight,
    zIndex: z['select-menu'],
    ...(opensDown ? { top: rect.bottom + offset } : { bottom: viewportHeight - rect.top + offset }),
  };
}
