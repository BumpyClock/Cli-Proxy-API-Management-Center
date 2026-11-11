import assert from 'node:assert/strict';

export function fixtureConnection(env = process.env) {
  assert(env.CPAMC_V8_SMOKE_FIXTURE === '1', 'Explicit fixture-write opt-in is required.');
  const key = env.CPAMC_SMOKE_KEY?.trim();
  assert(key, 'The disposable fixture management key is required.');
  let base;
  try {
    base = new URL(env.CPAMC_SMOKE_BASE ?? 'http://127.0.0.1:18318');
  } catch {
    throw new Error('Invalid fixture base URL.');
  }
  assert(
    ['http:', 'https:'].includes(base.protocol) &&
      ['127.0.0.1', 'localhost'].includes(base.hostname),
    'Only loopback fixtures are allowed.'
  );
  assert(
    !base.username && !base.password && !base.search && !base.hash,
    'Fixture URLs must not contain credentials, queries or fragments.'
  );
  return { base: base.href.replace(/\/$/, ''), key };
}

export function assertFixtureConfig(config) {
  const keys = config?.access?.['api-keys'];
  assert(
    Array.isArray(keys) && keys.length === 1 && keys[0] === 'cpamc-smoke-client-only',
    'Refusing non-fixture client keys.'
  );
  assert(
    typeof config?.oauth?.['auth-dir'] === 'string' &&
      config.oauth['auth-dir'].startsWith('/tmp/cpamc-v8-smoke/'),
    'Refusing a non-fixture credential directory.'
  );
  assert(
    config?.requests?.['proxy-url'] === 'http://127.0.0.1:1',
    'The fixture must have an unreachable global proxy.'
  );
  const families = config['api-keys'] ?? {};
  assert(
    families && typeof families === 'object' && !Array.isArray(families),
    'Invalid fixture provider groups.'
  );
  for (const groups of Object.values(families)) {
    assert(
      Array.isArray(groups) &&
        groups.every((group) => Array.isArray(group?.keys) && group.keys.length === 0),
      'Refusing existing upstream provider credentials.'
    );
  }
}
