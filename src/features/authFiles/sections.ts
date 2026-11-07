/** Auth Files sections and their routes, in display order. */
export const AUTH_FILES_SECTIONS = [
  ['/auth-files', 'credentials'],
  ['/auth-files/oauth-excluded', 'disablement'],
  ['/auth-files/oauth-model-alias', 'aliases'],
] as const;

/** Route of the section that owns `pathname`; editor sub-routes map to their section. */
export const activeAuthFilesSection = (pathname: string): string =>
  [...AUTH_FILES_SECTIONS]
    .reverse()
    .find(([to]) => pathname === to || pathname.startsWith(`${to}/`))?.[0] ?? '/auth-files';
