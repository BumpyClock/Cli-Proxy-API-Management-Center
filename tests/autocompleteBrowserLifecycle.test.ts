import { expect, test } from 'bun:test';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

for (const diagnosticsFail of [false, true]) {
  test(`browser verification preserves the primary CDP failure when diagnostics fail ${diagnosticsFail}`, async () => {
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
          import { writeFileSync } from 'node:fs';
          import { join } from 'node:path';
          let killed = 0;
          let closed = false;
          const diagnostics = [];
          console.error = (...args) => diagnostics.push(args.join(' '));
          Bun.spawn = (command) => {
            const profile = command.find(arg => arg.startsWith('--user-data-dir='));
            if (profile) {
              writeFileSync(join(profile.slice('--user-data-dir='.length), 'DevToolsActivePort'), '12345');
            }
            let finish;
            return {
              exited: new Promise(resolve => { finish = resolve; }),
              kill() { killed++; finish(0); }
            };
          };
          globalThis.fetch = async (url) => url.includes('/json/new')
            ? Response.json({ webSocketDebuggerUrl: 'ws://fixture.test' })
            : new Response('ready');
          globalThis.WebSocket = class {
            constructor() { queueMicrotask(() => this.onopen()); }
            send(data) {
              const { id, method } = JSON.parse(data);
              const response = method === 'Runtime.enable'
                ? { error: { message: 'fixture primary CDP failure' } }
                : ${diagnosticsFail}
                  ? { error: { message: 'fixture diagnostic CDP failure' } }
                  : { result: { result: { value: 'fixture page details' } } };
              queueMicrotask(() => this.onmessage({ data: JSON.stringify({ id, ...response }) }));
            }
            close() { closed = true; }
          };
          await assert.rejects(import(${JSON.stringify(script)}), /fixture primary CDP failure/);
          assert.equal(killed, 2, 'Both started processes must be stopped.');
          assert.equal(closed, true, 'The CDP socket must close.');
          assert(diagnostics.some(line => line.includes(
            ${JSON.stringify(diagnosticsFail ? 'fixture diagnostic CDP failure' : 'fixture page details')}
          )), 'Diagnostic information must remain visible.');
        `,
        ],
        { env: { ...process.env, TMPDIR: root, BROWSER_ARTIFACT_DIR: join(root, 'artifacts') } }
      );
      expect(new TextDecoder().decode(result.stderr)).toBe('');
      expect(result.exitCode).toBe(0);
      expect(await readdir(root)).toEqual(['artifacts']);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}

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
