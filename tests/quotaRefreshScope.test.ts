import { describe, expect, test } from 'bun:test';
import { createInstance } from 'i18next';
import { QUOTA_PAGE_SIZE } from '../src/features/quota/constants';
import {
  classifyQuotaFiles,
  filterEntriesBySearch,
  filterEntriesByTab,
  paginate,
  sortQuotaEntries,
} from '../src/features/quota/logic';
import { QODER_CONFIG } from '../src/features/quota/providers/qoder/data';
import {
  resolveQuotaRefreshTargets,
  type QuotaRefreshIntent,
} from '../src/features/quota/refreshScope';
import type { AuthFileItem } from '../src/types';

const t = createInstance().t;
const snapshot = {
  sessionGeneration: 7,
  filesGeneration: 7,
  hasError: false,
  disabled: false,
};
const file = (name: string, provider: string, extra: Partial<AuthFileItem> = {}): AuthFileItem => ({
  name,
  provider,
  ...extra,
});
const intentFor = (scope: QuotaRefreshIntent['scope']): QuotaRefreshIntent => ({
  sessionGeneration: 7,
  scope,
});

// Exercise the same list-derived inputs as QuotaPage, not saved click-time file objects.
const pageFrom = (files: AuthFileItem[]) =>
  paginate(classifyQuotaFiles(files), 1, QUOTA_PAGE_SIZE).pageItems;

const scopes = ['all', 'qoder'] as const;

describe('quota refresh list handoff', () => {
  for (const scope of scopes) {
    test(`${scope} refresh gives the quota request fresh Qoder usage, not click-time usage`, async () => {
      const oldFile = file('qoder.json', 'qoder', { usage: { used: 10, total: 100 } });
      const clickedEntries = pageFrom([oldFile]);
      const intent = intentFor(scope === 'all' ? 'all' : clickedEntries[0].type);
      const refreshedFile = { ...oldFile, usage: { used: 90, total: 100 } };
      const targets = resolveQuotaRefreshTargets(intent, snapshot, pageFrom([refreshedFile]));

      // This is the actual request action used by the batch loader for Qoder.
      const results = await Promise.all(
        targets.map(({ file }) => QODER_CONFIG.fetchQuota(file, t))
      );
      expect(results).toEqual([{ used: 90, total: 100 }]);
      expect(targets[0].file).toBe(refreshedFile);
      expect(oldFile.usage).toEqual({ used: 10, total: 100 });
    });

    test(`${scope} refresh does not reuse cached files after a list failure`, () => {
      const cachedPage = pageFrom([
        file('qoder.json', 'qoder', { usage: { used: 10, total: 100 } }),
      ]);
      expect(
        resolveQuotaRefreshTargets(intentFor(scope), { ...snapshot, hasError: true }, cachedPage)
      ).toEqual([]);
    });

    test(`${scope} refresh rejects old-session intents, stale lists and disconnected sessions`, () => {
      const page = pageFrom([file('qoder.json', 'qoder')]);
      const intent = intentFor(scope);
      for (const invalidSnapshot of [
        { ...snapshot, sessionGeneration: 8, filesGeneration: 8 },
        { ...snapshot, filesGeneration: 6 },
        { ...snapshot, filesGeneration: null },
        { ...snapshot, disabled: true },
      ]) {
        expect(resolveQuotaRefreshTargets(intent, invalidSnapshot, page)).toEqual([]);
      }
      expect(resolveQuotaRefreshTargets(intent, snapshot, page)).toHaveLength(1);
    });
  }

  test('provider scope stays inside the fresh filtered, sorted current page', () => {
    const files = [
      file('codex.json', 'codex', { email: 'matched@example.com' }),
      file('hidden-qoder.json', 'qoder', { email: 'other@example.com' }),
      ...Array.from({ length: QUOTA_PAGE_SIZE + 1 }, (_, index) =>
        file(`qoder-${index}.json`, 'qoder', { email: 'matched@example.com' })
      ),
    ];
    const matches = filterEntriesBySearch(
      filterEntriesByTab(classifyQuotaFiles(files), 'all'),
      'matched@'
    );
    const sorted = sortQuotaEntries(matches, 'soonest', ({ file }) =>
      file.provider === 'codex' ? 0 : QUOTA_PAGE_SIZE + 1 - Number(file.name.match(/\d+/)?.[0])
    );
    const { pageItems } = paginate(sorted, 1, QUOTA_PAGE_SIZE);
    const providerTargets = resolveQuotaRefreshTargets(intentFor('qoder'), snapshot, pageItems);
    const allTargets = resolveQuotaRefreshTargets(intentFor('all'), snapshot, pageItems);

    expect(providerTargets.map(({ file }) => file.name)).toEqual(
      Array.from(
        { length: QUOTA_PAGE_SIZE - 1 },
        (_, index) => `qoder-${QUOTA_PAGE_SIZE - index}.json`
      )
    );
    expect(allTargets.map(({ file }) => file.name)).toEqual([
      'codex.json',
      ...providerTargets.map(({ file }) => file.name),
    ]);
    expect(allTargets).toHaveLength(QUOTA_PAGE_SIZE);
  });

  test('removed and newly disabled credentials are not quota refresh targets', () => {
    const clickedEntries = pageFrom([
      file('removed.json', 'qoder'),
      file('disabled.json', 'qoder'),
      file('survivor.json', 'qoder'),
    ]);
    const intent = intentFor(clickedEntries[0].type);
    const freshPage = pageFrom([
      file('disabled.json', 'qoder', { disabled: true }),
      file('survivor.json', 'qoder', { usage: { used: 90, total: 100 } }),
      file('other-provider.json', 'codex'),
    ]);
    expect(
      resolveQuotaRefreshTargets(intent, snapshot, freshPage).map(({ file }) => file.name)
    ).toEqual(['survivor.json']);
    expect(
      resolveQuotaRefreshTargets(intentFor('all'), snapshot, freshPage).map(({ file }) => file.name)
    ).toEqual(['other-provider.json', 'survivor.json']);
  });

  test('an absent provider on the new current page does not expand refresh to other providers', () => {
    const freshPage = pageFrom([file('codex.json', 'codex')]);
    expect(resolveQuotaRefreshTargets(intentFor('qoder'), snapshot, freshPage)).toEqual([]);
    expect(resolveQuotaRefreshTargets(intentFor('all'), snapshot, [])).toEqual([]);
  });
});
