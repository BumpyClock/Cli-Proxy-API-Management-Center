export const findActiveRoute = <T extends { path: string }>(
  items: T[],
  pathname: string
): T | undefined => {
  const path = pathname === '/dashboard' ? '/' : pathname;
  return items.find(
    (item) => path === item.path || (item.path !== '/' && path.startsWith(`${item.path}/`))
  );
};
