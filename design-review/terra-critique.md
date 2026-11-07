# Design critique

## Priority 1. Make refresh status truthful for mixed outcomes

**Observed in source.** `startQuotaRefresh()` sets `quotaSync.last` after every simulated check, including when an account remains failed. `quotaSyncStatus()` then says “Updated just now” indefinitely. The mixed screenshot shows only 3 of 6 loaded, while the global status is green and claims an update. An operator can read that as all displayed values being fresh, and the wording becomes less accurate as the page stays open.

**Minimal remedy.** Say “Check completed” with a time and a compact partial-failure count when applicable. Retain per-account timestamps and stale/error labels. During checking, retain the explicit cached-snapshot message. Do not imply that unsupported or disabled accounts were checked. This is a source-based finding. I did not independently exercise the transition.

## Priority 2. Preserve keyboard focus when changing chart series

**Observed in source.** `lineToggle` calls `rerender()` after changing the set of hidden series. This replaces the invoking button. Focus continuity after activation is therefore at risk and needs an actual keyboard check. The chart also creates a tab stop for every inspected bucket in `drawLinePlot()`, so the full Dashboard chart adds 20 stops before its data table.

**Minimal remedy.** Restore focus to the same series button after updating, or update the affected chart and button without replacing the trigger. Offer one chart tab stop with arrow-key navigation for buckets, or rely on the existing accessible data table for exact values. Verify that an announced selected value and a visible focus indicator follow the chosen interaction. Treat focus loss as an inferred risk until exercised, not as a verified browser failure.

## Priority 3. Clarify chart distinctions at the point of use

**Observed.** The Quota screenshot uses the same dashed stroke for every future account trace. The cyan and amber projections overlap at 100%, and the mapping from lines to account labels depends on color. The explanatory text is below the plot, outside the 390px capture. The Dashboard lines likewise use color to distinguish series. Color-vision differences and overlapping resets can make the mapping difficult.

**Minimal remedy.** Give series a small set of distinct dash patterns or direct labels, in addition to color. Keep projection styling distinct from the measured dots. Put a short “Dashed = projected, no further use” note in the chart header, with the fuller caveat below. Preserve the 0–100% scale, independent accounts, and exact table. Validate contrast in both themes. The difficulty is inferred from the visible encoding, not a tested accessibility result.

## Priority 4. Reduce the mobile path to quota evidence

**Observed.** At 390px, the Quota chart starts near the bottom of the 1000px capture after a header, refresh action, status, prototype controls, provider filters, search, two segmented controls, explanatory paragraph, and three stacked series buttons. The plotted data and account breakdown require further scrolling. At 728px the chart is more immediately visible. The 390px Dashboard similarly puts its graph below the capture, although its attention list usefully leads the page.

**Minimal remedy.** Keep the auto-refresh status adjacent to the title and place the optional manual refresh on the same compact row when space allows. Tighten spacing and wrap the quota series controls as compact multi-column items where their labels fit. Keep provider filters, failure states, and explanatory copy accessible. Prototype-only controls contribute to the captured height and should not be mistaken for production chrome. Do not shrink text or remove the account table to force the chart above the fold.

## What to preserve

**Observed.** Across all 16 desktop captures, the shared navigation, typography, restrained surfaces, and page headers form a coherent operator console. Quota's measurement dots and explicitly projected dashed steps communicate the absence of history more honestly than an invented trend. Dashboard names its ten-minute bucket unit and incomplete current bucket. The sample-data banner remains prominent. These are design strengths to retain.

**Preference.** The combined quota graph is visually quieter than Dashboard's filled request trace. A subtle shared grid and line weight already connect them; avoid adding decorative fills to projected quota data solely for symmetry.

## Recommendation and limits

Spend the final iteration on refresh outcome wording, focus continuity, non-color series identification, and modest mobile compression. Preserve the existing plugin install preview and third-party gate. No new features or architecture are needed for this pass.

I inspected the supplied captures for all 16 routes at 1440px and Quota and Dashboard at 728px and 390px, plus the relevant prototype source, original critique, design notes, and parent verification record. Captures are viewport-only. I did not independently run the prototype, exercise flows, inspect below-fold rendering, verify screen-reader output, measure contrast, or test light theme, zoom, reduced motion, or real backend behavior. The parent's recorded entry-check and self-test results are evidence of its checks, not independent verification by this review.
