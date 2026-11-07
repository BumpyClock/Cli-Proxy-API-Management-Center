import { describe, expect, test } from 'bun:test';
import { sourcePath } from '../scripts/design-tokens/source-files';
import { listSourceFiles } from '../scripts/design-tokens/guard';
import { EXCLUDED_SCSS, listScssFiles } from '../scripts/design-tokens/migrate';

describe('portable design-token source paths', () => {
  test.each([
    ['styles\\variables.scss', 'src/styles/variables.scss'],
    ['styles\\themes.scss', 'src/styles/themes.scss'],
    ['design-system\\generated\\_tokens.scss', 'src/design-system/generated/_tokens.scss'],
    ['design-system\\generated\\_themes.scss', 'src/design-system/generated/_themes.scss'],
  ])('Windows path %s is excluded before migration', (entry: string, expected: string) => {
    expect(sourcePath(entry)).toBe(expected);
    expect(EXCLUDED_SCSS.has(sourcePath(entry))).toBe(true);
  });

  test('POSIX paths retain their identity', () => {
    expect(sourcePath('components/ui/Button.module.scss')).toBe(
      'src/components/ui/Button.module.scss'
    );
  });

  test('the guard and codemod share the same source-file census', () => {
    const files = listScssFiles();
    expect(files).toEqual(
      listSourceFiles('.').filter((file) => file.endsWith('.scss') && !EXCLUDED_SCSS.has(file))
    );
    expect(files.some((file) => file.includes('\\'))).toBe(false);
    expect(files.some((file) => EXCLUDED_SCSS.has(file))).toBe(false);
  });
});
