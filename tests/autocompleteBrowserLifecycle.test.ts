import { expect, test } from 'bun:test';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

for (const failureAt of [1, 2]) {
  test(`browser verification cleans up when process ${failureAt} cannot start`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'cpamc-lifecycle-'));
    const script = pathToFileURL(
      resolve(import.meta.dir, '../scripts/verify-autocomplete-browser.mjs')
    ).href;
    try {
      const result = Bun.spawnSync(
        [
          process.execPath,
          '--eval',
          `
          import assert from 'node:assert/strict';
          let calls = 0;
          let killed = 0;
          Bun.spawn = () => {
            if (++calls === ${failureAt}) throw new Error('fixture spawn failure');
            let finish;
            return {
              exited: new Promise(resolve => { finish = resolve; }),
              kill() { killed++; finish(0); }
            };
          };
          await assert.rejects(import(${JSON.stringify(script)}), /fixture spawn failure/);
          assert.equal(killed, ${failureAt - 1}, 'Every started process must be stopped.');
        `,
        ],
        { env: { ...process.env, TMPDIR: root } }
      );
      expect(new TextDecoder().decode(result.stderr)).toBe('');
      expect(result.exitCode).toBe(0);
      expect(await readdir(root)).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}
