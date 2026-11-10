# CLI Proxy API Management Center

A single-file Web UI (React + TypeScript) for operating and troubleshooting the **CLI Proxy API** via its **Management API** (config, credentials, and logs).

[中文文档](README_CN.md)

## Maintained fork

`kaitranntt/Cli-Proxy-API-Management-Center` is maintained as the dashboard release stream for **CLIProxyAPIPlus**. Fork releases publish `management.html` assets that CLIProxyAPIPlus can download and bundle independently from the upstream dashboard.

- Clean upstream updates are merged by the `Upstream Sync` workflow after the frozen install and full test/lint/build verification pass.
- Conflicts, failed gates, or push failures for the merged sync branch or `main` update a single assigned `upstream-sync-blocked` issue.
- Fork-only release tags use the upstream-compatible `vX.Y.Z-N` suffix pattern when an extra dashboard asset is needed.

**Main Project**: https://github.com/router-for-me/CLIProxyAPI  
**Example URL**: https://remote.router-for.me/  
**Minimum Required Version**: ≥ 7.2.147 (recommended latest)

Since version 6.0.19, the Web UI ships with the main program; access it via `/management.html` on the API port once the service is running.

## Sponsor

[![https://go.apimart.ai/gh-cli-proxy-api-management-center](./assets/apimart-en.png)](https://go.apimart.ai/gh-cli-proxy-api-management-center)

Thanks to APIMart for sponsoring this project!

APIMart is a low-cost API platform for AI image & video generation — GPT-Image-2 from $0.006/image, 160+ images per dollar. One async API covers both image and video: submit a task, get an ID, fetch results via polling or callback. Batch tens of thousands of images without timeouts, switch models without changing code. Pay-as-you-go with no monthly fee — [sign up here](https://go.apimart.ai/gh-cli-proxy-api-management-center) to get started.

## What this is (and isn’t)

- This repository is the Web UI only. It talks to the CLI Proxy API **Management API** (`/v0/management`) to read/update config, upload credentials, and view logs.
- It is **not** a proxy and does not forward traffic.

## Quick start

### Option A: Use the Web UI bundled in CLI Proxy API (recommended)

1. Start your CLI Proxy API service.
2. Open: `http://<host>:<api_port>/management.html`
3. Enter your **management key** and connect.

The address is auto-detected from the current page URL; manual override is supported.

### Option B: Run the dev server

```bash
bun install --frozen-lockfile
bun run dev
```

Open `http://localhost:5173`, then connect to your CLI Proxy API backend instance.

### Option C: Build a single HTML file

```bash
bun install --frozen-lockfile
bun run build
```

- Output: `dist/index.html` (all assets are inlined).
- For CLI Proxy API bundling, the release workflow renames it to `management.html`.
- Before installing custom HTML, disable upstream panel auto-updates or point the updater at your fork's release stream. See [custom-panel deployment](docs/workspace-redesign.md#deploying-a-custom-panel), including the first-access download caveat.
- To preview locally: `bun run preview`

Tip: opening `dist/index.html` via `file://` may be blocked by browser CORS; serving it (preview/static server) is more reliable.

## Connecting to the server

### API address

You can enter any of the following; the UI will normalize it:

- `localhost:8317`
- `http://192.168.1.10:8317`
- `https://example.com:8317`
- `http://example.com:8317/v0/management` (also accepted; the suffix is removed internally)

### Management key (not the same as API keys)

The management key is sent with every request as:

- `Authorization: Bearer <MANAGEMENT_KEY>` (default)

This is different from the proxy `api-keys` you manage inside the UI (those are for client requests to the proxy endpoints).

### Remote management

If you connect from a non-localhost browser, the server must allow remote management (e.g. `allow-remote-management: true`).  
Check the CLI Proxy API server documentation/config comments for the full authentication rules, server-side limits, and edge cases.

## What you can manage (mapped to the UI pages)

- **Dashboard**: live operations view. Credentials, traffic, configuration, and usage refresh every 15 seconds while the page is visible; the model list every minute. An evidence-based status headline, an attention list linking straight to failing credentials and providers, provider and credential health with cooldown reasons and retry times, traffic in your local timezone, and per-model volume, latency, and recent failures when usage statistics are on. Every section shows how old its data is. Dashboard links reset conflicting destination filters; credentials with missing or empty provider types remain discoverable under Other in Auth Files. Returning from an OAuth editor preserves the mounted Auth Files page. Usage shows its exact evidence window and warns when historical cutoffs or retention gaps limit the counts. The quota graph checks eligible accounts once on entry, retains cached snapshots during refresh, and does not poll quota endpoints.
- **Config Panel**: visual editor for common `config.yaml` fields, basic settings, proxy `api-keys`, and source editing with YAML highlighting/search plus a save diff preview.
- **AI Providers**:
  - Gemini/Codex/Claude/Vertex key entries (base URL, headers, proxy, model aliases, excluded models, prefix). Connection tests and model discovery use the current editable proxy setting, including `direct`; clearing it uses the current global proxy or a direct connection, not the credential's old saved proxy. OpenAI-compatible keys retain their individual proxy settings, including public model discovery and unauthenticated retries. Provider refreshes use one full configuration snapshot, so delayed section reads cannot restore partial routing settings after a refresh.
  - OpenAI-compatible providers (multiple API keys, custom headers, model alias import via `/v1/models`, optional browser-side "chat/completions" test).
- **Auth Files**: upload/download/delete JSON credentials, filter/search/pagination, runtime-only indicators, view supported models per credential (when the server supports it), manage OAuth excluded models (supports `*` wildcards), configure OAuth model alias mappings. Credentials with an observed cooldown offer a confirmed Clear cooldown action. Clearing gateway scheduling state does not restore upstream quota.
- **OAuth**: start OAuth/device flows for Codex, Anthropic/Claude, Antigravity, Kimi, Qoder, and xAI/Grok; poll status; submit callback URLs or xAI/Grok displayed codes; import Vertex JSON credentials and iFlow cookies.
Antigravity cards preserve model-specific bucket names and do not label a full 5-hour window as available when its shared weekly allowance is exhausted. Claude legacy `iguana_necktie` pools with partial dollar fields are shown as cloud-session credits, separately from Fable allowances, without inventing recurring periods. Complete dollar balances, including `iguana_necktie`, are shown separately under their backend keys and are not duplicated as credit windows.

Automatic quota reads never run inference. xAI API health tests require a separate action labeled with its potential cost. Snapshot-backed quota refreshes reload auth files before reporting success. Codex resets must be confirmed by the upstream service before the gateway cooldown is cleared. If cooldown clearing fails after redemption, clear it from Auth Files on the original connection instead of spending another reset.

- **Quota Management**: independent-account allowance charts on a fixed 0–100% scale, account comparisons, provider filters, search, and weekly/5-hour views. Eligible accounts are checked automatically on entry and again on route re-entry, without background polling. Cached snapshots remain visible during checks; failures retain them marked stale. Filters, searches, windows, and series visibility do not query quotas again. Dashed projections apply only each account's next reported reset, assuming no further usage, never transferable credits, invented history, or burn rates. Refresh results show partial outcomes and timestamps. Account details retain per-credential refresh, supported reset actions, and the detailed windows timeline. GitHub Copilot shows premium interactions, chat, completions, unlimited allowances, plan, and reset dates through the backend's `/v0/management/copilot-quota` endpoint using the selected credential's `auth_index`.
- **Usage Statistics**: request/token totals, backend-dated daily charts, and masked API/model comparisons from `/v0/management/usage`. Collection-off, unknown, empty, failed, stale, and live states are explicit. Failed refreshes retain accepted snapshots from the same connection. Hour-only aggregates are not turned into invented dated history. Statistics are in memory, reset on backend restart, and do not backfill when collection is enabled.
- **Logs**: tail logs with incremental polling, auto-refresh, search, hide management traffic, clear logs; download request error log files.
- **System**: quick links, update check, request logging toggle, local login data cleanup, and fetch `/v1/models` (grouped view). Requires at least one proxy API key to query models.

### Quota UI verification with mock data

Run `bun run dev` and, in another terminal, `bun tests/fixtures/quotaPreview.ts`. Connect the local UI at `http://127.0.0.1:5173` to `http://127.0.0.1:8318` using any nonempty mock management key. All fixture accounts are labelled `mock-*`; no provider credentials are needed or used. Open Quota Management and check its automatic entry refresh, Remaining, Accounts, provider filters, the detailed windows timeline, light/dark themes, and mobile layouts. To verify Qoder refresh, load its quota, then run `curl -X POST http://127.0.0.1:8318/v0/management/__mock/qoder -H 'Content-Type: application/json' --data '{"used":90}'` and refresh that account's quota row. Account details must show updated usage. This control endpoint exists only in the local fixture. Stop the fixture server afterward. `bun test tests/quotaObservations.test.ts tests/quotaRefreshScope.test.ts tests/quotaPool.test.ts tests/copilotQuotaApi.test.ts` checks provider observations, fresh refresh targets, quota math, and the Copilot boundary.

### Autocomplete browser verification

Run `PLAYWRIGHT_MODULE=/path/to/playwright-core/index.mjs bun scripts/verify-autocomplete-browser.mjs`. Like the other browser checks, it uses Playwright to own Chrome, input handling and browser cleanup. The script starts isolated Vite, checks clipped-container and sheet dropdowns, desktop/mobile bounds, keyboard and distinct pointer selection, valid active-option references after filtering, chevron dismissal without losing input focus, Escape and Tab, then stops Vite and the browser. It uses mock options only. Set `CHROME_PATH` (or `CHROME_EXECUTABLE`) for a non-default Chrome installation; on Linux, point it to system Chromium or use a browser installed for Playwright. Screenshots are written to `docs/screenshots/upstream-backports`.

## Tech Stack

- React 19 + TypeScript 6.0
- Vite 8 (single-file build)
- Zustand (state management)
- Axios (HTTP client)
- react-router-dom v7 (HashRouter)
- Motion (animations)
- Recharts (shared SVG charts, keyboard inspection, and accessible data tables)
- CodeMirror 6 (YAML editor)
- SCSS Modules (styling)
- i18next (internationalization)

## Internationalization

Currently supports four languages:

- English (en)
- Simplified Chinese (zh-CN)
- Traditional Chinese (zh-TW)
- Russian (ru)

The UI language is automatically detected from browser settings and can be manually switched from the login page or header language menu.

## Browser Compatibility

- Build target: `ES2020`
- Supports modern browsers (Chrome, Firefox, Safari, Edge)
- Responsive layout for mobile and tablet access

## Build & release notes

- Linux CI, PR verification, release and fork-sync jobs select Boat. Existing job names, full upstream-sync verification, release history and publication gates are unchanged.
- Public execution is owner-only under the separately approved `BumpyClock` Boat policy. Outsider/bot execution remains blocked. Runner migration does not dispatch a workflow or repair provider billing.

- Vite produces a **single HTML** output (`dist/index.html`) with all assets inlined (via `vite-plugin-singlefile`).
- Tagging `vX.Y.Z` triggers `.github/workflows/release.yml` to publish `dist/management.html`.
- The maintained fork may use `vX.Y.Z-N` release tags for fork-owned dashboard builds.
- The UI version shown on the System page is injected at build time (env `VERSION`, git tag, or `package.json` fallback).

## Security notes

- The management key is stored in browser `localStorage` using a lightweight obfuscation format (`enc::v1::...`) to avoid plaintext storage; treat it as sensitive.
- Use a dedicated browser profile/device for management. Be cautious when enabling remote management and evaluate its exposure surface.

## Troubleshooting

- **Can’t connect / 401**: confirm the API address and management key; remote access may require enabling remote management in the server config.
- **Repeated auth failures**: the server may temporarily block remote IPs.
- **Logs page missing**: enable “Logging to file” in Basic Settings; the navigation item is shown only when file logging is enabled.
- **Some features show “unsupported”**: the backend may be too old or the endpoint is disabled/absent (common for model lists per auth file, excluded models, logs).
- **OpenAI provider test fails**: the test runs in the browser and depends on network/CORS of the provider endpoint; a failure here does not always mean the server cannot reach it.

## Development

```bash
bun run dev        # Vite dev server
bun run build      # tsc + Vite build
bun run preview    # serve dist locally
bun run test       # Bun test suite
bun run lint       # ESLint (fails on warnings)
bun run verify     # test + lint + build
bun run format     # Prettier
bun run type-check # app and build/token tooling, no emitted files
```

Visual and motion values come from one registry, `src/design-system/tokens.ts`. See [docs/design-tokens.md](docs/design-tokens.md) for how to change tokens and what the drift guard enforces (`bun run tokens`, `bun run tokens:check`).

## Contributing

Issues and PRs are welcome. Please include:

- Reproduction steps (server version + UI version)
- Screenshots for UI changes
- Verification notes (`bun run verify`, plus `bun run type-check` when run separately)

## License

MIT
