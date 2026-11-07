# CPAMC whole-app critique

Inspected target. Authenticated production Management Center, captured by the parent agent with secrets visually redacted. Desktop captures are 1440x1000 (`current/<route>.png`). Mobile captures are 390 wide, full page (`current/<route>-mobile.png`). Manifests are `manifest.json` and `manifest-mobile.json`.

Who this is for. The operator who runs a CLI Proxy API instance. They check health, add or repair provider keys and OAuth credentials, watch quota and usage, read logs, and change config. Most visits are short and diagnostic. Some are long edit sessions in Config or Auth Files.

Evidence labels used below:

- **Observed.** Visible in the cited screenshot.
- **Source.** Read in the cited file. Source explains behavior but does not prove rendering.
- **Inferred.** A likely cause or consequence that I did not verify.
- **Preference.** A design judgment, not a defect.

## Verification limits

- Desktop captures stop at 1000px because the app scrolls inside its own container. Content below the fold on every desktop route is unverified from desktop evidence. Mobile full-page captures cover most of it.
- `login.png` and `login-mobile.png` come from the local built artifact on `file://`, not the hosted backend. The "Current URL" text on that page reflects the file context.
- The first capture pass showed stale Quick Start content under other route URLs. The parent replaced every PNG with per-route full reloads. I treat that as a capture limitation, not a confirmed product bug. Source note only: `src/components/common/PageTransition.tsx:104` ignores new locations while `isAnimating` is true, and completion waits on `animation.finished` with no timeout. A stalled animation timeline would leave stale content with a moved nav highlight. Not reproduced in a foreground tab.
- Usage. The parent previously verified `usage-statistics-enabled: false` on this backend. The `usage.png` capture shows request data, so collection was switched on independently before capture. I do not claim its current state beyond the screenshot.
- No interaction, focus order, screen reader output, or motion was exercised. Static screenshots cannot prove those.
- Privacy. The parent extended capture redaction to include account names in credential filenames, addresses, deployment URLs, and API-key fingerprints. Affected desktop and mobile screenshots and both manifests were regenerated before handoff. Prototype and written critique contain no production identifiers.

## What to preserve

- **Dashboard language** (`dashboard.png`). Plain status headline ("All systems steady." with the green period), an attention strip that states what was checked ("Checked just now: 4 credentials, 5 providers"), mono metadata ("Updated 30s ago · every 60s"), honest chart captions ("Striped segments are failures; the faded bar is still filling"), and a "Data table" fallback. This is the strongest page and the right base for the whole app.
- **Honest quota copy** (`quota.png`). "100% = one measured account. Current page only; windows may differ. Not shared credits." and "Usage history and burn rates unavailable". The product refuses to invent precision. Keep that voice.
- **Plugin trust warning** (`plugin-store.png`). "Third-party plugins run with full backend access" plus per-card "Third-party" badges.
- **Config sync state** (`config.png`). "61 settings · In sync" header, Visual/Source modes, settings search, and the existing "Review Changes" step (source, `src/i18n/locales/en.json` config "Review Changes").
- **Navigation model.** Four groups (Operate, Gateway, Observe, Control), twelve labels, auth-file count badge, and the conditional Plugins page group (source, `src/components/layout/MainLayout.tsx:657-775`).
- **Usage off state on Dashboard.** `UsagePanel.tsx:30-52` already distinguishes loading, unsupported (`enabled === null`), off, and empty-with-unknown-coverage. That model is correct and should become app-wide.

## Material findings, ordered by operator impact

### 1. Usage Statistics cannot say whether collection is on

- **Source.** `src/pages/UsagePage.tsx` tracks `loading`, `error`, and `usage_stats.no_data` only. It never reads `usage-statistics-enabled`. The Dashboard does (`src/features/dashboard/components/UsagePanel.tsx:34-52`, "Usage statistics are off", link to `/config?field=usageStatisticsEnabled`).
- **Observed.** `usage.png` header says only "Request and token usage from the proxy runtime." There is no collection status, no "since" time, and no note that counts live in memory.
- **Confirmed earlier by parent.** With collection disabled, this page rendered zeros and empty charts with no warning.
- **Impact.** An operator reads "0 requests" as "no traffic" when the truth is "nothing recorded". After a backend restart the totals silently reset, and turning collection on never backfills. Decisions about cost or provider health rest on a number with no stated coverage.
- **Remedy.** A collection status line at the top of Usage with seven explicit states: collection off, backend support unknown, loading, live, empty (on but no requests yet), stale (last refresh failed or old), and error. Each state names its coverage ("Recorded since backend start at 07:12, in memory only") and its next action. Off state replaces the charts instead of showing zeros. Reuse the Dashboard copy keys.

### 2. Usage charts encode nothing readable

- **Observed.** `usage.png` "Requests by Hour" and "Tokens by Hour" each render two flat gray rectangles with no axis, no time labels, no values, and no legend. `usage-mobile.png` shows the same blocks at 390 wide.
- **Inferred.** Two hourly buckets are stretched to full chart width with an auto-scaled axis that is not drawn.
- **Impact.** The operator cannot tell which hour, how many requests, or whether the bars share a baseline. The Dashboard already shows the same traffic correctly (`dashboard.png` throughput chart with axis, peak label, and data table), so the two pages disagree in quality for the same data.
- **Remedy.** One shared time-series component across Dashboard and Usage. Fixed bucket width, zero baseline, labeled y axis, time ticks in the operator's zone, direct value labels on hover or focus, and the "Data table" disclosure.

### 3. Primary buttons look disabled and fail contrast

- **Source.** `src/styles/themes.scss:28` (light paper), `:118` (white), and `:188` (dark) set `--primary-color: #8b8680` with white text in both themes. Measured contrast is 3.61:1, below the 4.5:1 AA floor for normal text.
- **Observed.** "New" (`providers.png`), "Save/Update" (`oauth-excluded.png`), "Add API Key" (`config.png`), "Install" (`plugin-store.png`), "Add Disablement" and "Add Alias" (`auth-files.png` bottom), "Login" (`login.png`). All read as muted gray, the same treatment users expect for disabled controls. Meanwhile "Upload File" (`auth-files.png`) and "Refresh all credentials" (`quota.png`) use a white pill, and OAuth uses bright blue ("Sign Up Now", `oauth.png`).
- **Impact.** The main action of each screen has the lowest visual confidence. Three different primary treatments across pages break the "same look, same behavior" rule.
- **Remedy.** One primary style for the whole app. I use an ink button (foreground color fill, background color text) because it extends the white-pill pattern the newer pages already use. Disabled gets a distinct dashed or reduced treatment plus `aria-disabled` and a reason.

### 4. Warning and error share one color

- **Source.** `themes.scss:35-36`, `:125-126`, and `:195-196` set `--warning-color` and `--error-color` to the same `#c65746` in all three themes.
- **Observed.** The Dashboard works around it with yellow warning text in the REQUESTS cell (`dashboard.png`). The plugin store uses an amber banner. Auth Files uses red for "Failure 3" and for "Delete All".
- **Impact.** "Needs a look" and "broken" look the same, so real failures lose urgency and caveats look like outages.
- **Remedy.** Separate semantic tokens for success, warning, error, and info, each paired with an icon and a text label, never color alone.

### 5. Two visual systems, and every page invents its header

- **Observed.** The Dashboard has a 44px display headline, mono status line, eyebrow sections ("TRAFFIC", "PROVIDERS"). Auth Files and Config copy part of it ("4 credentials · 4 active" mono with a green bar). Usage, Plugins, Logs, System, OAuth use plain titles with gray subtitles. Content left edge is 275px on Providers and Quick Start, 251px elsewhere. Title baselines vary between roughly 88px and 113px across `providers.png`, `auth-files.png`, `usage.png`, `logs.png`.
- **Impact.** Moving between pages feels like moving between products. The operator relearns where status, refresh, and the primary action live on each page.
- **Remedy.** One page header: title, one-line status in mono (count, sync, freshness), page actions on the right in a fixed order (secondary, then primary). One content grid with one left edge.

### 6. Refresh appears twice on almost every page

- **Observed.** The global header has a refresh icon (top right of every desktop screenshot) and each page has its own "Refresh", "Reload", or "Refresh Logs". `plugins.png` has three refresh controls (header icon, toolbar "Refresh", empty-state "Refresh").
- **Impact.** The operator cannot tell whether the header refresh reloads everything or the current page, or how fresh the page is.
- **Remedy.** One refresh per page, placed with a freshness stamp ("Updated 8:06:47"). Keep a global "refresh all" only if it does something different, and label it.

### 7. Auth Files cards bury status and expose risky controls

- **Observed** (`auth-files.png`).
  - Each card spends a full-width row on "Click here to refresh quota", larger than the request stats.
  - Five icon-only buttons per card (refresh, download, settings, delete) plus a toggle, with no visible labels.
  - "Delete All" sits in red in the filter row, next to the status filter.
  - The fourth card leaves two thirds of its row empty, and the OAuth Model Disablement and Aliases sections start below the fold.
  - An unlabeled bar glyph sits under the title (left of the tab row, about 255,165).
  - The filter placeholder is cut ("Use * as a") and the search icon overlaps the text (about 575,273), on mobile too (`auth-files-mobile.png`).
- **Impact.** Scanning four credentials is fine. Scanning forty is slow because the decisive facts (serving or not, failures, quota left) are not aligned across cards. A misclick target for a bulk destructive action sits inside the filter controls.
- **Remedy.** A table of credentials. Columns: provider, credential, status, requests ok and failed, quota, updated, enabled. Row actions go in a labeled menu, details go in a drawer, and bulk actions appear only after selection with a count and a confirm.

### 8. Quota opens as a wall of unloaded empty cards

- **Observed** (`quota.png`, `quota-mobile.png`). Header reads "4 credentials · 0 loaded". Each provider card is about 370px tall with a white dash, "0 / 1" measured accounts, "Not reported", and "Refresh to load this provider's quota." On mobile, four empty cards fill 2400px. The provider tab strip lists providers with 0 accounts (Claude 0, Antigravity 0, Kimi 0, Devin 0) and overflows behind a scroll arrow.
- **Inferred.** Quota is fetched on demand to avoid upstream rate limits. That is a sound reason, but the layout does not explain it.
- **Impact.** The first viewport answers no question. The operator must click per provider to learn anything.
- **Remedy.** Compact rows per provider with a clear unloaded state ("Not loaded. Quota checks call the upstream API."), one "Refresh all credentials" action, last-known snapshot time when available, and providers with zero accounts collapsed into a "No credentials" group.

### 9. AI Providers opens on an empty provider and marks absence as a warning

- **Observed** (`providers.png`, `providers-mobile.png`). Gemini is selected with "No resources yet", while Claude, the only configured family ("1/1 active"), sits seventh. Every unconfigured provider shows a yellow "0" badge. Status pills "1/1 active resources", "1 provider families" read as filters but are static facts.
- **Impact.** The operator lands on nothing and has to hunt for the configured provider. Yellow zeros suggest a problem when "not configured" is a normal state.
- **Remedy.** Configured families first, select the first configured family by default, neutral zero counts, and a resources table on the right with search, model filter, and sort (all preserved).

### 10. OAuth Login gives sponsor cards more weight than the core providers

- **Observed** (`oauth.png`). The two Kimi cards have a blue glow and bright blue "Sign Up Now" plus "Log in to Kimi China" buttons. Muse, Codex, and Anthropic below use the gray primary. No card shows whether a credential for that provider already exists.
- **Impact.** Visual priority follows promotion, not the operator's task. The operator cannot see "already connected" before starting a second login.
- **Remedy.** A uniform provider list with flow type (device code or browser redirect), existing credential count, and one "Start login" action. Sign-up links become secondary text links. A device-code dialog shows the code, the link, a waiting status, and Cancel.

### 11. Quick Start is a single sponsor card

- **Observed** (`quick-start.png`). One "APIKEY.FUN" card with "No configuration yet.", "New", and an external "Register now". The rest of the viewport is empty. Source, `MainRoutes.tsx:24`: this route is the providers workbench with `fixedBrand="apikeyFun"`. `MainLayout.tsx:657-660`: the nav label becomes "APIKEY.FUN" once configured.
- **Impact.** A new operator gets no setup path (provider, credential, client key, first request).
- **Remedy (proposal).** Keep the APIKEY.FUN block intact and add a setup checklist derived from live state. See `design-notes.md`.

### 12. Logs spend most of the viewport on controls

- **Observed** (`logs.png`). About 430px of search, filter chips, toggles, and five action buttons come before the first log line. Six lines are visible at 1440x1000. Every field (INFO, 304, 0s, IP, GET) is a rounded chip, so nothing stands out. "Clear Logs" is solid red next to "Download Logs". Counters "Loaded: 12 lines · Filtered: 88 lines · Hidden: 5888 lines" do not say what was filtered from what. On mobile (`logs-mobile.png`) each entry wraps to four lines.
- **Impact.** Reading logs, the page's job, gets the least space. Chip noise slows scanning for the one 5xx line.
- **Remedy.** One-row toolbar (search, level, method, status, hide management logs, raw, auto refresh, overflow actions). Monospace table with aligned columns. Color only on level and status class. A clear count sentence ("Showing 12 of 5,976 lines · management requests hidden"). Clear Logs behind a confirm.

### 13. Config tabs overflow, and the form carries promotions

- **Observed** (`config.png`). The tab row cuts "Advanced &" at the right edge with no scroll cue. A "BestProxy.com" sponsor badge sits inside the Proxy URL label. "API Keys List (api-keys)" mixes label and YAML key. The helper text "consistent with 'API Key Management' page style" is developer-facing. "Delete" is solid red beside "Copy" and "Edit".
- **Note.** Masked Host Address dots are the capture's privacy CSS, not product behavior.
- **Impact.** Hidden tabs hide settings. The sponsor link inside a security-relevant field reduces trust in the form.
- **Remedy.** Vertical section list on desktop (all eight tabs visible), scrollable tabs on narrow widths, labels in plain words with the YAML key as mono metadata, sponsor content moved out of field labels, quiet destructive buttons until confirm.

### 14. Management Center Info is a splash page

- **Observed** (`system.png`). A 108px logo and a 44px title fill the first viewport. Four facts (UI version, API version, build time "Unknown", connection) use oversized value text. On mobile (`system-mobile.png`, 6972px tall) the model list puts one chip per line.
- **Impact.** The operator who comes to copy a version for a bug report scrolls past branding. The model list is unusable on a phone.
- **Remedy.** A compact facts table with copy buttons, models grouped by provider in collapsible groups with counts and search.

### 15. Preserve plugin installation safeguards

- **Observed** (`plugin-store.png`). "Install" is directly on each card. Third-party status, source, and license appear as metadata. A screenshot cannot establish what clicking Install does.
- **Source.** `src/features/plugins/PluginStorePage.tsx:740-776` opens install options first. Third-party plugins then enter `PluginInstallGateModal.tsx`, which requires publisher review, an access warning, and a final typed confirmation. Installation is not a one-click flow. This source check corrects the initial screenshot-only inference.
- **Preserve.** Restyle the existing preview and three-step trust gate without removing its safeguards. The prototype retains publisher review, explicit access acknowledgment, and typed plugin identity before its local-only simulated install. Official plugins retain the preview without the third-party gate.

### 16. Login wastes half the screen and the primary action looks disabled

- **Observed** (`login.png`). The left half is pure black. "Login" uses the low-contrast gray primary. "Current URL" shows a concatenated `http://file:///...` string (local artifact context).
- **Inferred.** The left panel is a brand or illustration slot that rendered empty in this build.
- **Impact.** First impression is unfinished. The operator cannot see which backend they are about to authenticate against in a clean form.
- **Remedy.** A single centered panel with logo, detected backend URL as mono text, custom URL toggle, key field with reveal, remember toggle with honest storage note, and a high-contrast Login.

### 17. Dashboard details

- **Observed** (`dashboard.png`). A four-line yellow caveat sits inside the REQUESTS KPI cell, so that cell is taller than its peers and the caveat competes with the number. "Management Cente..." is truncated in the sidebar at 1440 on every desktop capture.
- **Observed** (`dashboard-mobile.png`). Content ends near 1500px of a 4320px capture (rechecked on the replaced 08:10 capture). The rest is blank.
- **Inferred.** Sections below the chart use an entrance reveal that did not trigger during full-page capture. Unverified. If real, content is hidden until scroll events fire.
- **Remedy.** Move the coverage caveat to a note row under the KPI band. Widen the sidebar to fit labels (no rename). Make section reveals content-visible by default.

### 18. Smaller consistency issues

- `oauth-excluded.png` and `oauth-model-alias.png` list "Oauth-excluded-models" as a provider chip. Inferred: a config key surfaces as a provider name.
- `usage.png` tables show the raw key prefix as the API label. A nameable label with the masked key as metadata would read better (preference).
- Header icon buttons (refresh, language, theme, logout) have no visible labels or page context (preference, assuming accessible names exist in source).

## Recommendation

Targeted overhaul, not rebrand. IA and labels are sound. The visual debt is structural in three places: no shared page header, no shared state model, and no shared primary or semantic color roles. Extend the Dashboard's language to every route, add one state model for data freshness and collection, and replace card walls with tables where operators compare rows. Details in `design-notes.md`. Prototype in `redesign.html`.
