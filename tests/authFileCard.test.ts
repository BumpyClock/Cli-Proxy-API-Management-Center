import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { localeParityIssues, productionLocales } from './helpers/locales';

// The quota host binds CSS-module classes at import time, which Bun cannot render.
// Keep these source contracts small; browser checks cover the actual card interactions.
const source = readFileSync(
  new URL('../src/features/authFiles/components/AuthFileCard.tsx', import.meta.url),
  'utf8'
);

describe('auth file row presentation contract', () => {
  test('uses identity rather than logos or duplicate status badges', () => {
    expect(source).not.toContain('<img');
    expect(source).not.toContain('getAuthFileIcon');
    expect(source).not.toContain('stateBadge');
    expect(source).toContain('<h3');
    expect(source).toContain('{identity.primary}');
    expect(source).toContain('{identity.secondary}');
  });

  test('uses one enable-cell toggle and credential-specific accessible names', () => {
    const selection = source.split('<td className={styles.selectCell}')[1].split('</td>')[0];
    const enableCell = source
      .split("<td data-label={t('auth_files.status_toggle_label')}>")[1]
      .split('</td>')[0];
    expect(source.match(/<ToggleSwitch/g)).toHaveLength(1);
    expect(selection).toContain("ariaLabel={t('auth_files.card_select', { name: file.name })}");
    expect(enableCell).toContain('<ToggleSwitch');
    expect(enableCell).toContain("t('auth_files.card_toggle', { name: file.name })");
    expect(enableCell).toContain('checked={!file.disabled}');
    expect(enableCell).toContain('statusUpdating[file.name] === true || isManualRefreshing');
    expect(enableCell).toContain('!isRuntimeOnly &&');
  });

  test('uses a plain-text weight tooltip while preserving the details link', () => {
    expect(source).toContain("title={t('auth_files.weight_tooltip')}");
    expect(source).not.toContain("title={t('auth_files.weight_hint')}");
    const detailsSource = readFileSync(
      new URL('../src/features/authFiles/components/AuthFileDetailsSheet.tsx', import.meta.url),
      'utf8'
    );
    expect(detailsSource).toContain('i18nKey="auth_files.weight_hint"');

    for (const { auth_files: messages } of Object.values(productionLocales)) {
      expect(messages.weight_tooltip).toBeTruthy();
      expect(messages.weight_tooltip).not.toMatch(/<[^>]+>/);
      expect(messages.weight_hint).toContain('<settingsLink>');
      expect(messages.weight_hint).toContain('</settingsLink>');
      expect(messages.weight_tooltip).toBe(messages.weight_hint.replace(/<\/?settingsLink>/g, ''));
    }
  });

  test('retains individual management actions and warning detail', () => {
    for (const handler of [
      'onShowModels(file)',
      'onDownload(file.name)',
      'onManualRefresh(file)',
      'onOpenPrefixProxyEditor(file)',
      'onDelete(file.name)',
    ]) {
      expect(source).toContain(handler);
    }
    expect(source).toContain('rawStatusMessage && hasStatusWarning');
    expect(source).toContain('showManualRefreshButton');
    expect(source).toContain('file.disabled ||');
  });
});

describe('auth files comparison surface', () => {
  const page = readFileSync(
    new URL('../src/features/authFiles/AuthFilesPage.tsx', import.meta.url),
    'utf8'
  );
  const toolbar = readFileSync(
    new URL('../src/features/authFiles/components/AuthFilesToolbar.tsx', import.meta.url),
    'utf8'
  );

  test('renders credentials as table rows with comparison columns', () => {
    expect(page).toContain('<table');
    expect(page).toContain('<thead>');
    expect(page).toContain('<tbody>');
    expect(page).not.toContain('<VaultPulse');
    expect(source).toContain('<tr');
    expect(source.match(/<td[\s>]/g)).toHaveLength(8);
    expect(source).toContain('<AuthFileQuotaSection');
    expect(source).not.toContain('&& !compact');
    expect(source).toContain('<AuthFileCooldownSection');
    expect(source).toContain('<ProviderStatusBar');
  });

  test('offers editor routes and selection before destructive bulk actions', () => {
    for (const route of [
      '/auth-files',
      '/auth-files/oauth-excluded',
      '/auth-files/oauth-model-alias',
    ]) {
      expect(page).toContain(route);
    }
    expect(toolbar).not.toContain('onDelete');
    expect(page).toContain('onDelete={() => batchDelete(selectedNames)}');
    expect(page).toContain('selectablePageItems.every');
    expect(page).toContain('if (selectedFiles.has(file.name)) toggleSelect(file.name)');
  });

  test('all row utilities have visible labels and retain disable conditions', () => {
    for (const key of [
      'models_button',
      'manual_refresh_button',
      'download_button',
      'prefix_proxy_button',
      'delete_button',
    ]) {
      expect(source).toContain("{t('auth_files." + key + "')}");
    }
    expect(source).toContain('disabled={disableControls || isManualRefreshing}');
    expect(source).toContain(
      'disabled={disableControls || deleting === file.name || isManualRefreshing}'
    );
  });

  test('shipped auth file translations have key and interpolation parity in all languages', () => {
    expect(localeParityIssues(productionLocales, ['redesign.authFiles'])).toEqual([]);
    for (const { redesign } of Object.values(productionLocales)) {
      expect(redesign.authFiles.actionsFor).toContain('{{name}}');
      expect(redesign.authFiles.shown).toContain('{{count}}');
      expect(redesign.authFiles.shown).toContain('{{total}}');
    }
  });
});
