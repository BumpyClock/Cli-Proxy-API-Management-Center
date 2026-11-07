import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { compileString } from 'sass';
import { FieldShell, YamlKey } from '@/features/config/components/fields/FieldPrimitives';
import { productionLocales } from './helpers/locales';

const fieldCssPath = 'src/features/config/components/fields/Field.module.scss';
const fieldCss = compileString(
  `@use 'src/styles/variables' as *;\n${readFileSync(fieldCssPath, 'utf8')}`,
  { loadPaths: [process.cwd()], url: pathToFileURL(fieldCssPath) }
).css;
const rule = (selector: string) =>
  fieldCss.match(new RegExp(`${selector.replace('.', '\\.')} \\{([^}]*)\\}`))?.[1] ?? '';

describe('config labels keep YAML keys out of the human title', () => {
  test('no config label carries a parenthesised YAML key in any locale', () => {
    for (const [locale, messages] of Object.entries(productionLocales)) {
      const visual = messages.config_management.visual;
      const labels = [
        visual.sections.auth.auth_dir,
        visual.api_keys.label,
        visual.payload_rules.from_protocol,
        visual.payload_rules.match,
        visual.payload_rules.notMatch,
        visual.payload_rules.exist,
        visual.payload_rules.notExist,
      ];
      for (const label of labels) {
        expect(label, locale).not.toMatch(/[(（][a-z-]+[)）]|auth-dir|api-keys/);
      }
    }
  });

  test('the YAML key renders as secondary mono text after the label', () => {
    const markup = renderToStaticMarkup(
      createElement(
        FieldShell,
        {
          label: createElement(
            'span',
            null,
            'Auth Directory',
            createElement(YamlKey, { name: 'auth-dir' })
          ),
        },
        createElement('input')
      )
    );
    // Module class names are not mapped under bun:test; the element and its order are the contract.
    expect(markup).toMatch(/<label>.*Auth Directory <code[^>]*>auth-dir<\/code>.*<\/label>/);
    expect(
      readFileSync('src/features/config/components/fields/FieldPrimitives.tsx', 'utf8')
    ).toContain('<code className={styles.yamlKey}>{name}</code>');
    expect(rule('.yamlKey')).toContain('font-family:');
    expect(rule('.yamlKey')).toContain('font-size: 12px');
    expect(rule('.yamlKey')).toContain('font-weight: 400');
  });

  test('call sites pass the backend keys for the labels that used to embed them', () => {
    const sources = [
      'src/features/config/components/sections/SectionConnectivity.tsx',
      'src/features/config/components/blocks/ApiKeysCardEditor.tsx',
      'src/features/config/components/blocks/PayloadRulesEditor.tsx',
    ]
      .map((path) => readFileSync(path, 'utf8'))
      .join('\n');
    for (const key of ['auth-dir', 'api-keys', 'from-protocol', 'exist', 'not-exist']) {
      expect(sources).toContain(`<YamlKey name="${key}" />`);
    }
    expect(sources).toContain("conditionKey === 'match' ? 'match' : 'not-match'");
  });
});

describe('config toggle cards', () => {
  test('top-align their content so paired titles share a line', () => {
    expect(rule('.toggleRow')).toContain('align-items: start');
    expect(rule('.toggleRow')).toContain('height: 100%');
  });
});
