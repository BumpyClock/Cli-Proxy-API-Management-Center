import { readdirSync } from 'node:fs';
import path from 'node:path';

/** Source-relative paths use one separator before exclusions or module resolution. */
export const sourcePath = (entry: string): string => 'src/' + entry.replaceAll('\\', '/');

export function listSourceFiles(root: string): string[] {
  return readdirSync(path.join(root, 'src'), { recursive: true })
    .map(String)
    .map(sourcePath)
    .filter((file) => /\.(scss|tsx?)$/.test(file) && !file.endsWith('.d.ts'))
    .sort();
}
