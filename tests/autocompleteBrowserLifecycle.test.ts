import { expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

for (const failureAt of ['vite', 'browser', 'page']) {
  test(`browser verification releases owned resources after ${failureAt} startup failure`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'cpamc-lifecycle-'));
    const module = join(root, 'playwright.mjs');
    const closed = join(root, 'browser-closed');
    const script = pathToFileURL(resolve('scripts/verify-autocomplete-browser.mjs')).href;
    try {
      await writeFile(
        module,
        `
        import { writeFileSync } from 'node:fs';
        export const chromium = {
          async launch() {
            if (process.env.FAILURE_AT === 'browser') throw new Error('fixture browser failure');
            return {
              async newPage() { throw new Error('fixture page failure'); },
              async close() { writeFileSync(${JSON.stringify(closed)}, 'closed'); }
            };
          }
        };
      `
      );
      const result = Bun.spawnSync(
        [
          process.execPath,
          '--eval',
          `
        import assert from 'node:assert/strict';
        let killed = 0;
        Bun.spawn = (command) => {
          assert(command.includes('node_modules/vite/bin/vite.js'));
          if (process.env.FAILURE_AT === 'vite') throw new Error('fixture vite failure');
          let finish;
          return {
            exited: new Promise(resolve => { finish = resolve; }),
            kill() { killed++; finish(0); }
          };
        };
        globalThis.fetch = async () => new Response('ready');
        await assert.rejects(import(${JSON.stringify(script)}), /fixture ${failureAt} failure/);
        assert.equal(killed, ${failureAt === 'vite' ? 0 : 1});
      `,
        ],
        {
          env: {
            ...process.env,
            FAILURE_AT: failureAt,
            PLAYWRIGHT_MODULE: module,
            BROWSER_ARTIFACT_DIR: join(root, 'artifacts'),
          },
        }
      );
      expect(new TextDecoder().decode(result.stderr)).toBe('');
      expect(result.exitCode).toBe(0);
      if (failureAt === 'page') expect(await readFile(closed, 'utf8')).toBe('closed');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}
