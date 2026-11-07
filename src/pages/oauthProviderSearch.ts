/** Case- and accent-insensitive text used for provider name matching. */
const fold = (value: string) => value.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase();

/**
 * True when every whitespace-separated word of `query` appears in one of the provider's names
 * (title, id, region, domain). An empty query matches everything.
 */
export function matchesOAuthProvider(names: readonly string[], query: string): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = names.map(fold).join(' ');
  return words.every((word) => haystack.includes(word));
}

/**
 * Providers to show for `query`. Rows with a sign-in in progress always stay visible so a
 * filter typed mid-flow never hides the device code or callback field.
 */
export function filterOAuthProviders<T>(
  items: readonly T[],
  query: string,
  namesOf: (item: T) => readonly string[],
  isPinned: (item: T) => boolean = () => false
): T[] {
  return items.filter((item) => isPinned(item) || matchesOAuthProvider(namesOf(item), query));
}
