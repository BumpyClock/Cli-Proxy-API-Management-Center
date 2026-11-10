/**
 * Upstream provider groups (v8 `api-keys.<family>`).
 *
 * A group owns one endpoint and shared policy; each key may override it, and a null key
 * field inherits. The Management API only replaces whole family lists, so every write is a
 * read-modify-write against GET /config: the edited row is located by its persisted
 * snapshot (never by endpoint or credential), only fields the form actually changed are
 * applied to the raw record, and every other group, key and unknown field passes through.
 */

import { readConfigResource } from './configValue';
import { isRecord } from '@/utils/helpers';
import { normalizeApiKeyEntry, normalizeProviderGroups } from './transformers';
import { serializeModelThinking } from './providerModels';
import type {
  GeminiKeyConfig,
  OpenAIProviderConfig,
  ProviderKeyConfig,
  ApiKeyEntry,
  ModelAlias,
  ProviderSource,
} from '@/types';

export type ProviderFamily =
  | 'gemini'
  | 'interactions'
  | 'codex'
  | 'meta'
  | 'xai'
  | 'claude'
  | 'vertex'
  | 'openai-compatibility';

type KeyConfig = ProviderKeyConfig | GeminiKeyConfig;
type Wire = Record<string, unknown>;
type EmptyOverride = '' | 0 | false | [] | Record<string, never>;

const serializeHeaders = (headers?: Record<string, string>) =>
  headers && Object.keys(headers).length ? headers : undefined;

/* -------------------------------------------------------------------------- */
/* serialization (config -> wire)                                              */
/* -------------------------------------------------------------------------- */

// v8 models carry no `priority` or `test-model`; the backend rejects unknown fields.
const serializeModelAliases = (models?: ModelAlias[], includeOpenAIFields = false) =>
  Array.isArray(models)
    ? models
        .map((model) => {
          if (!model?.name) return null;
          const payload: Wire = { name: model.name };
          if (model.alias) payload.alias = model.alias;
          if (includeOpenAIFields && model.image) payload.image = true;
          if (model.thinking) payload.thinking = serializeModelThinking(model.thinking);
          return payload;
        })
        .filter(Boolean)
    : undefined;

const serializeVertexModelAliases = (models?: ModelAlias[]) =>
  Array.isArray(models)
    ? models
        .map((model) => {
          const name = typeof model?.name === 'string' ? model.name.trim() : '';
          const alias = typeof model?.alias === 'string' ? model.alias.trim() : '';
          if (!name || !alias) return null;
          return {
            name,
            alias,
            ...(model.thinking ? { thinking: serializeModelThinking(model.thinking) } : {}),
          };
        })
        .filter(Boolean)
    : undefined;

const serializeApiKeyEntry = (entry: ApiKeyEntry) => {
  const payload: Wire = { 'api-key': entry.apiKey };
  if (entry.proxyUrl) payload['proxy-url'] = entry.proxyUrl;
  if (entry.weight !== undefined) payload.weight = entry.weight;
  return payload;
};

/** Fields every direct-key family shares. `disable-cooling` is tri-state: false is meaningful. */
const serializeCommonKey = (
  config: KeyConfig,
  serializeModels: (models?: ModelAlias[]) => unknown[] | undefined
) => {
  const payload: Wire = { 'api-key': config.apiKey };
  if (config.priority !== undefined) payload.priority = config.priority;
  if (config.weight !== undefined) payload.weight = config.weight;
  if (config.prefix?.trim()) payload.prefix = config.prefix.trim();
  if (config.baseUrl) payload['base-url'] = config.baseUrl;
  if (config.proxyUrl) payload['proxy-url'] = config.proxyUrl;
  const headers = serializeHeaders(config.headers);
  if (headers) payload.headers = headers;
  const models = serializeModels(config.models);
  if (models && models.length) payload.models = models;
  if (config.excludedModels && config.excludedModels.length) {
    payload['excluded-models'] = config.excludedModels;
  }
  return payload;
};

const serializeProviderKey = (config: ProviderKeyConfig) => {
  const payload = serializeCommonKey(config, serializeModelAliases);
  if (config.websockets !== undefined) payload.websockets = config.websockets;
  if (config.disableCooling !== undefined) payload['disable-cooling'] = config.disableCooling;
  if (config.cloak) {
    const cloakPayload: Wire = {};
    const mode = config.cloak.mode?.trim();
    if (mode) cloakPayload.mode = mode;
    if (config.cloak.strictMode !== undefined) {
      cloakPayload['strict-mode'] = config.cloak.strictMode;
    }
    if (config.cloak.sensitiveWords && config.cloak.sensitiveWords.length) {
      cloakPayload['sensitive-words'] = config.cloak.sensitiveWords;
    }
    if (config.cloak.cacheUserId) cloakPayload['cache-user-id'] = true;
    if (Object.keys(cloakPayload).length) payload.cloak = cloakPayload;
  }
  if (config.fingerprintProfile?.trim()) {
    payload['fingerprint-profile'] = config.fingerprintProfile.trim();
  }
  return payload;
};

const serializeVertexKey = (config: ProviderKeyConfig) =>
  serializeCommonKey(config, serializeVertexModelAliases);

const serializeGeminiKey = (config: GeminiKeyConfig) => {
  const payload = serializeCommonKey(config, serializeModelAliases);
  if (config.disableCooling !== undefined) payload['disable-cooling'] = config.disableCooling;
  return payload;
};

const serializeOpenAIProvider = (provider: OpenAIProviderConfig) => {
  const payload: Wire = {
    name: provider.name,
    'base-url': provider.baseUrl,
    keys: Array.isArray(provider.apiKeyEntries)
      ? provider.apiKeyEntries.map((entry) => serializeApiKeyEntry(entry))
      : [],
  };
  if (provider.prefix?.trim()) payload.prefix = provider.prefix.trim();
  if (provider.disabled !== undefined) payload.disabled = provider.disabled;
  const headers = serializeHeaders(provider.headers);
  if (headers) payload.headers = headers;
  const models = serializeModelAliases(provider.models, true);
  if (models && models.length) payload.models = models;
  if (provider.priority !== undefined) payload.priority = provider.priority;
  if (provider.disableCooling !== undefined) payload['disable-cooling'] = provider.disableCooling;
  return payload;
};

const keySerializer = (family: ProviderFamily): ((config: KeyConfig) => Wire) =>
  family === 'vertex'
    ? (serializeVertexKey as (config: KeyConfig) => Wire)
    : family === 'gemini' || family === 'interactions'
      ? (serializeGeminiKey as (config: KeyConfig) => Wire)
      : (serializeProviderKey as (config: KeyConfig) => Wire);

/* -------------------------------------------------------------------------- */
/* snapshot comparison                                                         */
/* -------------------------------------------------------------------------- */

const conflict = () =>
  new Error('Provider configuration changed or is ambiguous; refresh and try again.');

const equal = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((value, index) => equal(value, b[index]));
  }
  if (isRecord(a) && isRecord(b)) {
    const keys = Object.keys(a).filter((key) => a[key] !== undefined);
    return (
      keys.length === Object.keys(b).filter((key) => b[key] !== undefined).length &&
      keys.every((key) => equal(a[key], b[key]))
    );
  }
  return false;
};

/** GET /config injects a per-credential `auth_index`; it is not persisted configuration. */
const RESPONSE_ONLY_FIELDS = ['auth_index', 'auth-index'] as const;

const withoutResponseFields = (record: Wire): Wire => {
  const next = { ...record };
  for (const field of RESPONSE_ONLY_FIELDS) delete next[field];
  return next;
};

/** Persisted form of a group: response-only fields removed at group and key level only. */
const persisted = (group: Wire): Wire => ({
  ...withoutResponseFields(group),
  ...(Array.isArray(group.keys)
    ? { keys: group.keys.map((key) => (isRecord(key) ? withoutResponseFields(key) : key)) }
    : {}),
});

const withoutKeys = (group: Wire): Wire => {
  const next = { ...group };
  delete next.keys;
  return next;
};

const persistedGroups = (groups: unknown[]): unknown[] =>
  groups.map((group) => (isRecord(group) ? persisted(group) : group));

/* -------------------------------------------------------------------------- */
/* transport                                                                   */
/* -------------------------------------------------------------------------- */

/** Validate a family list read from /config. A malformed list is never rewritten. */
export const readProviderGroups = (raw: unknown, family: ProviderFamily): Wire[] => {
  if (!isRecord(raw) || !isRecord(raw['api-keys'])) return [];
  const groups = raw['api-keys'][family];
  if (groups === undefined || groups === null) return [];
  if (!Array.isArray(groups) || !groups.every((g) => isRecord(g) && Array.isArray(g.keys))) {
    throw conflict();
  }
  return groups as Wire[];
};

const getGroups = async (family: ProviderFamily) => {
  const resource = await readConfigResource(`/config/api-keys/${family}`, []);
  return {
    groups: readProviderGroups({ 'api-keys': { [family]: resource.value } }, family),
    replace: (groups: Wire[]) => resource.replace(cleanGroups(family, groups)),
  };
};

// `test-model` was a legacy UI-only field; v8 validation rejects unknown fields.
const withoutTestModel = (value: Wire): Wire => {
  const next = { ...value };
  delete next['test-model'];
  return next;
};

const cleanModelTestFields = (value: Wire): Wire =>
  Array.isArray(value.models)
    ? {
        ...value,
        models: value.models.map((model) => (isRecord(model) ? withoutTestModel(model) : model)),
      }
    : value;

const cleanGroups = (family: ProviderFamily, groups: Wire[]) =>
  groups.map((group) => {
    const clean = withoutResponseFields(
      cleanModelTestFields(family === 'openai-compatibility' ? withoutTestModel(group) : group)
    );
    return {
      ...clean,
      keys: (group.keys as unknown[]).map((key) =>
        isRecord(key) ? cleanModelTestFields(withoutResponseFields(key)) : key
      ),
    };
  });

/* -------------------------------------------------------------------------- */
/* locating the edited row                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Find the group a row was read from. An unchanged list resolves by position; otherwise the
 * group must still be uniquely identifiable by its persisted content. Anything else is a
 * concurrent change or a duplicate, and refuses the write.
 */
export const locateProviderGroup = (groups: Wire[], source: ProviderSource): number => {
  const current = persistedGroups(groups);
  if (
    source.groups &&
    equal(current, persistedGroups(source.groups)) &&
    equal(current[source.groupIndex], persisted(source.group))
  ) {
    return source.groupIndex;
  }
  const expected = persisted(source.group);
  const matches = current.flatMap((group, index) => {
    if (!isRecord(group)) return [];
    if (source.keyIndex === undefined) return equal(group, expected) ? [index] : [];
    const { keys: oldKeys, ...oldPolicy } = expected;
    const { keys, ...policy } = group;
    if (!equal(policy, oldPolicy) || !Array.isArray(oldKeys) || !Array.isArray(keys)) return [];
    return keys.some((key) => equal(key, oldKeys[source.keyIndex!])) ? [index] : [];
  });
  if (matches.length !== 1) throw conflict();
  return matches[0];
};

/** Position of the edited key inside the located group. */
const locateKey = (group: Wire, source: ProviderSource): number => {
  const originalKeys = persisted(source.group).keys;
  if (source.keyIndex === undefined || !Array.isArray(originalKeys)) throw conflict();
  const keys = persisted(group).keys as unknown[];
  const matches = equal(persisted(group), persisted(source.group))
    ? [source.keyIndex]
    : keys.flatMap((key, index) => (equal(key, originalKeys[source.keyIndex!]) ? [index] : []));
  if (matches.length !== 1) throw conflict();
  return matches[0];
};

const findKeySource = (groups: Wire[], apiKey: string, baseUrl?: string): ProviderSource => {
  const matches = (normalizeProviderGroups(groups) as KeyConfig[]).filter(
    (config) => config.apiKey === apiKey && (config.baseUrl ?? '') === (baseUrl ?? '')
  );
  if (matches.length !== 1 || !matches[0].source) throw conflict();
  return matches[0].source;
};

const findOpenAISource = (groups: Wire[], source: ProviderSource | undefined, name?: string) => {
  if (source) return locateProviderGroup(groups, source);
  const matches = (normalizeProviderGroups(groups, true) as OpenAIProviderConfig[]).filter(
    (config) => name !== undefined && config.name === name.trim()
  );
  if (matches.length !== 1 || !matches[0].source) throw conflict();
  return locateProviderGroup(groups, matches[0].source);
};

/* -------------------------------------------------------------------------- */
/* applying form changes to raw records                                        */
/* -------------------------------------------------------------------------- */

/** Value that overrides an inherited setting with "nothing" rather than re-inheriting it. */
const emptyOverride = (field: string): EmptyOverride => {
  if (['models', 'excluded-models'].includes(field)) return [];
  if (['headers', 'cloak'].includes(field)) return {};
  if (['disable-cooling', 'websockets', 'disabled'].includes(field)) return false;
  if (['priority', 'weight'].includes(field)) return 0;
  return '';
};

/**
 * Apply only the fields that differ between the serialized original (`before`) and the
 * serialized form (`after`) onto the raw record. Untouched fields, unknown fields and
 * explicit nulls therefore survive; a field cleared in the form removes the local
 * override, or writes an empty override when a parent group would otherwise be inherited.
 */
export const applyProviderChanges = (
  raw: Wire,
  before: Wire,
  after: Wire,
  inherited?: Wire
): Wire => {
  const next = { ...raw };
  for (const field of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (equal(before[field], after[field])) continue;
    // The form shows an omitted flag as off. Do not materialize that default.
    if (
      ['websockets', 'disabled'].includes(field) &&
      before[field] === undefined &&
      after[field] === false
    ) {
      continue;
    }
    if (after[field] !== undefined) {
      const fieldRaw = raw[field] ?? inherited?.[field];
      if (isRecord(fieldRaw) && isRecord(before[field]) && isRecord(after[field])) {
        next[field] = applyProviderChanges(fieldRaw, before[field], after[field]);
      } else if (
        Array.isArray(fieldRaw) &&
        Array.isArray(before[field]) &&
        Array.isArray(after[field])
      ) {
        const rawItems = fieldRaw as unknown[];
        const beforeItems = before[field] as unknown[];
        const used = new Set<number>();
        next[field] = (after[field] as unknown[]).map((item) => {
          if (!isRecord(item)) return item;
          const identity = item.name ?? item['api-key'];
          const index = beforeItems.findIndex(
            (old, i) => !used.has(i) && isRecord(old) && (old.name ?? old['api-key']) === identity
          );
          if (index < 0 || !isRecord(rawItems[index]) || !isRecord(beforeItems[index])) {
            return item;
          }
          used.add(index);
          return applyProviderChanges(rawItems[index] as Wire, beforeItems[index] as Wire, item);
        });
      } else {
        next[field] = after[field];
      }
    } else if (inherited?.[field] !== undefined && inherited[field] !== null) {
      next[field] = emptyOverride(field);
    } else {
      delete next[field];
    }
  }
  return next;
};

/**
 * Edit models by row identity so renames, reordering and deletion keep each model's
 * unknown/advanced fields. `sourceIndex` is the row's persisted position (never sent);
 * null marks a new row. Rows without an identity are matched only when unambiguous.
 */
const preserveModelMetadata = (
  next: Wire,
  raw: unknown,
  before: unknown,
  after: unknown,
  original: ModelAlias[] | undefined,
  desired: ModelAlias[] | undefined,
  serialize: (models?: ModelAlias[]) => unknown
) => {
  if (!Array.isArray(after) || !Array.isArray(raw)) return;
  const sameRows = equal(
    original?.map((model) => model.sourceIndex),
    desired?.map((model) => model.sourceIndex)
  );
  if (equal(before, after) && sameRows) return;
  const used = new Set<number>();
  const reserved = new Set(desired?.flatMap((model) => model.sourceIndex ?? []) ?? []);
  next.models = (desired ?? []).flatMap((model) => {
    const serialized = serialize([model]);
    if (!Array.isArray(serialized) || !isRecord(serialized[0])) return [];
    const value = serialized[0];
    if (model.sourceIndex === null) return [value];
    let old: ModelAlias | undefined;
    if (model.sourceIndex !== undefined) {
      old = original?.find((entry) => entry.sourceIndex === model.sourceIndex);
      if (!old || used.has(model.sourceIndex)) throw conflict();
    } else {
      const candidates = (original ?? []).filter(
        (entry) =>
          typeof entry.sourceIndex === 'number' &&
          !used.has(entry.sourceIndex) &&
          !reserved.has(entry.sourceIndex) &&
          entry.name === model.name
      );
      const exact = candidates.filter((entry) => entry.alias === model.alias);
      old = exact.length === 1 ? exact[0] : candidates.length === 1 ? candidates[0] : undefined;
    }
    const index = old?.sourceIndex;
    if (!old || typeof index !== 'number') return [value];
    if (!isRecord(raw[index])) throw conflict();
    used.add(index);
    const previous = serialize([old]);
    if (!Array.isArray(previous) || !isRecord(previous[0])) throw conflict();
    return [applyProviderChanges(raw[index], previous[0], value)];
  });
};

/* -------------------------------------------------------------------------- */
/* mutations                                                                   */
/* -------------------------------------------------------------------------- */

const uniqueGroupName = (family: ProviderFamily, groups: Wire[]) => {
  const names = new Set(groups.map((group) => group.name));
  let number = groups.length + 1;
  while (names.has(`${family}-${number}`)) number++;
  return `${family}-${number}`;
};

const createKey = async (family: ProviderFamily, config: KeyConfig) => {
  const { groups, replace } = await getGroups(family);
  const payload = keySerializer(family)(config);
  const baseUrl = payload['base-url'];
  delete payload['base-url'];
  await replace([
    ...groups,
    {
      name: uniqueGroupName(family, groups),
      ...(baseUrl ? { 'base-url': baseUrl } : {}),
      keys: [payload],
    },
  ]);
};

const updateKey = async (
  family: ProviderFamily,
  apiKey: string,
  baseUrl: string | undefined,
  config: KeyConfig
) => {
  const { groups, replace } = await getGroups(family);
  const source = config.source ?? findKeySource(groups, apiKey, baseUrl);
  const index = locateProviderGroup(groups, source);
  const group = groups[index];
  const keyIndex = locateKey(group, source);
  const keys = [...(group.keys as Wire[])];
  const original = (normalizeProviderGroups([group]) as KeyConfig[]).find(
    (row) => row.source?.keyIndex === keyIndex
  );
  if (!original) throw conflict();

  const serialize = keySerializer(family);
  const before = serialize(original);
  const after = serialize(config);
  const baseUrlChanged = !equal(before['base-url'], after['base-url']);
  const nextBaseUrl = after['base-url'];
  delete before['base-url'];
  delete after['base-url'];

  const rawKey = keys[keyIndex];
  const rawModels = rawKey.models ?? group.models;
  const nextKey = applyProviderChanges(rawKey, before, after, group);
  preserveModelMetadata(
    nextKey,
    rawModels,
    before.models,
    after.models,
    original.models,
    config.models,
    family === 'vertex' ? serializeVertexModelAliases : serializeModelAliases
  );

  const groupFields = withoutKeys(group);
  if (!baseUrlChanged) {
    keys[keyIndex] = nextKey;
    groups[index] = { ...groupFields, keys };
  } else if (keys.length === 1) {
    keys[keyIndex] = nextKey;
    const next: Wire = { ...groupFields, keys };
    if (nextBaseUrl === undefined) delete next['base-url'];
    else next['base-url'] = nextBaseUrl;
    groups[index] = next;
  } else {
    // The endpoint belongs to the group. Moving this key must not repoint its siblings,
    // so it leaves for a new group that keeps the group's shared policy.
    const moved: Wire = { ...groupFields, name: uniqueGroupName(family, groups), keys: [nextKey] };
    if (nextBaseUrl === undefined) delete moved['base-url'];
    else moved['base-url'] = nextBaseUrl;
    groups[index] = { ...groupFields, keys: keys.filter((_, i) => i !== keyIndex) };
    groups.splice(index + 1, 0, moved);
  }
  await replace(groups);
};

const deleteKey = async (
  family: ProviderFamily,
  apiKey: string,
  baseUrl?: string,
  expected?: ProviderSource
) => {
  const { groups, replace } = await getGroups(family);
  const source = expected ?? findKeySource(groups, apiKey, baseUrl);
  const index = locateProviderGroup(groups, source);
  const keyIndex = locateKey(groups[index], source);
  groups[index] = {
    ...groups[index],
    keys: (groups[index].keys as unknown[]).filter((_, i) => i !== keyIndex),
  };
  await replace(groups);
};

const updateOpenAIGroup = async (config: OpenAIProviderConfig, name?: string) => {
  const { groups, replace } = await getGroups('openai-compatibility');
  const index = findOpenAISource(groups, config.source, name);
  const original = (normalizeProviderGroups([groups[index]], true) as OpenAIProviderConfig[])[0];
  if (!original) throw conflict();

  const before = serializeOpenAIProvider(original);
  const after = serializeOpenAIProvider(config);
  const beforeKeys = before.keys;
  const afterKeys = after.keys;
  delete before.keys;
  delete after.keys;

  const next = applyProviderChanges(groups[index], before, after);
  preserveModelMetadata(
    next,
    groups[index].models,
    before.models,
    after.models,
    original.models,
    config.models,
    (models) => serializeModelAliases(models, true)
  );
  if (!equal(beforeKeys, afterKeys)) {
    const rawKeys = groups[index].keys as Wire[];
    const used = new Set<number>();
    next.keys = config.apiKeyEntries.map((entry) => {
      // An existing entry keeps its persisted position; its absence means a new credential.
      // API keys alone are not identities: one key can appear with different proxies.
      const keyIndex = entry.sourceIndex;
      if (keyIndex === undefined) return serializeApiKeyEntry(entry);
      if (!Number.isInteger(keyIndex) || used.has(keyIndex) || !isRecord(rawKeys[keyIndex])) {
        throw conflict();
      }
      used.add(keyIndex);
      const old = normalizeApiKeyEntry(rawKeys[keyIndex]);
      if (!old) throw conflict();
      return applyProviderChanges(
        rawKeys[keyIndex],
        serializeApiKeyEntry(old),
        serializeApiKeyEntry(entry)
      );
    });
  }
  groups[index] = next;
  await replace(groups);
};

export const providersApi = {
  createGeminiKey: (config: GeminiKeyConfig) => createKey('gemini', config),
  updateGeminiKey: (apiKey: string, baseUrl: string | undefined, config: GeminiKeyConfig) =>
    updateKey('gemini', apiKey, baseUrl, config),
  deleteGeminiKey: (apiKey: string, baseUrl?: string, source?: ProviderSource) =>
    deleteKey('gemini', apiKey, baseUrl, source),

  createInteractionsKey: (config: GeminiKeyConfig) => createKey('interactions', config),
  updateInteractionsKey: (apiKey: string, baseUrl: string | undefined, config: GeminiKeyConfig) =>
    updateKey('interactions', apiKey, baseUrl, config),
  deleteInteractionsKey: (apiKey: string, baseUrl?: string, source?: ProviderSource) =>
    deleteKey('interactions', apiKey, baseUrl, source),

  createCodexConfig: (config: ProviderKeyConfig) => createKey('codex', config),
  updateCodexConfig: (apiKey: string, baseUrl: string | undefined, config: ProviderKeyConfig) =>
    updateKey('codex', apiKey, baseUrl, config),
  deleteCodexConfig: (apiKey: string, baseUrl?: string, source?: ProviderSource) =>
    deleteKey('codex', apiKey, baseUrl, source),

  createMetaConfig: (config: ProviderKeyConfig) => createKey('meta', config),
  updateMetaConfig: (apiKey: string, baseUrl: string | undefined, config: ProviderKeyConfig) =>
    updateKey('meta', apiKey, baseUrl, config),
  deleteMetaConfig: (apiKey: string, baseUrl?: string, source?: ProviderSource) =>
    deleteKey('meta', apiKey, baseUrl, source),

  createXAIConfig: (config: ProviderKeyConfig) => createKey('xai', config),
  updateXAIConfig: (apiKey: string, baseUrl: string | undefined, config: ProviderKeyConfig) =>
    updateKey('xai', apiKey, baseUrl, config),
  deleteXAIConfig: (apiKey: string, baseUrl?: string, source?: ProviderSource) =>
    deleteKey('xai', apiKey, baseUrl, source),

  createClaudeConfig: (config: ProviderKeyConfig) => createKey('claude', config),
  updateClaudeConfig: (apiKey: string, baseUrl: string | undefined, config: ProviderKeyConfig) =>
    updateKey('claude', apiKey, baseUrl, config),
  deleteClaudeConfig: (apiKey: string, baseUrl?: string, source?: ProviderSource) =>
    deleteKey('claude', apiKey, baseUrl, source),

  createVertexConfig: (config: ProviderKeyConfig) => createKey('vertex', config),
  updateVertexConfig: (apiKey: string, baseUrl: string | undefined, config: ProviderKeyConfig) =>
    updateKey('vertex', apiKey, baseUrl, config),
  deleteVertexConfig: (apiKey: string, baseUrl?: string, source?: ProviderSource) =>
    deleteKey('vertex', apiKey, baseUrl, source),

  async getMetaConfigs(): Promise<ProviderKeyConfig[]> {
    return normalizeProviderGroups((await getGroups('meta')).groups) as ProviderKeyConfig[];
  },

  async getVertexConfigs(): Promise<ProviderKeyConfig[]> {
    return normalizeProviderGroups((await getGroups('vertex')).groups) as ProviderKeyConfig[];
  },

  async getOpenAIProviders(): Promise<OpenAIProviderConfig[]> {
    return normalizeProviderGroups(
      (await getGroups('openai-compatibility')).groups,
      true
    ) as OpenAIProviderConfig[];
  },

  async createOpenAIProvider(config: OpenAIProviderConfig) {
    const { groups, replace } = await getGroups('openai-compatibility');
    await replace([...groups, serializeOpenAIProvider(config)]);
  },

  updateOpenAIProvider: (name: string, _index: number, config: OpenAIProviderConfig) =>
    updateOpenAIGroup(config, name),

  async updateOpenAIProviderDisabled(_index: number, disabled: boolean, source?: ProviderSource) {
    const { groups, replace } = await getGroups('openai-compatibility');
    const index = findOpenAISource(groups, source);
    groups[index] = { ...groups[index], disabled };
    await replace(groups);
  },

  async deleteOpenAIProvider(_index: number, source?: ProviderSource) {
    const { groups, replace } = await getGroups('openai-compatibility');
    const index = findOpenAISource(groups, source);
    await replace(groups.filter((_, i) => i !== index));
  },
};
