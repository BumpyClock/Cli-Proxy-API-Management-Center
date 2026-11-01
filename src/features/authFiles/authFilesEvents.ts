export const AUTH_FILES_CHANGED_EVENT = 'auth-files-changed';

export const notifyAuthFilesChanged = () => {
  window.dispatchEvent(new Event(AUTH_FILES_CHANGED_EVENT));
};

/**
 * A fresh credential count from a page that already polls `/auth-files` (the dashboard),
 * so the sidebar badge never contradicts it. `null` means unknown: the badge hides.
 */
export const AUTH_FILES_COUNT_EVENT = 'auth-files-count';

export interface AuthFilesCountDetail {
  count: number | null;
}

export const publishAuthFilesCount = (count: number | null) => {
  window.dispatchEvent(
    new CustomEvent<AuthFilesCountDetail>(AUTH_FILES_COUNT_EVENT, { detail: { count } })
  );
};
