# Thermo-nuclear implementation review

## Verdict

**Request changes.** Two P1 behavior risks and five P2 structural or contract findings remain. Passing tests do not cover the newly shared quota writers or automatic-check side effects.

Reviewed against `ccc4ecf6d4ec4d289f9b8bc1867da885172e1967`. Scope includes the whole redesign, tracked changes, and untracked product source/tests. This is not a review of only the attention panel. Line references describe the reviewed working tree.

Only this report was written. No source edits, commits, agents, deployments, credential reads, or production/API mutations were performed. Offline probes replaced API methods with synthetic responses. Generated screenshots were not audited.

## Findings

### 1. P1. Shared quota cache now has independent request owners, allowing older responses to replace newer snapshots.

**Locations.** `src/features/dashboard/components/QuotaSummaryChart.tsx:57-75`; `src/features/quota/QuotaPage.tsx:265-304`; `src/features/quota/hooks/useQuotaBatchLoader.ts:33-42,92-112`.

**Observed evidence.** Dashboard and Quota now automatically start separate instances of `useQuotaBatchLoader`. Its loading and request-ID guards belong to each hook instance, but both instances write the same Zustand maps. Cache generation only rejects a different connection or invalidated credential. It does not order two requests within the same connection. The loader has no unmount invalidation, so leaving the first route does not remove its pending writer.

An offline probe captured two real loader instances through React server rendering. Both requested the same synthetic Claude credential. Resolving the newer request with 80% used, then the older request with 10% used, changed the shared cache from 80 back to 10. The older response also received a newer `checkedAt` and `stale: false`. Two upstream calls were started. This is reachable by opening Dashboard, entering Quota before the first checks finish, then receiving responses out of order. It does not require simultaneous mounted pages or a connection change.

**Impact.** Operators can receive stale quota marked as the newest successful check. The next maintainer must reason about independent batch refs, individual-action guards, provider fetchers, and one shared cache to establish whether a write is current.

**Simplifying restructuring.** Give request identity and commits one owner at the shared quota-cache boundary, keyed by session, provider, and credential identity. Both batch and individual refreshes should join an in-flight read or use the same per-key latest-request rule. Keep batches as collections of those operations, not separate cache writers. Preserve the existing session and per-file invalidation checks. Do not globally serialize unrelated accounts or remove entry checks.

**Verification needed.** Deferred-response tests across two consumers and across route unmount/re-entry. Resolve newer success before older success/failure. Assert the newer payload and its original timestamp survive. Repeat for batch versus individual refresh and for connection/file invalidation.

### 2. P1. Automatic entry checks can send paid xAI inference requests without an explicit health-test action.

**Locations.** `src/features/quota/refreshScope.ts:37-59`; `src/features/dashboard/components/QuotaSummaryChart.tsx:61-75`; `src/features/quota/QuotaPage.tsx:289-304`. Relevant unchanged adapter behavior is in `src/features/quota/providers/xai/data.ts:101-132,156-157,175-178`.

**Observed evidence.** The new automatic target resolver selects every classified xAI account. The existing adapter is not a read-only allowance operation. Recognized paid accounts call `requestXaiPaidHealth`; failed free-billing reads can fall back to it. That operation sends `POST https://api.x.ai/v1/chat/completions`, model `grok-4.5`, message `ping`, and `max_tokens: 1`.

An offline probe passed a synthetic paid xAI entry through the real automatic target resolver and adapter with `apiCallApi.request` replaced. It selected one automatic target and produced a profile GET plus that completion POST. No external inference was executed. Actual billing cost is not established by this review.

**Impact.** Merely entering Dashboard or Quota can consume inference capacity and potentially incur charges. Dashboard re-entry repeats it despite the graph having no finite allowance to plot for paid-health results. The regression is the new automatic invocation, not the pre-existing explicit adapter capability.

**Simplifying restructuring.** Separate automatic allowance observation from explicit health/inference testing in the provider contract. Automatic checks must use the non-generative operation and must not enter the inference fallback. Keep paid health tests available through a deliberate action with truthful wording. Make this provider-owned capability, not scattered `type === 'xai'` checks in both pages. Preserve automatic entry checks for eligible observational providers.

**Verification needed.** Spy on management API-call payloads for recognized paid xAI and failed free-billing cases. Enter/re-enter both routes. Assert no completion request occurs automatically. Assert the explicit health action still uses its existing contract.

### 3. P2. The new chart model expands independent accounts into a quadratic matrix and eagerly mounts its hidden table.

**Locations.** `src/features/quota/quotaAccountSeries.ts:46-62`; `src/components/ui/TimeSeriesChart.tsx:241-273`; `src/features/quota/QuotaPage.tsx:493-516`.

**Observed evidence.** `buildAccountSeries` unions every account's reset timestamps, then materializes every account at every timestamp. `TimeSeriesChart` maps the entire resulting matrix into table cells even when its native disclosure is closed. Quota now passes all filtered accounts rather than the previous page-sized overview. Dashboard has no pagination at this boundary either.

Deterministic synthetic counts, with one distinct real reset per account:

- 60 accounts produce 62 timestamps and 3,720 eagerly rendered data cells.
- 250 accounts produce 252 timestamps and 63,000 cells.
- 500 accounts produce 502 timestamps and 251,000 cells. Server rendering produced 3,011,207 bytes of markup for the closed chart disclosure, excluding the SVG plot and account breakdown.

These are actual data/markup counts, not browser latency measurements. Each source account pool needed only four points. The quadratic expansion comes from the chosen common matrix, not backend work or missing-data recovery. Pointer/keyboard inspection also rerenders this table subtree.

**Impact.** Large credential fleets inherit unnecessary allocation, reconciliation, and DOM costs. Closed details do not defer React rendering. Pagination of legacy cards does not bound the new chart table.

**Simplifying restructuring.** Keep independent series as their own short point arrays. Let the chart adapter render those series without copying every constant allowance at every other account's reset. Provide quota's existing account/reset breakdown as the accessible evidence instead of a second dense projection table. Mount or paginate expanded evidence on demand. Preserve keyboard inspection, independent percentages, unknown values, and next-real-reset-only semantics. A lazy table alone mitigates DOM cost but does not remove the model expansion.

**Verification needed.** Add deterministic size-bound tests for hundreds of distinct resets. Assert initial collapsed rendering is not quadratic. Exercise series switches and keyboard inspection with a large synthetic fleet in a browser; measure browser cost separately rather than treating SSR byte counts as latency.

### 4. P2. The new per-account refresh path certifies old snapshot-backed quota as freshly checked.

**Locations.** `src/features/quota/QuotaPage.tsx:320-325`; `src/features/quota/components/QuotaOverview.tsx:174-180`; `src/features/quota/hooks/useQuotaActions.ts:48-53`. Relevant adapter behavior is `src/features/quota/providers/qoder/data.ts:29-39`.

**Observed evidence.** This diff replaces the overview's list-first refresh flow with direct `refreshQuota(entry.file, adapter)`. Qoder's fetcher only reads `file.usage`; it makes no new backend request. `successfulSnapshot` then clears stale state and stamps the current time onto the same accepted list object. The previous overview refresh deliberately called `handleRefresh(provider)` to reload auth files first.

An offline probe retained a list object with 10 used of 100, represented backend progression to 90 used, then invoked the new direct adapter/snapshot path. It returned the old 10-used value with a new successful timestamp and `stale: false`. Refresh All still reloads the list, but the new primary account-row refresh does not. README's Qoder verification instructions also still refer to the removed provider Refresh action.

**Impact.** Clicking refresh can report success without observing current usage. This is more than cosmetic stale wording because the new timestamp explicitly certifies the unchanged snapshot.

**Simplifying restructuring.** Give list-backed and remote quota reads an explicit refresh contract. Reuse list-first orchestration for account refreshes that require a fresh auth-file snapshot, then resolve targets from that accepted list. Do not repair this with Qoder-specific conditions inside table rendering. Keep filter changes request-free. Dashboard refresh should follow the same observation contract for any included snapshot-backed account.

**Verification needed.** Change only synthetic backend Qoder usage while keeping the mounted UI's list object unchanged. Invoke the row refresh. Assert a list read occurs and the new usage reaches account details before a successful-check timestamp advances. Failed list reads must not certify the old data as fresh.

### 5. P2. Production tests depend on staging translations and can pass while shipped locale bundles are wrong.

**Locations.** `tests/quotaOverviewRendering.test.ts:5-19`; `tests/dashboardQuotaSummary.test.ts:15-18,31-47`; `tests/usagePageRedesign.test.ts:10-16`; `tests/providerWorkbenchRedesign.test.ts:13-16`; `tests/authFileCard.test.ts:125-143`; `tests/configPresentation.test.ts:45-70`.

**Observed evidence.** The tests import or read `design-review/implementation-i18n` instead of testing `src/i18n/locales`. Several replace the production namespace; the quota overview suite overwrites the shared i18n singleton using `addResourceBundle(..., true, true)`. The four staged fragment trees currently match production according to a recursive comparison, so the second authority buys no coverage. Removing or failing to land local review artifacts would also make product tests fail to load.

**Impact.** Missing, stale, or incorrect production translations can be hidden by test-only resources. Tests now require local review tooling/evidence to ship with the application repository. Global bundle mutation also obscures what subsequent suites are verifying.

**Simplifying restructuring.** Delete the staging-resource dependency from product tests. Initialize isolated instances from the actual four production locale bundles. Test key/interpolation parity on those bundles. Keep useful design-review evidence separate and optional. Update `src/features/quota/README.md`'s final integration instructions, which still describe translations and dependencies as waiting to be merged/installed.

**Verification needed.** Run the relevant suites without loading anything from `design-review`. Introduce a missing required key in a disposable in-memory copy of a production bundle and verify the parity assertion detects it. No source mutation is required to exercise this negative case.

### 6. P2. The OAuth editor redesign replaces an existing shared style owner with near-identical page copies.

**Locations.** `src/pages/AuthFilesOAuthExcludedEditPage.tsx:24`; `src/pages/AuthFilesOAuthModelAliasEditPage.tsx:23`; both new `src/pages/AuthFilesOAuth*EditPage.module.scss:1-91` files. Existing owner is `src/features/authFiles/components/OAuthEditor.module.scss`.

**Observed evidence.** Both pages previously imported the same feature-owned editor stylesheet. They now import separate new modules whose first 91 lines are identical, covering the page shell, loading state, description, card header, section heading, step number, title, and mobile padding. Their shared child components still use the existing feature stylesheet. The redesign therefore gives the same editor presentation contract three coordination points rather than improving its ownership boundary.

**Impact.** The next editor spacing, focus, or mobile correction must be duplicated across page modules and reconciled with feature-owned children. This is new duplication of an existing canonical abstraction, not a request to rewrite unrelated editors.

**Simplifying restructuring.** Update/reuse the feature-owned editor styles for common redesigned presentation. Keep only genuinely unique excluded-model and alias-body rules separate, if needed. Keep `PageHeader`; restoring the old visual treatment or introducing a new generic screen framework is unnecessary.

**Verification needed.** Render both editor routes with long labels, loading/errors, and dirty/save states. Check desktop and narrow layouts, keyboard focus, and unsaved-change behavior. Compare source ownership to ensure shared shell rules have one definition.

### 7. P2. The new exact quota breakdown exposes provider translation keys as account evidence.

**Location.** `src/features/quota/components/QuotaOverview.tsx:144-146`. Compare `src/features/dashboard/components/QuotaSummaryChart.tsx:104-109` and provider observations in `src/features/quota/providers/meta/data.ts:37-42` and `src/features/quota/providers/copilot/data.ts:26-30`.

**Observed evidence.** The table renders `window.label` directly, although Meta and Copilot observations supply keys such as `meta_quota.weekly` and `copilot_quota.premium_interactions`. Dashboard explicitly translates the same model label; Quota does not. An offline render using the real English production bundle produced `<small>meta_quota.weekly</small>`, while `i18n.t('meta_quota.weekly')` returned `Weekly quota`.

**Impact.** Operators see internal keys where the table promises exact window evidence. This affects all four locales and exposes a mixed raw-text/translation-key contract at a new presentation boundary.

**Simplifying restructuring.** Apply one localized-label policy to the shared quota observation presentation. At minimum, use the same key-with-display-fallback resolution as Dashboard. Prefer carrying explicit label key/params versus display text when extending the observation contract, rather than adding provider-name branches to each consumer. Preserve upstream-provided display labels.

**Verification needed.** Render Meta and Copilot breakdowns using actual production bundles in every locale. Assert translated window names, no internal keys, and correct fallback for a literal provider label.

## Strongest restructuring sequence

1. Give quota requests and successful observation timestamps one shared owner. Route-entry checks, account refreshes, and bulk operations become consumers, not competing writers.
2. Make provider operation semantics explicit. Distinguish observational reads, snapshot-backed refresh requirements, and deliberate inference/health actions. This resolves findings 2 and 4 without scattering provider special cases.
3. Keep quota projections sparse and reuse the exact breakdown as accessible evidence. Do not materialize an account-by-every-reset table by default.
4. Remove the translation staging layer from tests and restore the existing feature-owned editor styling boundary. These changes delete coordination work rather than adding abstractions.

Do not remove automatic entry checks, retain-cache-on-refresh/failure behavior, independent allowance scales, real-reset-only projections, truthful Usage states, plugin trust gates, or the quiet healthy dashboard while fixing these findings.

## Scope and checks

- Read the complete requested review skill, repository guidance, local guidance, programming/review guidance, and applicable ownership/model/verification principles.
- Inspected the whole redesign diff, new source/tests, package changes, production locales/themes, and relevant request/cache/provider callers. No changed or new source file crossed from below 1,000 lines to above it. Existing oversized layout/log/plugin files are not new threshold violations and do not justify unrelated decomposition in this PR.
- Ran `git diff --check ccc4ecf6d4ec4d289f9b8bc1867da885172e1967`. Passed.
- Ran the nine focused suites below. **82 passed, 0 failed, 946 assertions.** Bun reported `1.4.4`; the repository pin is `1.3.14`. These were existing implementation tests, not newly added review tests.
- Ran offline probes for two independent quota writers, automatic paid-xAI dispatch, Qoder snapshot refresh, production-label rendering, and dense chart data/closed-table size. Probes used only synthetic values and in-memory substitutions.
- Recursively compared staged locale fragments with production leaves. No differences found at review time. This establishes redundant ownership, not proof that the tests enforce production parity.
- Reviewed the lockfile rewrite. Existing package versions and integrity fields were unchanged; 38 package entries were added. Existing packages were repointed to a Microsoft package-feed mirror. Ranged read-only GET probes returned HTTP 206 for representative mirror artifacts in this environment. This is not evidence of a clean external CI install. No dependency installation was performed. A HEAD probe returned 405 and a direct npm HEAD failed in the local network, so neither supports claiming the mirror is inaccessible.
- `../CLIProxyAPI` is unavailable; only `../CLIProxyAPIPlus` exists locally. No endpoint/payload change is proposed or externally validated by this review. Findings rely on existing frontend/provider contracts, not guessed backend behavior.
- Did not rerun full lint/build or browser verification. The supplied 1,025-test/lint/build and Railway evidence was treated as prior implementation verification, not independent proof of these findings. No browser/tab metadata was read or published.
- Useful existing checks cover real projection values, stale-cache retention, masked Usage identifiers, Usage request ordering, and theme contrast. Source-substring tests of route orchestration do not exercise cross-consumer request ownership and should not substitute for the deferred-response tests requested above.

Focused command executed:

```sh
bun test tests/quotaRedesign.test.ts tests/dashboardQuotaSummary.test.ts tests/timeSeriesChart.test.ts tests/usagePageConcurrency.test.ts tests/usagePageRedesign.test.ts tests/authFileCard.test.ts tests/providerWorkbenchRedesign.test.ts tests/configPresentation.test.ts tests/redesignThemeContrast.test.ts
```

## Reproducible offline race probe

Run from repository root. This invokes the actual hook/store flow, stubs only the provider request, and makes no network calls or filesystem writes. React server rendering is used to obtain independent hook closures; it does not verify browser navigation or effects.

```sh
bun -e '
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import "./src/i18n";
import { useQuotaBatchLoader } from "./src/features/quota/hooks/useQuotaBatchLoader";
import { QUOTA_ADAPTERS } from "./src/features/quota/providers";
import { useQuotaStore } from "./src/stores/useQuotaStore";
let resolveOld, resolveNew;
const oldResponse = new Promise(r => { resolveOld = r; });
const newResponse = new Promise(r => { resolveNew = r; });
let calls = 0, first, second;
QUOTA_ADAPTERS.claude.fetchQuota = () => ++calls === 1 ? oldResponse : newResponse;
function Capture({ which }) {
  const loader = useQuotaBatchLoader();
  if (which === 1) first = loader; else second = loader;
  return null;
}
renderToStaticMarkup(React.createElement(Capture, { which: 1 }));
renderToStaticMarkup(React.createElement(Capture, { which: 2 }));
const targets = [{ file: { name: "review-fixture", provider: "claude" }, type: "claude" }];
const olderRun = first.loadQuota(targets);
const newerRun = second.loadQuota(targets);
const data = usedPercent => ({ windows: [{ id: "weekly", label: "Weekly", usedPercent,
  resetAtMs: Date.now() + 100000, periodHours: 168 }] });
resolveNew(data(80));
await newerRun;
console.log("after_newer", useQuotaStore.getState().claudeQuota["review-fixture"]);
resolveOld(data(10));
await olderRun;
console.log("after_older", useQuotaStore.getState().claudeQuota["review-fixture"]);
console.log("calls", calls);
'
```

Observed output preserves 80 used only until the older promise resolves, then replaces it with 10 used and a new successful timestamp. The repaired implementation must not make that replacement.
