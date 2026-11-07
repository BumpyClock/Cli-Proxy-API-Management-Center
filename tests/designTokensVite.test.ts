import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ViteDevServer } from 'vite';
import { designTokens } from '../scripts/design-tokens/vite';

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'cpamc token plugin '));
  roots.push(root);
  const source = path.join(root, 'src/design-system/tokens.ts');
  const output = path.join(root, 'src/design-system/generated/_tokens.scss');
  const generator = path.join(root, 'scripts/design-tokens/generate.ts');
  mkdirSync(path.dirname(output), { recursive: true });
  mkdirSync(path.dirname(generator), { recursive: true });
  writeFileSync(source, 'export const size = 7 as const;');
  writeFileSync(
    generator,
    [
      "import { size } from '../../src/design-system/tokens.ts';",
      "await Bun.write('src/design-system/generated/_tokens.scss', String(size));",
      "console.log('Design token fixture generated.');",
    ].join('\n')
  );
  return { root, source, output, plugin: designTokens(root) };
}

describe('Vite token generation boundary', () => {
  test('build startup loads TypeScript through Bun and propagates invalid-registry failures', () => {
    const { plugin, source, output } = fixture();
    plugin.buildStart();
    expect(readFileSync(output, 'utf8')).toBe('7');
    writeFileSync(source, 'export const size = ;');
    expect(() => plugin.buildStart()).toThrow();
    expect(readFileSync(output, 'utf8')).toBe('7');
  });

  test('an invalid dev save is logged and a later valid save regenerates fresh values', () => {
    const { plugin, source, output } = fixture();
    plugin.buildStart();
    const listeners = new Map<string, (file: string) => void>();
    const watched: string[] = [];
    const errors: string[] = [];
    const messages: string[] = [];
    const server = {
      watcher: {
        add(file: string) {
          watched.push(file);
        },
        on(event: string, listener: (file: string) => void) {
          listeners.set(event, listener);
        },
      },
      config: {
        logger: {
          info(message: string) {
            messages.push(message);
          },
          error(message: string) {
            errors.push(message);
          },
        },
      },
    } as unknown as ViteDevServer;
    plugin.configureServer(server);
    expect(watched).toEqual([source]);
    const change = listeners.get('change');
    if (!change) throw new Error('Missing change listener');
    change(path.join(path.dirname(source), 'other.ts'));
    expect(messages).toEqual([]);
    writeFileSync(source, 'export const size = ;');
    expect(() => change(source)).not.toThrow();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('design tokens: regeneration failed:');
    expect(readFileSync(output, 'utf8')).toBe('7');
    writeFileSync(source, 'export const size = 11 as const;');
    change(source);
    expect(readFileSync(output, 'utf8')).toBe('11');
    expect(messages).toEqual(['Design token fixture generated.']);
  });
});
