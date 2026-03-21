## Phase 5.3 Audit: LLM-First Intent Classification Refactor

### 1. Scope

- **Backend focus**: Eliminate keyword-based STATISTICAL/SEMANTIC intent classification and replace it with a single LLM call (`classifyAndExtract`) that simultaneously determines the aggregation template and extracts query metadata. Remove all dead or duplicate keyword files.

Assumption: Phase 5.2 (session persistence, chart lock, mock cleanup) is complete. The backend has working `GET /search/ask`, `GET /search/sessions`, `DELETE /search/sessions/:id` endpoints with `clientId`-scoped chat persistence.

#### 1.1 Current State Assessment

| Area | Finding | Impact |
|------|---------|--------|
| STATISTICAL intent path | 3 LLM calls per query: `reformulateQuery` + `extractMetadata` + `analyzeStatisticalQuery` | Extra latency, pays for duplicate reasoning (intent == template selection) |
| Keyword fallback | `HybridIntentClassifier` falls back to `KeywordIntentClassifier` when LLM confidence < 0.7 | "어떻게" (how) in SEMANTIC_KEYWORDS catches statistical queries like "에러율이 어떻게 돼?" → wrong strategy |
| Dead keyword files | `route-keywords.ts`, `failure-keywords.ts`, `success-keywords.ts`, `warning-keywords.ts`, `edge-case-keywords.ts` never imported anywhere | Silent code drift; OUTCOME_KEYWORDS already consolidates all four outcome lists |
| Redundant classification keywords | `STATISTIC_KEYWORDS`, `AGGREGATION_KEYWORDS`, `SEMANTIC_KEYWORDS` used only by `KeywordIntentClassifier` | Narrow English/Korean lists fail on natural-language variation |
| SEQUENTIAL intent | Defined in enum, mentioned in LLM prompts, but no strategy registered | Silently falls through to SEMANTIC — misleading enum value |

---

### 2. Backend Improvements

#### 2.1 Unified LLM Call: `classifyAndExtract`

- **Goal**: Replace the two-LLM-call sequence (`extractMetadata` → `analyzeStatisticalQuery`) with a single call that returns both intent routing signal (`templateId`) and query metadata.
- **Design decision**: **`templateId` presence as intent signal**. If the LLM returns a non-null `templateId`, the query routes to `StatisticalQueryStrategy`. If `templateId` is `null`, it routes to `SemanticQueryStrategy`. This eliminates the redundant `intent` + `intentConfidence` dance.
- **Why not extend `extractMetadata`**: The existing `statistical-analysis.md` prompt already contains the full template catalogue and metadata fields. Extending the metadata-extraction prompt risks ambiguity (two prompts doing the same thing). A single purpose-built `query-classification.md` prompt is clearer and independently versioned.
- **Extensibility path**:
  - Current: 5 templates in `METRIC_TEMPLATES`. Adding a new template requires only a new entry in the prompt's "Selection Guide" table and a new key in `METRIC_TEMPLATES`.
  - Future: The same prompt can accommodate multi-step (`SEQUENTIAL`) patterns by adding new `templateId` values without touching the routing logic.
- **Actions**
  - **2.1.1** Create `backend/prompts/query-classification.md` — unified prompt with full template catalogue + metadata extraction. Response schema: `{ templateId: string|null, params: { topN: number, metadata: {...} } }`.
  - **2.1.2** Add `classifyAndExtract(query, reformulatedQuery?)` to `SynthesisPort` abstract class. Remove `extractMetadata()` and `analyzeStatisticalQuery()`.
  - **2.1.3** Implement `GeminiAdapter.classifyAndExtract()`:
    - Build prompt via new `QueryClassificationPrompt`.
    - Parse response: extract `templateId`, `params.metadata`.
    - Normalize metadata via existing `normalizeMetadata()`.
    - On parse error: fallback returns `{ templateId: null, params: { metadata: emptyMetadata } }` (routes to SEMANTIC).
    - Remove `extractMetadata()` and `analyzeStatisticalQuery()` implementations.
  - **2.1.4** Add `readonly templateId?: string` and `readonly templateParams?: Record<string, any>` to `QueryContext` interface in `query-strategy.port.ts`.
  - **2.1.5** Update `SearchService.buildQueryContext()`:
    - Replace `synthesisPort.extractMetadata()` call with `synthesisPort.classifyAndExtract()`.
    - Store returned `templateId` and `templateParams` on the built `QueryContext`.
  - **2.1.6** Update `SearchService.resolveStrategy()`:
    - Accept `QueryContext` instead of `AnalysisIntent`.
    - If `context.templateId` is present → return STATISTICAL strategy.
    - Else → return SEMANTIC strategy (default).
    - Remove `intentClassifier.classify()` call from `ask()`.
  - **2.1.7** Update `StatisticalQueryStrategy.execute()`:
    - Read `context.templateId` and `context.templateParams` instead of calling `synthesisPort.analyzeStatisticalQuery()`.
    - If either is missing (should not happen after routing, but guard anyway) → throw descriptive error.
  - **2.1.8** Remove `statistical-analysis.md` prompt file and `QueryMetadataSynthesisPrompt` + `StatisticalAnalysisPrompt` class references to `analyzeStatisticalQuery`.
- **Acceptance**: `GET /search/ask?q=에러율이 어떻게 돼?` logs show `classifyAndExtract` returning `templateId: ERROR_RATE`; `GET /search/ask?q=결제 실패 원인` shows `templateId: null` → SEMANTIC strategy selected. No `analyzeStatisticalQuery` log lines appear.

#### 2.2 Classifier Simplification

- **Goal**: Remove the now-unnecessary `HybridIntentClassifier` and keyword-based STATISTICAL/SEMANTIC classification. Retain the conversational fast-path keyword check.
- **Design decision**: `KeywordIntentClassifier` is kept as a focused utility with only `isConversationalKeywordMatch()`. It is no longer an `IntentClassifier` port implementation; the `INTENT_CLASSIFIER` injection token is removed from `EmbeddingsModule` since routing is now done inline in `SearchService.resolveStrategy()`.
- **Extensibility path**:
  - Current: Conversational keywords are a flat list covering common session-meta phrases.
  - Future: If a richer conversational detection is needed (e.g., topic-shift detection), it can be promoted to a dedicated LLM call without affecting the statistical/semantic path.
- **Actions**
  - **2.2.1** Remove `matchesStatistical()`, `matchesSemantic()`, `classify()` from `KeywordIntentClassifier`. Keep only `isConversationalKeywordMatch()`. Remove `IntentClassifier` base-class extension and `@Injectable` decorator (it is still used directly via DI, so keep the provider registration but remove the port interface).
  - **2.2.2** Delete `hybrid-intent.classifier.ts` and its spec file. Remove from `EmbeddingsModule` providers and the `INTENT_CLASSIFIER` token binding.
  - **2.2.3** Remove `STATISTIC_KEYWORDS`, `AGGREGATION_KEYWORDS`, `SEMANTIC_KEYWORDS` files.
  - **2.2.4** Remove `SEQUENTIAL` from `AnalysisIntent` enum. Update `resolveStrategy()` to remove the SEQUENTIAL/UNKNOWN guard (now only templateId presence matters).
- **Acceptance**: `HybridIntentClassifier` file does not exist. `KeywordIntentClassifier` has exactly one public method: `isConversationalKeywordMatch`. Backend builds without errors.

#### 2.3 Dead Code Cleanup

- **Goal**: Remove all keyword files that have no live import outside the `filter/` folder itself.
- **Design decision**: `OUTCOME_KEYWORDS` already consolidates `FAILED`, `SUCCESS`, `WARNING`, `EDGE_CASE` sub-arrays; the four standalone flat files are a historical artifact from before consolidation. `ROUTE_KEYWORDS` is an exact structural duplicate of `ROUTE_PATTERN_CONSTANTS` and was never wired into any consumer.
- **Actions**
  - **2.3.1** Delete `filter/route-keywords.ts`, `filter/failure-keywords.ts`, `filter/success-keywords.ts`, `filter/warning-keywords.ts`, `filter/edge-case-keywords.ts`.
  - **2.3.2** Update `filter/index.ts` barrel: remove all deleted exports.
- **Acceptance**: `filter/` directory contains exactly: `analysis-intent-keyword.ts`, `conversational-keywords.ts`, `latency-keywords.ts`, `outcome-keywords.ts`, `user-roles-keywords.ts`, `index.ts`. TypeScript build succeeds.

---

#### 2.4 Statistical Result Display Fixes

- **Goal**: Eliminate three wrong/misleading values that appear whenever a STATISTICAL query succeeds: a false "로그를 찾지 못했습니다" guidance string, a Success Rate of 0.0 %, and an Avg Latency of 0 ms.
- **Design decision**: All three bugs are shallow (1–2 line changes each). They are kept as a single section because they all originate from the same root cause — the pipeline was designed for SEMANTIC queries where `sources[]` is the primary signal, and STATISTICAL results were patched in without auditing display logic.
- **Why not fix on the API side**: The display string and the rate clamping both live in frontend/strategy code that is already the correct responsibility boundary. Pushing them into the API response would bloat the DTO for a pure presentation concern.
- **Actions**
  - **2.4.1** `statistical-query.strategy.ts` — Success Rate fix: change `1 - row.errorRate` to `1 - (row.errorRate / 100)` in the `buildStatsPayload` success-rate branch. `errorRate` is a percentage (0–100), not a ratio.
  - **2.4.2** `HomePage.tsx` — Remove STATISTICAL false guidance: wrap the `noSourceGuidance` assignment in a guard so the string is only appended when `intent !== 'STATISTICAL'` and `statsPayload` is absent. STATISTICAL queries are answered by aggregation results, not log source chunks.
  - **2.4.3** `StatsOverviewWidget` (or equivalent display component) — Avg Latency display: render `"N/A"` instead of `"0ms"` when `averageDurationMs` is `undefined`. The value is legitimately absent for pipelines that do not return an `avg` field (e.g., `ERROR_RATE`).
- **Acceptance**: A query that triggers `ERROR_RATE` template shows Success Rate ≈ `(100 − errorRate) %`, Avg Latency `"N/A"`, and no "관련 로그를 찾지 못했습니다" text in the answer.

#### 2.5 Frontend: Hide Empty Timeseries Charts

- **Goal**: Remove the two "No data" empty boxes (Request Volume chart, Latency chart) that render whenever no pipeline returns time-bucketed data.
- **Design decision**: Conditionally hiding widgets is cheaper and less misleading than showing placeholder boxes. The widgets are hidden — not removed from the component tree — so they reappear automatically if a future pipeline starts returning `timeseries` data.
- **Extensibility path**: When a pipeline does produce time-series data (e.g., a new `LATENCY_OVER_TIME` template), the widgets will re-surface without any additional code change.
- **Actions**
  - **2.5.1** In the stats result rendering section, add a guard: render Request Volume and Latency chart widgets only when `statsPayload.timeseries?.length > 0`. Otherwise render nothing (no placeholder, no "No data" label).
- **Acceptance**: A STATISTICAL query response that has `timeseries: []` shows overview cards and error/distribution tables but no empty chart boxes. Removing the `timeseries` guard (or passing a non-empty array) makes them reappear.

#### 2.6 Template-specific `buildStatsPayload` Parsing

- **Goal**: Replace the single generic parser in `buildStatsPayload()` with per-template parsing so each template's actual response shape is correctly mapped to the `StatsPayload` schema.
- **Design decision**: `templateId` is now available on `QueryContext` (added in 2.1.4). Passing it into `buildStatsPayload(results, templateId)` is the minimal change that unlocks typed per-template branches without restructuring the caller. A `switch` on `templateId` keeps each branch isolated and independently testable.

| Template | Actual return shape | Current parser behaviour | Target behaviour |
|---|---|---|---|
| `ERROR_RATE` | `{ totalCount, errorCount, errorRate }` | Partially fills `overview` | Fill `overview`; derive `successRate = 1 − errorRate/100` |
| `TOP_ERROR_CODES` | `[{ errorCode, count, examples }]` | `overview` empty | Populate `breakdown` table rows; leave `overview` empty |
| `ERROR_DISTRIBUTION_BY_ROUTE` | `[{ route, count, errorCodes }]` (see `METRIC_TEMPLATES`) | Old parser expected `count` on route rows inconsistently | Map `count` → `RouteMetric.failed` / `total` |
| `LATENCY_PERCENTILE` | `[{ percentile, value, requestCount }]` | Completely unmapped | Populate percentile rows; derive `averageDurationMs` from p50 value |

- **Actions**
  - **2.6.1** Update `buildStatsPayload(results, templateId)` signature to accept `templateId: string`.
  - **2.6.2** Replace the current field-probing logic with a `switch (templateId)` block containing one dedicated parser per template.
  - **2.6.3** Update the call-site in `StatisticalQueryStrategy.execute()` to pass `context.templateId`.
  - **2.6.4** (Optional) Define per-template result types — implemented as `aggregation-template-results.ts` (DTO barrel) documenting pipeline output shapes; parsers still use `any[]` at the boundary for Mongo flexibility.
- **Acceptance**: `TOP_ERROR_CODES` query returns a populated `breakdown` array; `LATENCY_PERCENTILE` query returns `percentile` rows and a non-zero `averageDurationMs`; `ERROR_DISTRIBUTION_BY_ROUTE` breakdown rows have non-null `count` values.

---

### 4. Implementation Order

| Step | Section | Task | Depends on | Est. | Status |
|------|---------|------|------------|------|--------|
| 1 | 2.1.1 | Create `query-classification.md` prompt | — | 20 min | ✅ Done |
| 2 | 2.1.2-3 | Add `classifyAndExtract` to port + adapter; remove old methods | Step 1 | 30 min | ✅ Done |
| 3 | 2.1.4 | Add `templateId`/`templateParams` to `QueryContext` | — | 5 min | ✅ Done |
| 4 | 2.1.5-6 | Update `SearchService` (`buildQueryContext` + `resolveStrategy`) | Steps 2, 3 | 20 min | ✅ Done |
| 5 | 2.1.7-8 | Update `StatisticalQueryStrategy`; remove `statistical-analysis.md` | Steps 2, 4 | 15 min | ✅ Done |
| 6 | 2.2.1-4 | Simplify classifier, delete `HybridIntentClassifier`, remove SEQUENTIAL | Steps 4, 5 | 20 min | ✅ Done |
| 7 | 2.3.1-2 | Delete dead keyword files; update barrel | Step 6 | 10 min | ✅ Done |
| 8 | 2.4.1 | Fix Success Rate: `errorRate / 100` in `buildStatsPayload` | Step 5 | 5 min | ✅ Done |
| 9 | 2.4.2 | Remove false "관련 로그" guidance for STATISTICAL in `HomePage.tsx` | — | 5 min | ✅ Done |
| 10 | 2.4.3 | Render `"N/A"` for undefined `averageDurationMs` in stats widget | — | 5 min | ✅ Done |
| 11 | 2.5.1 | Hide empty timeseries chart widgets when `timeseries` is empty | — | 10 min | ✅ Done |
| 12 | 2.6.1-4 | Per-template `buildStatsPayload` parsing with `templateId` switch | Steps 8, 11 | 40 min | ✅ Done |

**Checkpoint 1**: After Step 5, run `pnpm build` in `backend/`. Fix any TypeScript errors before proceeding.

**Checkpoint 2**: After Step 7, run `pnpm build` again and verify the filter directory contents.

**Checkpoint 3**: After Step 12, run `pnpm build` and verify STATISTICAL queries for all four templates return correctly mapped data.

---

### 5. Done Criteria for Phase 5.3

#### Backend — Unified Classification

- [x] `classifyAndExtract(query)` exists on `SynthesisPort` and `GeminiAdapter`
- [x] `extractMetadata()` and `analyzeStatisticalQuery()` removed from port and adapter
- [x] `QueryContext` has `templateId?` and `templateParams?` fields
- [x] `SearchService.buildQueryContext()` calls `classifyAndExtract()` (no `extractMetadata()` call)
- [x] `StatisticalQueryStrategy.execute()` reads `context.templateId` / `context.templateParams` (no LLM call for template selection)
- [x] `statistical-analysis.md` prompt file deleted

#### Backend — Classifier Cleanup

- [x] `HybridIntentClassifier` file deleted
- [x] `KeywordIntentClassifier` has only `isConversationalKeywordMatch()` public method
- [x] `INTENT_CLASSIFIER` injection token and `HybridIntentClassifier` provider removed from `EmbeddingsModule`
- [x] `STATISTIC_KEYWORDS`, `AGGREGATION_KEYWORDS`, `SEMANTIC_KEYWORDS` files deleted
- [x] `AnalysisIntent.SEQUENTIAL` removed from enum

#### Backend — Dead Code

- [x] `route-keywords.ts`, `failure-keywords.ts`, `success-keywords.ts`, `warning-keywords.ts`, `edge-case-keywords.ts` deleted
- [x] `filter/index.ts` exports only surviving files
- [x] `pnpm build` exits with 0 errors in `backend/`

#### Backend — Statistical Result Fixes

- [x] `buildStatsPayload` uses `1 - (row.errorRate / 100)` for success rate when `errorRate` is a percentage
- [x] `buildStatsPayload(results, templateId)` accepts `templateId` and dispatches to a per-template parser
- [x] `ERROR_RATE` branch fills `overview` (totalCount, errorCount, successRate)
- [x] `TOP_ERROR_CODES` branch populates `breakdown` rows
- [x] `ERROR_DISTRIBUTION_BY_ROUTE` branch maps pipeline `count` → `RouteMetric.failed` / `total` (pipeline field is `count`, not `errorCount`)
- [x] `LATENCY_PERCENTILE` branch populates percentile rows and derives `averageDurationMs` from p50

#### Frontend — Display Fixes

- [x] STATISTICAL query answers do not show "관련 로그를 찾지 못했습니다" guidance text
- [x] `averageDurationMs === undefined` renders `"N/A"` (not `"0ms"`) in the stats overview widget
- [x] Request Volume and Latency chart widgets are hidden when `timeseries` is empty (`[]` or absent)

#### Frontend — Stats overview indicators (template-driven)

- [x] `StatsOverviewWidget` reads optional `percentiles` (P99 card), `timeseries` (Error Trend: last vs first bucket error %), and `halfWindow` (fallback when fewer than 2 hourly buckets)
- [x] `LatencyChartWidget` only when at least one `TimeSeriesPoint` has `averageDurationMs` (ERROR_RATE series has volume only)

#### Backend — ERROR_RATE timeseries

- [x] `ERROR_RATE` pipeline uses `$facet`: `summary` (unchanged totals) + `series` (`bucket` / `total` / `failed` via `$dateTrunc` on `timestamp`, UTC)
- [x] **Adaptive bucket unit** ([`AggregationHelper.resolveSeriesTimeBucket`](backend/src/embeddings/core/utils/aggregation-helper.ts)): span ≤2h → `minute`, ≤2d → `hour`, ≤60d → `day`, else `week`; missing `startTime`/`endTime` → `hour` (same as before)
- [x] `buildErrorRateStatsPayload` parses facet output into `overview` + `timeseries`; legacy single-row shape still supported

#### Backend — ERROR_RATE latency and half-window trend

- [x] `ERROR_RATE` `$facet` adds `latency` (same percentile math as `LATENCY_PERCENTILE` on `performance.durationMs`) and `trendHalves` (first vs second half of `[startTime,endTime]` when both bounds exist)
- [x] `StatsPayload.halfWindow` (`firstErrorRatePct`, `secondErrorRatePct`) populated from `trendHalves`; `percentiles` + `overview.averageDurationMs` from `latency` facet

