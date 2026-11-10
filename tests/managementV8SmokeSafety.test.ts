import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import ts from 'typescript';
import { providersApi } from '@/services/api/providers';

test('verification scripts call existing provider APIs', async () => {
  const root = resolve(import.meta.dir, '../scripts');
  let checked = 0;
  for await (const path of new Bun.Glob('**/*.mjs').scan(root)) {
    const source = ts.createSourceFile(
      path,
      await readFile(resolve(root, path), 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.JS
    );
    const visit = (node: ts.Node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression) &&
        node.expression.expression.text === 'providersApi'
      ) {
        const method = node.expression.name.text;
        expect({ path, method, exists: Object.hasOwn(providersApi, method) }).toEqual({
          path,
          method,
          exists: true,
        });
        checked += 1;
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  expect(checked).toBeGreaterThan(0);
});

for (const optedIn of [false, true]) {
  test(`native smoke refuses non-fixture writes (opt-in=${optedIn})`, async () => {
    const requests: string[] = [];
    const marker = 'synthetic-private-value-not-for-logs';
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch(request) {
        requests.push(request.method);
        return Response.json({ access: { 'api-keys': [marker] } });
      },
    });
    try {
      const child = Bun.spawn(
        [process.execPath, resolve(import.meta.dir, '../scripts/verify-management-v8.mjs')],
        {
          env: {
            ...process.env,
            CPAMC_SMOKE_BASE: `http://127.0.0.1:${server.port}`,
            CPAMC_SMOKE_KEY: 'fixture-only',
            CPAMC_V8_SMOKE_FIXTURE: optedIn ? '1' : '0',
          },
          stdout: 'pipe',
          stderr: 'pipe',
        }
      );
      const [code, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      expect(code).toBe(1);
      expect(requests).toEqual(optedIn ? ['GET'] : []);
      expect(stderr).toContain(
        optedIn ? 'Refusing non-fixture client keys' : 'Explicit fixture-write opt-in'
      );
      expect(stdout + stderr).not.toContain(marker);
      expect(stdout).not.toContain('PASS');
    } finally {
      server.stop(true);
    }
  });
}
