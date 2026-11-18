# Management API v8 integration

This stack keeps the four independent backports below the v8 cutover. The top layer targets the original CLIProxyAPI v8 backend. It does not upgrade, deploy, or modify CLIProxyAPIPlus.

## Compatibility boundary

Contract source is `router-for-me/CLIProxyAPI` at `6db7d4b` (`v8.0.63`), including `docs/management-api-v8.md`, `internal/api/server_management_v8.go`, and the v8 configuration schema. Frontend upstream reference is `upstream-review/main` at `5ce2be1`.

CLIProxyAPIPlus at `c2bbc34c` exposes only v0 management. Use the lower stack layers with that backend. The v8 frontend must report a useful unsupported-backend error instead of silently writing through legacy endpoints.

A successful v8 configuration write saves the v8 YAML layout. Do not point an older Plus process at that migrated file.

## Endpoint families

| Operation                                   | v8 path relative to `/v8/management`                                    |
| ------------------------------------------- | ----------------------------------------------------------------------- |
| Full JSON and YAML configuration            | `/config`, `/config.yaml`                                               |
| Client keys                                 | `/config/access/api-keys`                                               |
| Upstream provider groups                    | `/config/api-keys/<family>`                                             |
| Credentials                                 | `/credentials` and its operation paths                                  |
| Cooldown clearing                           | `/routing/cooldown/reset`                                               |
| OAuth login, status, cancellation, callback | `/oauth/auth-url`, `/oauth/status`, `/oauth/session`, `/oauth/callback` |
| Authenticated provider probes               | `/requests/api-call`                                                    |
| Application and request logs                | `/observability/logs` and its operation paths                           |
| API-key activity                            | `/observability/usage/api-keys`                                         |
| Plugin quota                                | `/plugins/<plugin-id>/quota`                                            |
| Plugin configuration                        | `/config/plugins/configs/<plugin-id>`                                   |
| Plugin store                                | `/plugins/store`                                                        |
| Server model catalog refresh                | `POST /models/refresh`                                                 |

Configuration field writes send bare JSON values. Provider groups and OAuth maps are whole-list or whole-map resources. Read-modify-write operations must preserve unrelated entries and remain bound to the connection that supplied the read. Missing persisted fields may default only for a structured `not_found` response, not for a missing API route.

Dependent JSON and YAML writes send the ETag from their own read as `If-Match`. A changed file returns HTTP 412. Missing ETags block writes instead of falling back to unconditional replacement. The backend and reverse proxy must expose ETag to the browser.

The transport captures connection identity before Axios dispatch and drops stale data, 401 events and version/plugin metadata. Post-mutation cache invalidation supersedes pre-write reads without clearing accepted rows. Optimistic request-log updates also bind rollback, notifications and completion to their original connection.

Each alias diagram action applies to a fresh OAuth map and writes it once, even across providers. Full-list editors preserve metadata on retained alias rows and reject saves when the selected provider's list has changed since load. Conflicting or cancelled writes do not retry against a legacy endpoint.

YAML saves retain the two-stage preview and confirmation. A preview belongs to its connection and draft revision. Changing the draft invalidates the preview. An edit that cannot be applied to the YAML document leaves the draft intact. After a successful write, a failed readback is reported as a verification failure, not a failed save.

Provider edits preserve group policies, unrelated keys, explicit inheritance and model metadata. Existing model and credential rows carry explicit identities. Replacing a removed row with a new, identical-looking row does not inherit the removed row's hidden metadata; reordering retained rows keeps each row's own policy. Connection-test model selection is local to the editor, not a persisted v8 field.

Sponsor operations verify the original aggregate before writing and use one conditional `PATCH /config/api-keys` for all changed families. The v8 backend merges the parent map and replaces only the supplied family lists. A rejected write leaves all families unchanged.

Plugin Management and Plugin Store coordinate mutations on the current connection. While an install, update, configuration change, enable or disable operation, or removal is in progress, the other plugin actions are unavailable. The lock remains active while the operation checks its runtime result, even when navigating between the two screens.

On System, **Refresh models** refreshes the server catalog before reloading `/v1/models`. Entering the page only reads the model list. A failed catalog refresh leaves the displayed list intact. A failed list reload after a successful refresh reports the two outcomes separately.

Both explicit management URL suffixes are stripped when identifying a server so existing mount-scoped storage keys remain stable. This normalization does not provide v0 transport fallback. Plugin-defined HTTP extensions and resource URLs retain the backend's declared v0 paths.

## Fork features without an original v8 equivalent

On Plus, Usage reads `/observability/usage/snapshot` and imports or exports legacy JSON backups through `/observability/usage/{import,export}`. Import replaces the current statistics. Quota reads GitHub Copilot limits from `/credentials/quota/copilot` for the selected credential. These request paths are all relative to `/v8/management`.

OAuth Login discovers the extra built-in login methods through `/oauth/providers` and uses the same v8 start, status, callback, cancel, and import endpoints as the rest of the dashboard. Upstream backends may not have these Plus endpoints. The dashboard does not fall back to v0 or report missing quota or usage as zero.

The v8 usage queue is a destructive consumer. Dashboard and Usage pages must never poll it as a replacement for usage snapshots. The dashboard checks snapshot support even when collection is off, so an absent capability never asks the operator to enable an unusable panel.

## Scope

Preserve hash routing, the single-file build, the design-token registry, the quota observation model, and current workspaces. Do not import upstream login, sponsor, routing-board, or quota-card restyles. Preserve remembered credential storage rather than importing upstream's unrelated storage-v2 reset.

Existing visual configuration fields use their authoritative v8 paths. The unsupported switch-project and switch-preview-model controls and Quota tab are removed. Antigravity credits remain under Advanced. Unknown YAML fields and comments survive unrelated edits.

## Verification

Run `bun run verify` and `bun scripts/migrations/management-v8.mjs`. The route checker also runs in the test suite. Tests cover transport isolation, real 401 handling, provider-group preservation, JSON/YAML optimistic concurrency, cache ownership, legacy-backend diagnostics, absent capabilities and native YAML round trips.

### Disposable native backend

Run the backend and API smoke in the same disposable sandbox. Use a CLIProxyAPIPlus checkout that exposes the Plus v8 endpoints described above. Do not use a live service or its configuration.

1. Build the backend with `go build -o /home/user/cpamc-v8-server ./cmd/server` from its checkout.
2. From the frontend checkout, create `/tmp/cpamc-v8-smoke/auth` and copy `tests/fixtures/managementV8Smoke.yaml` to `/tmp/cpamc-v8-smoke/config.yaml`.
3. Start `/home/user/cpamc-v8-server -config /tmp/cpamc-v8-smoke/config.yaml` from `/tmp/cpamc-v8-smoke` in a separate terminal.
4. Run the smoke from the frontend checkout in that same sandbox.

```bash
CPAMC_SMOKE_BASE=http://127.0.0.1:18318 \
CPAMC_SMOKE_KEY=cpamc-fixture-management-only \
CPAMC_V8_SMOKE_FIXTURE=1 \
bun scripts/verify-management-v8.mjs
```

The key above is public synthetic fixture data. The script refuses non-loopback targets, non-fixture client keys, other credential directories and existing provider credentials. It exercises client keys, provider groups, OAuth, plugin configuration, disabled credential editing and usage backup round trips. It never reads the destructive usage queue. A loopback-only probe first fails through a deliberately unreachable global proxy, then succeeds with `direct`.

The script can also be bundled with `bun build scripts/verify-management-v8.mjs --target=bun --outfile <bundle-path>` and copied into the backend sandbox. Temporary fixture files must be recreated after a sandbox restart if they were removed.

### Native browser checks

Start a fresh Vite server with `bun run dev --host 127.0.0.1 --port 5179 --strictPort`. If the backend is in Boat, use `boat forward <sandbox-id> --remote 18318 --local 18318 --bind 127.0.0.1`. Do not expose the fixture publicly or disable SSH host verification.

```bash
CPAMC_SMOKE_BASE=http://127.0.0.1:18318 \
CPAMC_SMOKE_KEY=cpamc-fixture-management-only \
CPAMC_V8_SMOKE_FIXTURE=1 \
PLAYWRIGHT_MODULE=/path/to/playwright-core/index.mjs \
node scripts/verify-management-v8-browser.mjs
```

Set `CHROME_EXECUTABLE` if needed. The browser uses an isolated context and a real backend. It tests wrong-key feedback, login, usage backups on desktop/mobile, Plus OAuth callback recovery, model-form metadata preservation, replacement-row identity, and conditional visual saves. It simulates one OAuth polling failure and delays one real YAML response to exercise request ownership. Screenshots are saved under `docs/screenshots/management-v8/` or `CPAMC_SCREENSHOTS` if set.

The delayed-load regression was mutation-checked by removing its ownership guard and observing the expected lost-edit failure, then restoring the guard. Autocomplete retains its separate Playwright check, `PLAYWRIGHT_MODULE=/path/to/playwright-core/index.mjs bun scripts/verify-autocomplete-browser.mjs`.

Destroy the disposable sandbox and stop owned Vite/tunnel processes afterward. Real provider OAuth completion, provider refresh/redemption, billable inference and plugin installation are intentionally not exercised. No real credentials or reset credits are used.
