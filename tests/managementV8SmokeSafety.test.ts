import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

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
