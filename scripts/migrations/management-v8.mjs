import { readFile, readdir } from 'node:fs/promises';

const legacyRoute =
  /['"`]\/(?:auth-files|reset-quota|api-call|api-keys|api-key-usage|model-definitions|logs|request-log|request-error-logs|request-log-by-id|plugin-store|oauth-excluded-models|oauth-model-alias|oauth-session|oauth-callback|get-auth-status|latest-version|quota\/fetch|vertex\/import|(?:codex|anthropic|antigravity|kimi|kimi-ai|xai|devin|meta)-auth-url)(?=[/'"`?])/;
const modules = (await readdir('src/services/api')).filter((path) => path.endsWith('.ts'));
for (const module of modules) {
  const path = `src/services/api/${module}`;
  const source = await readFile(path, 'utf8');
  if (module !== 'legacyBackendProbe.ts' && source.includes('/v0/management')) {
    throw new Error(`Hardcoded v0 transport outside the diagnostic probe in ${path}`);
  }
  const match = source.match(legacyRoute);
  if (match) throw new Error(`Legacy operational route in ${path}: ${match[0]}`);
}
console.log(
  `Checked ${modules.length} API modules for legacy operational routes. Usage/Copilot extensions and the diagnostic v0 probe remain explicit exceptions.`
);
