import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import path from 'path';
import { execSync } from 'child_process';
import fs from 'fs';
import { pathToFileURL } from 'url';
import { writeGeneratedFiles } from './scripts/design-tokens/generate';

// Get version from environment, git tag, or package.json
function getVersion(): string {
  // 1. Environment variable (set by GitHub Actions)
  if (process.env.VERSION) {
    return process.env.VERSION;
  }

  // 2. Try git tag
  try {
    const gitTag = execSync('git describe --tags --exact-match 2>/dev/null || git describe --tags 2>/dev/null || echo ""', { encoding: 'utf8' }).trim();
    if (gitTag) {
      return gitTag;
    }
  } catch {
    // Git not available or no tags
  }

  // 3. Fall back to package.json version
  try {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf8'));
    if (pkg.version && pkg.version !== '0.0.0') {
      return pkg.version;
    }
  } catch {
    // package.json not readable
  }

  return 'dev';
}

const TOKENS_SOURCE = path.resolve(__dirname, 'src/design-system/tokens.ts');

/**
 * Regenerates the Sass adapters from src/design-system/tokens.ts at dev-server start, build
 * start and on every registry edit in dev, so Sass never compiles against a stale registry.
 */
function designTokens(): Plugin {
  const regenerate = async () => {
    // A cache-busting query re-evaluates the registry after edits during dev.
    const { tokens } = await import(`${pathToFileURL(TOKENS_SOURCE).href}?t=${Date.now()}`);
    return writeGeneratedFiles(__dirname, tokens);
  };
  return {
    name: 'design-tokens',
    async buildStart() {
      await regenerate();
    },
    configureServer(server) {
      server.watcher.add(TOKENS_SOURCE);
      server.watcher.on('change', async (file) => {
        if (path.resolve(file) !== TOKENS_SOURCE) return;
        const written = await regenerate();
        if (written.length) server.config.logger.info(`design tokens: regenerated ${written.join(', ')}`);
      });
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    designTokens(),
    react(),
    viteSingleFile({
      removeViteModuleLoader: true
    })
  ],
  define: {
    __APP_VERSION__: JSON.stringify(getVersion())
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  css: {
    modules: {
      localsConvention: 'camelCase',
      generateScopedName: '[name]__[local]___[hash:base64:5]'
    },
    preprocessorOptions: {
      scss: {
        additionalData: `@use "@/styles/variables.scss" as *;`
      }
    }
  },
  build: {
    target: 'es2020',
    outDir: 'dist',
    assetsInlineLimit: 100000000,
    chunkSizeWarningLimit: 100000000,
    cssCodeSplit: false,
    rolldownOptions: {
      output: {
        codeSplitting: false
      }
    }
  }
});
