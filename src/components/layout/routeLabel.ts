export const findActiveRoute = <T extends { path: string }>(
  items: T[],
  pathname: string
): T | undefined => {
  const path = pathname === '/dashboard' ? '/' : pathname;
  return items.find(
    (item) => path === item.path || (item.path !== '/' && path.startsWith(`${item.path}/`))
  );
};

/**
 * Pages nested under a sidebar route. The title key is the same one the page uses for its h1,
 * so the desktop trail leaf and the heading always agree.
 */
const SUB_ROUTE_TITLE_KEYS: readonly (readonly [path: string, titleKey: string])[] = [
  ['/auth-files/oauth-excluded', 'oauth_excluded.title'],
  ['/auth-files/oauth-model-alias', 'oauth_model_alias.title'],
];

export interface RouteTrail {
  /** Sidebar route the page belongs to; phones show it as the Back target. */
  parent: { path: string; label: string } | null;
  /** Name of the current page, identical to its h1. */
  current: string;
}

export function resolveRouteTrail(
  parent: { path: string; label: string } | undefined,
  pathname: string,
  t: (key: string) => string,
  fallback: string
): RouteTrail {
  const subRoute = SUB_ROUTE_TITLE_KEYS.find(
    ([path]) => pathname === path || pathname.startsWith(`${path}/`)
  );
  if (subRoute && parent && subRoute[0].startsWith(`${parent.path}/`)) {
    return { parent, current: t(subRoute[1]) };
  }
  return { parent: null, current: parent?.label ?? fallback };
}
