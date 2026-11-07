import { execFileSync } from 'node:child_process';
import path from 'node:path';
import type { Plugin, ViteDevServer } from 'vite';

/** Bun owns TS loading on every supported Node host, including before native type stripping. */
export function designTokens(root: string) {
  const source = path.resolve(root, 'src/design-system/tokens.ts');
  const generator = path.resolve(root, 'scripts/design-tokens/generate.ts');
  const regenerate = () =>
    execFileSync('bun', [generator], { cwd: root, encoding: 'utf8', stdio: 'pipe' }).trim();

  return {
    name: 'design-tokens',
    buildStart() {
      regenerate();
    },
    configureServer(server: ViteDevServer) {
      server.watcher.add(source);
      server.watcher.on('change', (file) => {
        if (path.resolve(file) !== source) return;
        try {
          server.config.logger.info(regenerate());
        } catch (error) {
          server.config.logger.error('design tokens: regeneration failed: ' + String(error));
        }
      });
    },
  } satisfies Plugin;
}
