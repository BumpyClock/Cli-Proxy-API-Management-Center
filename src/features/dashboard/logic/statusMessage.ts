import { HEALTHY_AUTH_FILE_STATUS_MESSAGES } from '@/features/authFiles/constants';

const MAX_REASON_LENGTH = 180;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const readText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/** Pull a human sentence out of a provider error body. */
function messageFromPayload(payload: unknown, depth = 0): string {
  if (depth > 3) return '';
  if (typeof payload === 'string') return payload.trim();
  if (!isRecord(payload)) return '';

  const nested = payload.error;
  if (isRecord(nested)) {
    const fromNested = messageFromPayload(nested, depth + 1);
    if (fromNested) return fromNested;
  }

  for (const key of ['message', 'detail', 'error_description', 'error', 'msg', 'reason']) {
    const text = readText(payload[key]);
    if (text) return text;
  }

  return readText(payload.code) || readText(payload.type);
}

function tryParseJson(text: string): unknown {
  const start = text.indexOf('{');
  if (start < 0) return null;
  try {
    return JSON.parse(text.slice(start));
  } catch {
    return null;
  }
}

/**
 * Readable reason for a credential's `status_message`.
 *
 * Providers often store their raw JSON error body there. Operators need the sentence
 * inside it, not the envelope. Healthy markers ("ok", "ready") produce null.
 */
export function readableStatusReason(raw: unknown): string | null {
  const text = readText(raw);
  if (!text) return null;
  if (HEALTHY_AUTH_FILE_STATUS_MESSAGES.has(text.toLowerCase())) return null;

  const parsed = text.includes('{') ? tryParseJson(text) : null;
  const extracted = parsed ? messageFromPayload(parsed) : '';
  const prefix = parsed
    ? text
        .slice(0, text.indexOf('{'))
        .replace(/[\s:-]+$/, '')
        .trim()
    : '';
  const sentence = extracted || text;
  const combined =
    prefix && extracted && !extracted.includes(prefix) ? `${prefix}: ${extracted}` : sentence;
  const collapsed = combined.replace(/\s+/g, ' ').trim();

  return collapsed.length > MAX_REASON_LENGTH
    ? `${collapsed.slice(0, MAX_REASON_LENGTH - 1).trimEnd()}…`
    : collapsed;
}
