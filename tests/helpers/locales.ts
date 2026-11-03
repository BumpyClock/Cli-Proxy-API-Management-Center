import { createInstance } from 'i18next';
import en from '@/i18n/locales/en.json';
import zhCN from '@/i18n/locales/zh-CN.json';
import zhTW from '@/i18n/locales/zh-TW.json';
import ru from '@/i18n/locales/ru.json';

export const productionLocales = { en, 'zh-CN': zhCN, 'zh-TW': zhTW, ru };
export type TestLanguage = keyof typeof productionLocales;

export async function createTestI18n(language: TestLanguage = 'en') {
  const i18n = createInstance();
  await i18n.init({
    lng: language,
    fallbackLng: false,
    interpolation: { escapeValue: false },
    resources: Object.fromEntries(
      Object.entries(productionLocales).map(([locale, translation]) => [
        locale,
        { translation: structuredClone(translation) },
      ])
    ),
  });
  return i18n;
}

function flatten(value: unknown, path = ''): Record<string, unknown> {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return Object.fromEntries(
      Object.entries(value).flatMap(([key, child]) =>
        Object.entries(flatten(child, path ? `${path}.${key}` : key))
      )
    );
  }
  return { [path]: value };
}

const interpolationVariables = (value: string) =>
  [...new Set([...value.matchAll(/{{-?\s*([\w.]+)(?:\s*,[^}]+)?\s*}}/g)].map((m) => m[1]))]
    .sort()
    .join(',');

export function localeParityIssues(
  locales: Record<string, unknown>,
  sections: readonly string[]
): string[] {
  const selected = (path: string) =>
    sections.some((section) => path === section || path.startsWith(`${section}.`));
  const reference = flatten(locales.en);
  const keys = Object.keys(reference).filter(selected);
  const issues = sections
    .filter((section) => !keys.some((key) => key === section || key.startsWith(`${section}.`)))
    .map((section) => `en: missing ${section}`);

  for (const [language, locale] of Object.entries(locales)) {
    const messages = flatten(locale);
    for (const key of Object.keys(messages).filter(selected)) {
      if (!keys.includes(key)) issues.push(`${language}: unexpected ${key}`);
    }
    for (const key of keys) {
      if (!(key in messages)) {
        issues.push(`${language}: missing ${key}`);
        continue;
      }
      const value = messages[key];
      const expected = reference[key];
      if (typeof value !== 'string' || !value.trim()) {
        issues.push(`${language}: empty or non-string ${key}`);
      } else if (
        typeof expected === 'string' &&
        interpolationVariables(value) !== interpolationVariables(expected)
      ) {
        issues.push(`${language}: interpolation mismatch ${key}`);
      }
    }
  }
  return issues;
}
