import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const source = (path: string) => readFileSync(path, 'utf8');
const pages = {
  plugins: source('src/features/plugins/PluginsPage.tsx'),
  store: source('src/features/plugins/PluginStorePage.tsx'),
};
const styles = {
  plugins: source('src/features/plugins/PluginsPage.module.scss'),
  store: source('src/features/plugins/PluginStorePage.module.scss'),
};

describe('round 2 plugin metadata rows', () => {
  test('metadata items are separated by a middle dot, not a vertical rule', () => {
    for (const page of Object.values(pages)) {
      expect(page).not.toContain('<span className={styles.statusDivider} />');
      expect(page).toMatch(
        /<span className=\{styles\.statusDivider\} aria-hidden="true">\s*·\s*<\/span>/
      );
    }
    for (const scss of Object.values(styles)) {
      const rule = scss.slice(scss.indexOf('.statusDivider {'));
      expect(rule.slice(0, rule.indexOf('}'))).not.toMatch(/width: 1px|background:/);
    }
  });

  test('plugin store shortcut uses the standard secondary button height', () => {
    expect(pages.plugins).toMatch(
      /<Button variant="secondary" onClick=\{\(\) => navigate\('\/plugin-store'\)\}>/
    );
  });

  test('trust warning and disabled-notice gating are unchanged', () => {
    // The trust warning renders unconditionally; only the disabled notice is gated.
    expect(pages.store).toMatch(/\n\s*<PluginTrustNotice \/>\n/);
    expect(pages.store).toContain('data && !data.pluginsEnabled');
    expect(pages.plugins).toContain('data && !data.pluginsEnabled');
  });
});
