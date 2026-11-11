import { isRecord } from '@/utils/helpers';

/**
 * v8 management JSON is the YAML tree, so model thinking capabilities use YAML tags
 * (`zero-allowed`). The workbench reads the registry's JSON spellings (`zero_allowed`).
 */
const THINKING_FIELDS = [
  ['zero_allowed', 'zero-allowed'],
  ['dynamic_allowed', 'dynamic-allowed'],
] as const;

const renameFields = (
  value: Record<string, unknown>,
  pairs: ReadonlyArray<readonly [from: string, to: string]>
): Record<string, unknown> => {
  const result = { ...value };
  for (const [from, to] of pairs) {
    if (from in result) {
      result[to] = result[from];
      delete result[from];
    }
  }
  return result;
};

export function normalizeModelThinking(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  return renameFields(
    value,
    THINKING_FIELDS.map(([snake, kebab]) => [kebab, snake] as const)
  );
}

export function serializeModelThinking(value: Record<string, unknown>): Record<string, unknown> {
  return renameFields(value, THINKING_FIELDS);
}
