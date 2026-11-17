import { readConfigResource } from './configValue';
import { isRecord } from '@/utils/helpers';
import {
  normalizeApiKeyEntry,
  normalizeConfigResponse,
  normalizeProviderGroups,
} from './transformers';
import { serializeModelThinking } from './providerModels';
import type {
  Config,
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
type EmptyOverride = '' | 0 | 1 | false | [] | Record<string, never>;

const serializeHeaders = (headers?: Record<string, string>) =>
  headers && Object.keys(headers).length ? headers : undefined;

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

const keySerializer = (family: KeyFamily): ((config: KeyConfig) => Wire) =>
  family === 'vertex'
    ? serializeVertexKey
    : family === 'gemini' || family === 'interactions'
      ? serializeGeminiKey
      : serializeProviderKey;

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

const readProviderGroups = (value: unknown): Wire[] => {
  if (value == null) return [];
  if (
    !Array.isArray(value) ||
    !value.every(
      (group) => isRecord(group) && Array.isArray(group.keys) && group.keys.every(isRecord)
    )
  ) {
    throw conflict();
  }
  return value;
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

const locateProviderGroup = (groups: Wire[], source: ProviderSource): number => {
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

export const assertProviderSources = (
  current: Array<{ source?: ProviderSource }>,
  expected: Array<{ source?: ProviderSource }>
) => {
  const identity = ({ source }: { source?: ProviderSource }) => {
    if (!source) throw conflict();
    const group = persisted(source.group);
    if (source.keyIndex === undefined) return group;
    return { ...withoutKeys(group), keys: [(group.keys as unknown[])[source.keyIndex]] };
  };
  const unmatched = current.map(identity);
  if (unmatched.length !== expected.length) throw conflict();
  for (const entry of expected) {
    const original = identity(entry);
    const index = unmatched.findIndex((candidate) => equal(candidate, original));
    if (index < 0) throw conflict();
    unmatched.splice(index, 1);
  }
};

const emptyOverride = (field: string): EmptyOverride => {
  if (['models', 'excluded-models'].includes(field)) return [];
  if (['headers', 'cloak'].includes(field)) return {};
  if (['disable-cooling', 'websockets', 'disabled'].includes(field)) return false;
  if (field === 'priority') return 0;
  if (field === 'weight') return 1;
  return '';
};

const applyProviderChanges = (raw: Wire, before: Wire, after: Wire, inherited?: Wire): Wire => {
  const next = { ...raw };
  for (const field of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (equal(before[field], after[field])) continue;
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
  next.models = (desired ?? []).flatMap((model) => {
    const serialized = serialize([model]);
    if (!Array.isArray(serialized) || !isRecord(serialized[0])) return [];
    const value = serialized[0];
    const index = model.sourceIndex;
    if (index === undefined) return [value];
    const old = original?.find((entry) => entry.sourceIndex === index);
    if (!old || used.has(index) || !isRecord(raw[index])) throw conflict();
    used.add(index);
    const previous = serialize([old]);
    if (!Array.isArray(previous) || !isRecord(previous[0])) throw conflict();
    return [applyProviderChanges(raw[index], previous[0], value)];
  });
};

const uniqueGroupName = (family: ProviderFamily, groups: Wire[]) => {
  const names = new Set(groups.map((group) => group.name));
  let number = groups.length + 1;
  while (names.has(`${family}-${number}`)) number++;
  return `${family}-${number}`;
};

const createKey = (family: KeyFamily, groups: Wire[], config: KeyConfig) => {
  const payload = keySerializer(family)(config);
  const baseUrl = payload['base-url'];
  delete payload['base-url'];
  groups.push({
    name: uniqueGroupName(family, groups),
    ...(baseUrl ? { 'base-url': baseUrl } : {}),
    keys: [payload],
  });
};

const updateKey = (
  family: KeyFamily,
  groups: Wire[],
  source: ProviderSource,
  config: KeyConfig
) => {
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
    const moved: Wire = { ...groupFields, name: uniqueGroupName(family, groups), keys: [nextKey] };
    if (nextBaseUrl === undefined) delete moved['base-url'];
    else moved['base-url'] = nextBaseUrl;
    groups[index] = { ...groupFields, keys: keys.filter((_, i) => i !== keyIndex) };
    groups.splice(index + 1, 0, moved);
  }
};

const deleteKey = (groups: Wire[], source: ProviderSource) => {
  const index = locateProviderGroup(groups, source);
  const keyIndex = locateKey(groups[index], source);
  groups[index] = {
    ...groups[index],
    keys: (groups[index].keys as unknown[]).filter((_, i) => i !== keyIndex),
  };
};

const updateOpenAIGroup = (
  groups: Wire[],
  source: ProviderSource,
  config: OpenAIProviderConfig
) => {
  const index = locateProviderGroup(groups, source);
  const original = (normalizeProviderGroups([groups[index]], true) as OpenAIProviderConfig[])[0];
  if (!original) throw conflict();

  const before = serializeOpenAIProvider(original);
  const after = serializeOpenAIProvider(config);
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
  const rawKeys = groups[index].keys as Wire[];
  const used = new Set<number>();
  next.keys = config.apiKeyEntries.map((entry) => {
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
  groups[index] = next;
};

type KeyFamily = Exclude<ProviderFamily, 'openai-compatibility'>;
type ProviderConfigByFamily = Record<KeyFamily, KeyConfig> & {
  'openai-compatibility': OpenAIProviderConfig;
};
export type ProviderChange = {
  [Family in ProviderFamily]:
    | { family: Family; type: 'create'; config: ProviderConfigByFamily[Family] }
    | { family: Family; type: 'update'; config: ProviderConfigByFamily[Family] }
    | { family: Family; type: 'delete'; source: ProviderSource | undefined };
}[ProviderFamily];

function applyChange(groups: Wire[], change: ProviderChange) {
  if (change.type === 'create') {
    if (change.family === 'openai-compatibility')
      groups.push(serializeOpenAIProvider(change.config));
    else createKey(change.family, groups, change.config);
    return;
  }
  const source = change.type === 'delete' ? change.source : change.config.source;
  if (!source) throw conflict();
  if (change.type === 'update') {
    if (change.family === 'openai-compatibility') updateOpenAIGroup(groups, source, change.config);
    else updateKey(change.family, groups, source, change.config);
  } else if (change.family === 'openai-compatibility') {
    groups.splice(locateProviderGroup(groups, source), 1);
  } else {
    deleteKey(groups, source);
  }
}

const writeFamily = async (change: ProviderChange) => {
  const { family } = change;
  const resource = await readConfigResource(`/config/api-keys/${family}`, []);
  const groups = [...readProviderGroups(resource.value)];
  applyChange(groups, change);
  await resource.replace(cleanGroups(family, groups));
};

export const providersApi = {
  writeFamily,

  async writeAggregate(
    families: ReadonlyArray<ProviderFamily>,
    assertConnection: () => void,
    prepare: (current: Config) => ProviderChange[]
  ) {
    assertConnection();
    const resource = await readConfigResource('/config/api-keys', {});
    assertConnection();
    const raw = resource.value;
    if (!isRecord(raw)) throw conflict();
    const originals = new Map(families.map((family) => [family, readProviderGroups(raw[family])]));
    const changes = prepare(normalizeConfigResponse({ 'api-keys': raw }));
    const replacements = new Map<ProviderFamily, Wire[]>();

    for (const change of changes) {
      const { family } = change;
      const original = originals.get(family);
      if (!original) throw conflict();
      const groups = replacements.get(family) ?? [...original];
      applyChange(groups, change);
      replacements.set(family, groups);
    }

    const patch = [...replacements]
      .filter(([family, groups]) => !equal(groups, originals.get(family)))
      .map(([family, groups]) => [family, cleanGroups(family, groups)] as const);
    if (patch.length) await resource.patch(Object.fromEntries(patch));
  },
};
