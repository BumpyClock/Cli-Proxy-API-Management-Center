import { useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { IconInfo } from '@/components/ui/icons';
import { useActionBarHeightVar } from '@/hooks/useActionBarHeightVar';
import styles from './OAuthEditorActions.module.scss';

/** Page bottom padding and scroll padding read this, so no field or focus hides under the bar. */
export const OAUTH_EDITOR_ACTIONS_HEIGHT_VAR = '--oauth-editor-actions-height';

interface OAuthEditorActionsProps {
  children: ReactNode;
  /** Why Save is unavailable; Save references `id` with aria-describedby. */
  reason?: { id: string; text: string };
}

/**
 * Back and Save for the OAuth rule editors, in one floating bar at the bottom of the content
 * column at every width (the same portal pattern as the Auth Files batch bar and the Config
 * save bar). Save stays in reach while the user works through a long rule list or on a phone.
 */
export function OAuthEditorActions({ children, reason }: OAuthEditorActionsProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement | null>(null);
  useActionBarHeightVar(containerRef, OAUTH_EDITOR_ACTIONS_HEIGHT_VAR, true);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className={styles.container} ref={containerRef}>
      <div className={styles.bar} role="group" aria-label={t('redesign.authFiles.editorActions')}>
        {reason && (
          <p id={reason.id} className={styles.reason}>
            <IconInfo size={14} aria-hidden="true" />
            <span>{reason.text}</span>
          </p>
        )}
        {children}
      </div>
    </div>,
    document.body
  );
}
