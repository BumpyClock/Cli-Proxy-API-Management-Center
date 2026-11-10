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

Configuration field writes send bare JSON values. Provider groups and OAuth maps are whole-list or whole-map resources. Read-modify-write operations must preserve unrelated entries and remain bound to the connection that supplied the read. Missing persisted fields may default only for a structured `not_found` response, not for a missing API route.

Dependent JSON and YAML replacements send the ETag from their own read as `If-Match`. A changed file returns HTTP 412. Missing ETags block writes instead of falling back to unconditional replacement. The backend and reverse proxy must expose ETag to the browser. YAML saves retain the existing two-stage preview and confirmation workflow.

The transport captures connection identity before Axios dispatch and drops stale data, 401 events and version/plugin metadata. Post-mutation cache invalidation supersedes pre-write reads without clearing accepted rows. Optimistic request-log updates also bind rollback, notifications and completion to their original connection. OAuth exclusion deletion never retries a cancelled or conflicting mutation through a legacy whole-map replacement. YAML loads use request ownership so a delayed initial response cannot erase a newer edit.

Provider edits preserve group policies, unrelated keys, explicit inheritance and model metadata. Existing model and credential rows carry explicit identities. Replacing a removed row with a new, identical-looking row does not inherit the removed row's hidden metadata; reordering retained rows keeps each row's own policy. Connection-test model selection is local to the editor, not a persisted v8 field.

Both explicit management URL suffixes are stripped when identifying a server so existing mount-scoped storage keys remain stable. This normalization does not provide v0 transport fallback. Plugin-defined HTTP extensions and resource URLs retain the backend's declared v0 paths.

## Fork features without an original v8 equivalent

Original v8 has no Plus usage snapshot, Copilot quota endpoint, or built-in Qoder OAuth provider. The frontend must label absent capabilities as unsupported and must not invent usage, balances, or provider support. Existing fork code can remain available for a backend that actually advertises the corresponding capability.

The v8 usage queue is a destructive consumer. Dashboard and Usage pages must never poll it as a replacement for usage snapshots. The dashboard checks snapshot support even when collection is off, so an absent capability never asks the operator to enable an unusable panel.

## Scope

Preserve hash routing, the single-file build, the design-token registry, the quota observation model, and current workspaces. Do not import upstream login, sponsor, routing-board, or quota-card restyles. Preserve remembered credential storage rather than importing upstream's unrelated storage-v2 reset.

Existing visual configuration fields use their authoritative v8 paths. The unsupported switch-project and switch-preview-model controls and Quota tab are removed. Antigravity credits remain under Advanced. Unknown YAML fields and comments survive unrelated edits.

## Verification

Run `bun run verify` and `bun scripts/migrations/management-v8.mjs`. The route checker also runs in the test suite. Tests cover transport isolation, real 401 handling, provider-group preservation, JSON/YAML optimistic concurrency, cache ownership, legacy-backend diagnostics, absent capabilities and native YAML round trips.

### Disposable native backend

Run the backend and API smoke in the same disposable Linux sandbox. Use the pinned original backend checkout, never the user's Plus service or configuration.

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

The key above is public synthetic fixture data. The script refuses non-loopback targets, non-fixture client keys, other credential directories and existing provider credentials. It exercises client keys, provider groups, OAuth maps, plugin configuration and disabled synthetic credential upload, fields, cooldown, download and deletion. A loopback-only probe first fails through a deliberately unreachable global proxy, then succeeds with `direct`. Usage absence is checked without reading the destructive queue.

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

Set `CHROME_EXECUTABLE` if needed. The browser uses an isolated context and real native backend responses. It tests wrong-key feedback, login, unsupported usage on desktop/mobile, OAuth choices, actual model-form metadata preservation, replacement-row identity, a delayed initial YAML response and conditional visual saves. It delays one real YAML response to exercise request ownership; it does not fabricate API data or inject application stores. Screenshots are saved under `docs/screenshots/management-v8/`.

The delayed-load regression was mutation-checked by removing its ownership guard and observing the expected lost-edit failure, then restoring the guard. Autocomplete retains its separate Playwright check, `PLAYWRIGHT_MODULE=/path/to/playwright-core/index.mjs bun scripts/verify-autocomplete-browser.mjs`.

Destroy the disposable sandbox and stop owned Vite/tunnel processes afterward. Real provider OAuth completion, provider refresh/redemption, billable inference and plugin installation are intentionally not exercised. No real credentials or reset credits are used.
