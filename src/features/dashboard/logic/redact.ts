/**
 * Mask secrets before text reaches the screen.
 *
 * Provider error bodies and proxy settings can carry API keys, bearer tokens, or URL
 * credentials. The dashboard shows them to anyone looking at the operator's screen, so
 * every free-form string from the backend passes through here first.
 */

type Replacer = (match: string, ...groups: string[]) => string;

const keepEdges = (value: string, head: number): string =>
  value.length > head + 4 ? `${value.slice(0, head)}…${value.slice(-4)}` : '***';

const RULES: Array<[RegExp, string | Replacer]> = [
  // scheme://user:password@host
  [/([a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:)[^\s@/]+@/gi, '$1***@'],
  // Authorization header values
  [/\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 ***'],
  // key=value or "key": "value" pairs whose name says secret
  [
    /\b((?:api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|secret|password|passwd|token)["']?\s*[:=]\s*)("(?:\\[\s\S]|[^"\\])*(?:"|\\?$)|'(?:\\[\s\S]|[^'\\])*(?:'|\\?$)|[^\s"'&,;}]+)/gi,
    (_match, label, value) => {
      const quote = value[0] === '"' || value[0] === "'" ? value[0] : '';
      return `${label}${quote}***${quote}`;
    },
  ],
  // JSON Web Tokens
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '***'],
  // Provider API key shapes
  [/\b(?:sk|rk|pk)-[A-Za-z0-9_-]{12,}/g, (match) => keepEdges(match, 3)],
  [/\bxai-[A-Za-z0-9_-]{16,}/g, (match) => keepEdges(match, 4)],
  [/\bAIza[0-9A-Za-z_-]{20,}/g, (match) => keepEdges(match, 4)],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, (match) => keepEdges(match, 4)],
  [/\bya29\.[A-Za-z0-9._-]{20,}/g, (match) => keepEdges(match, 5)],
  // Any other long opaque token
  [/\b[A-Za-z0-9_-]{40,}\b/g, '***'],
];

export function redactSecrets(text: string): string {
  return RULES.reduce(
    (result, [pattern, replacement]) => result.replace(pattern, replacement as string & Replacer),
    text
  );
}

/** `http://user:***@proxy:8080`, leaving credential-free URLs untouched. */
export function redactUrlCredentials(url: string): string {
  return url.replace(
    /^([a-z][a-z0-9+.-]*:\/\/)([^\s/@]*)@/i,
    (_match, scheme: string, userinfo: string) => {
      const separator = userinfo.indexOf(':');
      const user = separator < 0 ? userinfo : userinfo.slice(0, separator);
      return separator < 0 ? `${scheme}***@` : `${scheme}${user}:***@`;
    }
  );
}
