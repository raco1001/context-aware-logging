## Phase 5.1 Audit: Semantic Query & Data Consistency Plan

### 1. Scope
- **Backend focus**: Ensure end-to-end consistency for semantic log search
  - From raw log ingestion → storage → embedding generation → vector search → log fetch → LLM synthesis.
  - Establish a **system-driven log governance** pipeline using strict JSON schemas and validation layers.
- **Frontend focus**: Align UI and types with the corrected backend contracts and result semantics.
  - Unify FE and BE log structures to minimize differences.

Assumption: **All previous test data in the database is cleared** and will be recreated with the corrected schema and pipeline.

#### 1.1 Current State Assessment

The following structural gaps were identified during the pre-implementation audit:

| Area | Finding | Impact |
|------|---------|--------|
| Schema governance | `mongodb-init.js` validators and backend TypeScript types are maintained independently with no derivation mechanism | Schema drift between DB and application layer |
| `wide_events` collection | Created as time-series (`timeseries: { timeField, metaField, granularity }`), which **does not support `$jsonSchema` validators** in MongoDB | No DB-level validation for raw logs; must be enforced at application level |
| `wide_events_embedded` schema | Missing `hasError`, `errorCode`, `route`, `outcome` fields in both MongoDB validator and `LogEmbeddingEntity` | Post-filtering in semantic queries is impossible |
| Vector search index | Only `eventId`, `timestamp`, `createdAt`, `service` registered as filter fields | Cannot apply `hasError`/`errorCode`/`route` filters at the vector search stage |
| Validation pipeline | `WideEvent` has `class-validator` decorators but **`validate()` is never called** anywhere in the ingestion path | Malformed logs can silently enter the DB |
| Error code taxonomy | Global `ErrorCode` enum (6 values) and domain `PaymentStatusCode` coexist; `WideEventError.code` is typed as `string` | No compile-time or runtime enforcement of valid error codes |
| FE/BE type contract | No shared package, no monorepo tooling; types are manually duplicated | `sources: string[]` (BE) vs `LogSource[]` (FE), `AnalysisIntent` has 5 values (BE) vs 3 (FE) |
| Type safety | `MongoLogStorageAdapter` returns `any[]` for most methods; `StatsPayload` uses `Record<string, any>` | Schema mismatches are invisible at compile time |
| Multi-step context loss | `PaymentsService` 3-step flow produces rich `PaymentResult` (`errorService`, `gatewayProcessingTimeMs`, `transactionId`) but only terminal `error` + total `durationMs` reach `WideEvent` | Cannot query "which step failed?" or "how long did the gateway take?" from logs |

---

### 2. Backend Audit Plan – Data & Pipeline Consistency

#### 2.1 Domain Schema Definition & Log Spec (Single Source of Truth)
- **Goal**: Define a single canonical schema (Log Spec) for log events and embeddings that all modules follow.
- **Current state**
  - `WideEvent` class (`libs/logging/core/domain/wide-event.ts`) serves as the de facto schema with `class-validator` decorators.
  - `mongodb-init.js` defines `$jsonSchema` validators for `embedding_progress`, `wide_events_embedded`, and `chat_history` — but **not** for `wide_events` (time-series limitation).
  - These two sources are not linked: adding a field to `WideEvent` does not propagate to `mongodb-init.js` or vice versa.
- **Checks**
  - Create a strict JSON Schema or TypeScript Interface for logs.
  - Document required fields for a single log event:
    - `requestId`, `service`, `route`, `timestamp`, `outcome`, `latency`, `userRole`, `error`, `error.code`, `error.message`, etc.
  - Enforce Key/Value rules using Enums (e.g., `service` must be one of `['paymentGateway', 'authService']`).
  - Define canonical relationship between:
    - Raw log `_id` or `requestId`
    - Embedding document `eventId`
  - Write a short internal spec (ADR/README) stating:
    - "`eventId` in wide_events_embedded maps to `<collection>.<field>` in raw logs."
- **Actions**
  - Write an ADR (ADR-004) documenting the canonical field mapping: `wide_events._id` ↔ `wide_events_embedded.eventId`.
  - Designate the TypeScript interface as the canonical source. `mongodb-init.js` validators are secondary and must stay in sync manually (automated derivation can be introduced at larger scale).
  - Unify the error code taxonomy: define a composite type `type LogErrorCode = ErrorCode | PaymentStatusCode | string` with documented conventions, or consolidate into a single enum with domain prefixes.

#### 2.2 Syntax & Semantic Validation Layer (System-Driven Governance)
- **Goal**: Prevent invalid or malformed logs from entering the system by enforcing the Log Spec at the ingestion point.
- **Current state**
  - `WideEvent` class has `@IsString()`, `@IsNotEmpty()`, `@IsEnum()`, `@ValidateNested()` decorators from `class-validator`.
  - **However, `validate()` is never called** in `LoggingService`, `mq-consumer.service`, or any ingestion path — the decorators are effectively dead code.
  - `wide_events` is a time-series collection and **cannot have a MongoDB `$jsonSchema` validator**, so DB-level enforcement is not an option.
- **Checks**
  - Implement a validation gate before logs are published to the MQ or written to the DB.
  - **Syntax Validation**: Check if required fields exist, types match the JSON Schema, and Enums are valid.
  - **Semantic Validation**: Ensure logical consistency (e.g., if `outcome === 'FAILED'`, then the `error` object must be populated).
- **Actions**
  - Add a `validateWideEvent()` utility that calls `class-validator`'s `validate()` on the `WideEvent` instance.
  - Integrate at the MQ consumer level: Kafka message → `JSON.parse` → `WideEvent.fromContext()` → `validateWideEvent()` → if invalid, log + reject counter (DLQ can be introduced later).
  - Add semantic rules:
    - If `error` is present, `error.code` and `error.message` must be non-empty.
    - `service` must exist in `SERVICE_MAP_CONSTANTS` values or a defined allowlist.
  - At the current scale, a **reject counter + structured error log** is sufficient instead of a full DLQ topic.

#### 2.3 Raw Log Enrichment & Multi-step Context (Pattern A)
- **Goal**: Ensure the WideEvent captures the full business context of a multi-step request without introducing nested arrays.
- **Design decision**: **Pattern A (Enriched Flat Event)** — see ADR-004 §5 for rationale and alternatives considered (Pattern B: per-hop spans, Pattern C: embedded arrays).
- **Current state**
  - `PaymentsService.processPayment()` executes 3 steps (balanceCheck → gateway → orderConfirmation) and returns `PaymentResult` with rich context: `errorService`, `errorCode`, `gatewayProcessingTimeMs`, `transactionId`, `orderId`.
  - `LoggingInterceptor` captures:
    - `error` only from thrown exceptions (via `catchError` → `ErrorNormalizer`). Business-level failures returned as `{ success: false, errorCode }` do **not** reach `WideEvent.error`.
    - `performance.durationMs` as total request duration. Per-step durations are lost.
  - `@LogResponseMeta` can extract fields from the response into `_metadata`, but these remain opaque to queries and embeddings — they are not indexed, not included in `toSummary()`, and not propagated to `wide_events_embedded`.
- **Actions**
  - Add enrichment fields to `WideEventSpec` (in `contracts/log-spec.ts`):
    - `failedAt?: string` — which processing step caused the failure (e.g., `"paymentGateway"`).
    - `stepsReached?: number` — how many steps completed before termination.
    - Extend `WideEventPerformanceSpec` with optional step-level breakdown: `balanceCheckMs?`, `gatewayMs?`, `orderConfirmationMs?`.
  - Update `WideEvent` domain class and `LoggingContext` to support the new fields.
  - Update `WideEvent.toSummary()` to include `failedAt` for improved embedding quality:
    - e.g., `"Outcome: FAILED, FailedAt: paymentGateway, Service: payments, ..."`.
  - Decide the enrichment mechanism:
    - Option A: `@LogResponseMeta` extracts `errorService` → interceptor promotes it to `context.failedAt`. Requires interceptor-level mapping logic.
    - Option B: Domain service explicitly enriches `LoggingContext` during processing. More explicit but couples business logic to logging.
    - **Recommended**: Option A for the current scale — keep business logic clean, let the interceptor handle context promotion from response metadata.
  - Trace one request through: HTTP → Validation Layer → LoggingService → MQ consumer → DB write. Verify enrichment fields are persisted.
  - Normalize/derive missing fields at write time (e.g., compute `error.code` from status or exception types).
  - Enforce consistent casing/format for `service`, `route`, `error.code`.

#### 2.4 Embedding / Vector Collection Schema
- **Goal**: Ensure embedding documents are fully joinable back to raw logs and usable for filtering.
- **Current state**
  - `mongodb-init.js` defines `wide_events_embedded` with: `eventId`, `requestId`, `summary`, `model`, `embedding`, `service`, `timestamp`, `createdAt`.
  - **Missing fields**: `hasError`, `errorCode`, `route`, `outcome` — these are required for post-filtering in semantic queries but exist neither in the MongoDB validator nor in `LogEmbeddingEntity`.
  - `saveEmbeddingsAndUpdateWatermark()` in `MongoLogStorageAdapter` only persists `eventId`, `requestId`, `summary`, `model`, `embedding`, `service`, `timestamp`, `createdAt`.
  - The vector search index (`embedding_index`) only registers `eventId`, `timestamp`, `createdAt`, `service` as filter fields.
- **Checks**
  - Inspect sample documents in the embedding collection (e.g. `wide_events_embedded`):
    - `eventId` type and value (string vs ObjectId).
    - Presence of `summary`, `embedding`, `service`, `route`, `outcome`, `errorCode`, `hasError`, `timestamp`.
  - Verify that `EmbeddingUseCase.processPendingLogs()`:
    - Reads from the correct raw collection.
    - Writes `eventId` that matches the canonical mapping from 2.1.
    - Copies or derives `errorCode` and `hasError` consistently with raw logs.
- **Actions**
  - Add fields to `LogEmbeddingEntity`: `hasError: boolean`, `errorCode?: string`, `route?: string`, `outcome?: string`, `failedAt?: string`.
  - Update `WideEventEmbeddedSpec` (in `contracts/log-spec.ts`) to include: `hasError`, `errorCode`, `route`, `outcome`, `failedAt`.
  - Update `saveEmbeddingsAndUpdateWatermark()` to derive and persist these fields from the source `WideEvent`:
    - `hasError = !!wideEvent.error`
    - `errorCode = wideEvent.error?.code ?? null`
    - `route = wideEvent.route`
    - `outcome = wideEvent.determineOutcome(...)` (requires making `determineOutcome` public or adding a getter)
    - `failedAt = wideEvent.failedAt ?? null` (from the 2.3 enrichment)
  - Update `mongodb-init.js`:
    - Add `hasError` (`bsonType: "bool"`), `errorCode` (`bsonType: "string"`), `route` (`bsonType: "string"`), `outcome` (`bsonType: "string"`), `failedAt` (`bsonType: "string"`) to the `wide_events_embedded` validator.
    - Register `hasError`, `errorCode`, `route`, `failedAt` as filter fields in the `embedding_index` vector search index definition.
  - Update `vectorSearch()` pipeline `$project` to include the new fields when needed.

#### 2.5 LogStoragePort: Vector Search & Log Fetch
- **Goal**: Guarantee that vector search results can always be resolved back to actual logs.
- **Current state**
  - `vectorSearch()` returns `{ eventId, summary, score }` via `$project`.
  - `getLogsByEventIds()` queries `wide_events` by `_id: { $in: eventIds }`.
  - All return types are `any[]` — no compile-time safety on the shape of returned documents.
- **Checks**
  - `vectorSearch(embedding, limit, metadata)`:
    - Confirm which collection and fields are used.
    - Ensure `eventId` in the returned result is the same identifier expected by `getLogsByEventIds`.
  - `getLogsByEventIds(eventIds)`:
    - Confirm the target collection and query shape (e.g. `_id` vs `requestId`).
    - Test with known `eventId` from the embedding collection to ensure logs are returned.
- **Actions (if issues)**
  - Align `eventId` semantics so that:
    - Either `eventId` == raw `_id` (as string) or
    - `eventId` == raw `requestId`, and `getLogsByEventIds` queries that field explicitly.
  - Replace `any[]` return types with typed interfaces (e.g. `VectorSearchResult`, `RawLogDocument`) to catch shape mismatches at compile time.
  - After 2.4 is implemented, extend `vectorSearch()` filter logic to use `metadata.hasError`, `metadata.errorCode` directly against the embedding collection — reducing reliance on post-filtering after log fetch.

#### 2.6 Query Metadata ↔ Log Schema Alignment
- **Goal**: Make sure LLM-extracted metadata matches actual stored log fields.
- **Current state**
  - `SERVICE_MAP_CONSTANTS` maps aliases (`payment` → `payments`) but there is no evidence this mapping is applied to `GeminiAdapter.extractMetadata()` output.
  - If the LLM returns `service: "payment_gateway"` but the DB stores `service: "paymentGateway"`, the filter silently matches nothing.
- **Checks**
  - `GeminiAdapter.extractMetadata(query)`:
    - Sample outputs for Korean/English queries:
      - `service`, `route`, `errorCode`, `hasError`, `startTime`, `endTime`.
  - Compare against raw log schema:
    - Are service names (`paymentGateway` vs `payment_gateway`) consistent?
    - Are `errorCode` values exactly those stored in `log.error.code`?
  - Review `SemanticQueryStrategy` filters:
    - `metadata.hasError` vs `log.error`.
    - `metadata.errorCode` vs `log.error.code`.
- **Actions**
  - Add a `normalizeMetadata(raw: QueryMetadata): QueryMetadata` function between LLM extraction and query execution:
    - Map `service` through `SERVICE_MAP_CONSTANTS` (and its reverse).
    - Normalize `errorCode` casing (e.g., uppercase).
    - Validate `route` against `RouteNormalizer` canonical format.
  - Tighten/normalize prompt outputs (e.g. enforce enum-style service names, error codes).

#### 2.7 SemanticQueryStrategy: Fallback & Filter Behavior
- **Goal**: Avoid losing all context when filters are too strict, while keeping answers faithful to logs.
- **Checks**
  - End-to-end flow for queries like:
    - "오류가 발생한 적이 있어?"
    - "결제 게이트웨이 오류가 왜 났어?"
  - Observe:
    - `vectorSearch` results count.
    - `getLogsByEventIds` `fullLogs` count.
    - Post-filter `fullLogs` count after `hasError`/`errorCode` filters.
  - Confirm current behavior when `fullLogs.length === 0`:
    - What answer is synthesized?
    - How is `confidence` and `sources` set?
- **Planned improvements**
  - If post-filtering results in zero logs:
    - Relax filters stepwise (e.g. ignore `errorCode`, keep `hasError` only).
    - Fallback to using `vectorResults.summary` as context if no logs remain.
    - Optionally short-circuit LLM with a deterministic "no matching logs for these filters" message.
  - With the filter fields from 2.4 now available in the embedding collection, move `hasError`/`errorCode` filtering **into** the `$vectorSearch` filter stage rather than post-filtering after log fetch — this is more efficient and avoids the "fetch N logs then discard all" scenario.

#### 2.8 Embedding Batch Process & Test Data Reload
- **Goal**: Rebuild embedding data reliably after schema fixes, with a repeatable “reset → generate → embed → verify” loop.
- **Decision (recommended)**: **Local Mongo container first** (cheap reset + fast iteration) → then Atlas as an optional “prod-like” verification.
  - Rationale:
    - `@test_data/` is still aligned to pre-improvement assumptions → needs updates before polluting Atlas.
    - Search Index / `$vectorSearch` filter fields may require re-application; easier to iterate locally first.
- **Process (reorganized)**
  - **P0. Baseline prerequisites**
    - Ensure docker compose is down (done) and you can bring up a clean local Mongo container.
    - Identify reset scope (minimum collections):
      - `wide_events` (raw logs)
      - `wide_events_embedded` (embeddings)
      - `embedding_progress` (watermark/progress)
    - Confirm the init/validator script used by local Mongo (`docker/mongo/mongodb-init.js`) matches the current schema expectations.
  - **P1. Update test traffic generator (`@test_data/`) to match the current log schema**
    - Must be able to reliably produce:
      - Successful requests
      - Error cases with stable `error.code`
      - Slow requests (performance signals)
      - Multi-step failures that set `failedAt` (e.g., `"paymentGateway"`)
  - **P2. Generate representative test traffic**
    - Produce a small, controlled dataset first (tens of requests), then scale if needed.
  - **P3. Run embedding batch**
    - Call `POST /embeddings/batch?limit=<N>` repeatedly until `processedCount` becomes 0.
  - **P4. Verify embedding documents and new fields**
    - Check `wide_events_embedded`:
      - Documents exist for relevant logs.
      - **New fields** are populated correctly:
        - `hasError`, `errorCode`, `route`, `outcome`, `failedAt`
      - `failedAt` is present for failed multi-step requests.
  - **P5. Verify retrieval behavior (environment-dependent)**
    - If `$vectorSearch` is available in the current environment:
      - Vector search returns expected candidates for known scenarios.
      - Vector search with `hasError: true` filter returns only error-related embeddings.
      - Vector search with `failedAt: "paymentGateway"` filter returns only gateway failure embeddings.
    - If `$vectorSearch` is **Atlas-only**:
      - Do P0–P4 locally to validate data correctness first.
      - Then reset a **dedicated Atlas test DB**, re-apply `embedding_index`, and repeat P2–P5 there.

#### 2.9 Make the Local Reset Loop Low-friction (Idempotent Mongo Init + Scripted Smoke)
- **Goal**: Reduce “reset friction” so Phase 5.1 can be re-run reliably without manual Mongo fixes (user already exists, validator drift, index already created, etc.).
- **Why now (insight from 2.8 execution)**
  - Local iteration is fast, but the **Mongo init script is not idempotent** by default:
    - `db.createUser(...)` fails if the user already exists.
    - `db.createCollection(...)` fails if the collection already exists.
    - Validators may drift across runs (schema fix required `collMod` for existing DBs).
    - Search index creation may be environment-dependent and/or already present.
  - Cursor runtime constraints: backend + load test often need to run **outside sandbox** to reach Docker/Kafka/localhost ports reliably.
  - Occasional dev-server port collisions (`EADDRINUSE :3000`) can waste time unless the runbook is explicit.
- **Plan**
  - **Reset options (choose per run)**
    - **Fast reset (recommended for iteration)**: Keep docker volumes → drop data collections as needed → rely on init script + `collMod` validators to converge schema.
    - **Full reset (most reliable)**: Stop compose → remove docker volumes → bring compose back up (guarantees a clean init run, useful if time-series options / init drift is suspected).
  - **P0. Make `docker/mongo/mongodb-init.js` idempotent**
    - Guard user creation:
      - If `db.getUser("eventsAdmin")` exists → skip `createUser`, otherwise create.
    - Guard collection creation:
      - If collection exists → skip `createCollection`, otherwise create.
    - Ensure validators are always correct:
      - If collection exists → apply `collMod` to enforce the latest `$jsonSchema` (do not rely on “first create” only).
    - Make index creation safe:
      - For standard indexes: `createIndex`/`createIndexes` are safe to call repeatedly (same name/definition).
      - For Search index: prefer “ensure exists / check status” flow; only recreate when definition changes.
  - **P1. Add a one-command local smoke loop**
    - Target workflow: `reset → generate → load → embed(until 0) → ask 2 queries`.
    - Keep it deterministic at small scale first (tens–hundreds of events), then scale to 2k if needed.
  - **P2. Acceptance checks**
    - Mongo collections exist: `wide_events`, `wide_events_embedded`, `embedding_progress`, `chat_history`.
    - `wide_events_embedded` validator allows nullable filter fields (`route`, `hasError`, `errorCode`, `outcome`, `failedAt`, `timestamp`, `service`) to prevent “Document failed validation” during embedding.
    - Search index `embedding_index` is queryable (READY) before running retrieval verification.
    - Error-path promotion confirmed in real data:
      - `wide_events.failedAt` and `wide_events.stepsReached` populated for multi-step failures.

- **P2 (result — PASS)**
  - Collections present: `wide_events`, `wide_events_embedded`, `embedding_progress`, `chat_history`
  - `wide_events_embedded` validator (nullable filter fields): ✅
  - Search index: `embedding_index` ✅ (`status=READY`, `queryable=true`)
  - Data evidence (example snapshot):
    - `wide_events.countDocuments()` = 338
    - `wide_events_embedded.countDocuments()` = 338
    - `wide_events.failedAt` (string) count = 134
    - `wide_events.stepsReached` (number) count = 239

---

### 3. Frontend Alignment Plan

#### Key Decisions (pre-implementation)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| `AnalysisResult.sources` shape | **Option A: BE enriches to `LogSource[]`** | Semantic strategy already fetches `fullLogs`; mapping to `LogSource[]` costs zero additional DB calls. Eliminates the need for a separate log-hydration endpoint. |
| `StatsPayload` typing | **Option A: BE maps `raw` → structured `overview`/`routes`** | Exposing `raw` aggregation results as the API contract couples FE to BE internal pipeline shape. Typed fields make the contract explicit. |
| Contracts location | **`libs/contracts/`** (not `src/contracts/`) | Contracts are consumed by multiple modules (`embeddings`, `logging`, FE mirror) — same role as `libs/logging/`. Placement in `src/` signals "module-internal". `libs/` signals "cross-cutting shared infrastructure". Mirrors gRPC convention where proto files live outside any single service's `src/`. |

#### 3.1 Establish `libs/contracts/` as the Contract Home
- **Goal**: Move contracts out of `src/` into `libs/` and add API response contract interfaces.
- **Actions**
  - Create `libs/contracts/` directory with `@contracts/*` path alias in `tsconfig.paths.json`.
  - Move `src/contracts/log-spec.ts` → `libs/contracts/log-spec.ts`.
  - Create `libs/contracts/analysis-result.ts` with pure TypeScript interfaces:
    - `AnalysisIntent` (5 values: `SEMANTIC`, `STATISTICAL`, `SEQUENTIAL`, `CONVERSATIONAL`, `UNKNOWN`)
    - `AnalysisViewType` (`chat`, `analytics`, `chat+analytics`)
    - `LogSource` — fields: `id` (requestId), `summary`, `status` (outcome), `route`, `duration` (durationMs), `timestamp` (ISO string), `errorCode?`, `failedAt?`
    - `LogStats`, `TimeSeriesPoint`, `RouteMetric` — typed shapes for `StatsPayload`
    - `StatsPayload` — `overview?: LogStats`, `timeseries?: TimeSeriesPoint[]`, `routes?: RouteMetric[]`, `raw?: unknown`
    - `AnalysisResult` — `sources: LogSource[]` (not `string[]`), `createdAt?: string` (not `Date`)
  - Create `libs/contracts/index.ts` barrel export.
  - Update `src/embeddings/core/dtos/analysis-result.ts` to re-export from `@contracts` (preserves existing imports).
- **Design note on `LogSource` fields**
  - `summary` comes from `fullLogs._summary` (raw document) — may be empty for logs that haven't been through the summary pipeline yet. Contract marks it as `string` (empty string is valid).
  - `duration` comes from `fullLogs.performance?.durationMs` — may be undefined for logs without performance data. Contract uses `number` with `0` as fallback.
  - `status` is derived: `error ? 'FAILED' : 'SUCCESS'` — simplified from the full `LogOutcome` enum (WARNING/EDGE_CASE are latency-derived and not relevant in source cards).
- **Acceptance**: `pnpm build` succeeds; existing `@embeddings/dtos` imports don't break.
- **Strategy by scale** (for reference)
  | Scale | Approach | Effort |
  |-------|----------|--------|
  | Current (1 dev, 2 apps) | **`libs/contracts/`**: BE maintains contracts. FE mirrors manually. Code review enforces sync. | Low |
  | Growing (2–3 devs) | **CI diff check**: Script compares BE contract interfaces against FE types, fails on divergence. | Medium |
  | Team (3+ devs, 3+ services) | **Monorepo shared package**: `packages/contracts` via pnpm workspaces, imported by both FE and BE. | High |

#### 3.2 BE: Semantic Strategy — `sources: LogSource[]` Mapping
- **Goal**: Replace `sources: string[]` (requestIds) with `sources: LogSource[]` in the Semantic strategy response.
- **Current state**
  - `semantic-query.strategy.ts` fetches `fullLogs` via `getLogsByEventIds(eventIds)`, extracts `requestIds`, then discards the rest.
  - The full log data (route, error, performance, _summary, failedAt) is available but unused in the response.
- **Actions**
  - Add a `toLogSources(fullLogs: any[]): LogSource[]` mapping function to the strategy (or a shared utility):
    - `id` ← `log.requestId`
    - `summary` ← `log._summary ?? ''`
    - `status` ← `log.error ? 'FAILED' : 'SUCCESS'`
    - `route` ← `log.route ?? ''`
    - `duration` ← `log.performance?.durationMs ?? 0`
    - `timestamp` ← `log.timestamp` (→ ISO string)
    - `errorCode` ← `log.error?.code`
    - `failedAt` ← `log.failedAt`
  - Replace `sources: requestIds` with `sources: this.toLogSources(fullLogs)`.
  - Zero-result path: `sources: []` stays as-is (empty `LogSource[]`).
- **Acceptance**: `GET /search/ask?q=오류가 발생한 적이 있어?` returns `sources` as `LogSource[]` with populated fields.

#### 3.3 BE: Statistical Strategy — `StatsPayload` Structured Mapping
- **Goal**: Map raw aggregation results into typed `StatsPayload` fields so the FE receives structured data.
- **Current state**
  - `statistical-query.strategy.ts` sets `statsPayload = { raw: aggregationResults }`.
  - `overview`, `timeseries`, `routes` are always `undefined`.
  - Aggregation template outputs:
    | Template | Raw shape | Maps to |
    |----------|-----------|---------|
    | `ERROR_RATE` | `[{ totalCount, errorCount, errorRate }]` | `overview.totalRequests`, `overview.errorRate`, `overview.totalErrors`, `overview.successRate` |
    | `LATENCY_PERCENTILE` | `[{ count, p50, p95, p99, avg, max }]` | `overview.avgLatency`, `overview.p99Latency` |
    | `ERROR_DISTRIBUTION_BY_ROUTE` | `[{ route, count, errorCodes }]` | `routes[]` |
    | `TOP_ERROR_CODES` | `[{ errorCode, count, examples }]` | `raw` (kept for `sources` extraction) |
    | `ERROR_BY_SERVICE` | `[{ service, count, topErrorCodes }]` | `raw` (service-level breakdown) |
- **Actions**
  - Add `buildStatsPayload(aggregationResults: any[]): StatsPayload` to the strategy:
    - Build `overview: LogStats` from `ERROR_RATE` + `LATENCY_PERCENTILE` results.
    - Build `routes: RouteMetric[]` from `ERROR_DISTRIBUTION_BY_ROUTE` results.
    - Keep `raw` for templates that don't map cleanly yet.
  - **Design note**: `RouteMetric.requests`, `RouteMetric.avgLatency`, `RouteMetric.p99Latency` are not available from the current aggregation templates. Mark them as **optional** in the contract (`requests?: number`, etc.) rather than inventing data. FE displays `N/A` when absent. Per-route latency can be added as a new aggregation template in a follow-up phase.
  - `sources` for statistical queries: `TOP_ERROR_CODES` already provides `examples[].requestId` — map these to `LogSource[]` using the same `toLogSources` pattern (the examples contain `requestId`, `timestamp`, `service`, `route`, `errorMessage`).
- **Acceptance**: `GET /search/ask?q=에러율이 어떻게 돼?` returns `statsPayload.overview` with typed `LogStats` fields.

#### 3.4 FE: Type Synchronization
- **Goal**: Mirror `libs/contracts/` interfaces in the frontend.
- **Actions**
  - Update `frontend/src/shared/lib/loglens/types.ts`:
    - `AnalysisIntent`: add `'SEQUENTIAL' | 'UNKNOWN'`.
    - `LogSource`: add `errorCode?: string`, `failedAt?: string`.
    - `RouteMetric`: make `requests`, `avgLatency`, `p99Latency` optional.
    - `StatsPayload.raw`: `any` → `unknown`.
  - Add UI fallback mapping for new intents:
    - `SEQUENTIAL` → treat as `SEMANTIC` (chat view).
    - `UNKNOWN` → chat view with "분석 의도를 파악하지 못했습니다" guidance message.
- **Acceptance**: `pnpm build` in frontend succeeds with zero type errors.

#### 3.5 FE: UI State Differentiation
- **Goal**: Make the UI reflect "how" the backend reached an answer, not just the text.
- **States to implement**
  | Condition | UI behavior |
  |-----------|-------------|
  | `sources.length > 0` | Normal answer with log source cards (show `failedAt` badge for FAILED sources) |
  | `sources.length === 0 && answer` | Answer present but no matching logs — show guidance: "관련 로그를 찾지 못했습니다" |
  | HTTP error / `{ error, message }` | System error display |
  | `statsPayload.overview` present | Render summary metrics card |
  | `statsPayload.routes` present | Render route breakdown table |
- **Actions**
  - Update `HomePage.tsx`:
    - Branch rendering based on conditions above.
    - `LogSource` cards: show `status` badge (FAILED = red, SUCCESS = green), `failedAt` if present, `duration`, `route`.
    - `StatsPayload` cards: render `overview` metrics, `routes` table when available, hide when `undefined`.
  - `intent`/`viewType` driven layout:
    - `SEMANTIC` / `chat` → chat panel with source cards.
    - `STATISTICAL` / `analytics` or `chat+analytics` → charts/tables + optional narrative.
    - `CONVERSATIONAL` → pure chat, no source cards.

#### 3.6 End-to-end Smoke Test
- **Goal**: Validate final behavior from UI down to DB.
- **Process**: Run `bash test_data/smoke_local.sh` + 3 browser queries.
- **Scenarios**
  | ID | Query | Expected |
  |----|-------|----------|
  | A | "오류가 발생한 적이 있어?" | Semantic intent, `sources: LogSource[]` with FAILED entries, `failedAt` visible in UI |
  | B | "존재하지 않는 에러코드 XYZ_999" | `sources: []`, guidance message in UI |
  | C | "이전 대화 요약해줘" | Conversational intent, `sources: []`, chat-only view |
  | D | "에러율이 어떻게 돼?" | Statistical intent, `statsPayload.overview` populated, metrics card rendered |

---

### 4. Implementation Order

Based on dependency analysis, the following order minimizes rework.

#### Phase A: Backend Data Pipeline (completed)

| Step | Section | Task | Status |
|------|---------|------|--------|
| ~~1~~ | 2.1 | Log Spec (`contracts/log-spec.ts`) & ADR-004 | **Done** |
| ~~2~~ | 2.3 | Pattern A enrichment: `failedAt`, `stepsReached`, step-level performance | **Done** |
| ~~3~~ | 2.2 | `validateWideEvent()` gate in MQ consumer | **Done** |
| ~~4~~ | 2.4 | `wide_events_embedded` schema + vector index filter fields | **Done** |
| ~~5~~ | 2.4 | `saveEmbeddingsAndUpdateWatermark()` derives new fields | **Done** |
| ~~6~~ | 2.6 | `normalizeMetadata()` between LLM extraction and query | **Done** |
| ~~7~~ | 2.5 | `vectorSearch()` applies `hasError`/`errorCode`/`failedAt` filters | **Done** |
| ~~8~~ | 2.7 | Stepwise filter relaxation in `SemanticQueryStrategy` | **Done** |
| ~~9~~ | 2.8 | Data reload + embedding rebuild + field verification | **Done** |
| ~~10~~ | 2.9 | Idempotent Mongo init + scripted smoke loop | **Done** |

#### Phase B: Contract & Frontend Alignment (next session)

| Step | Section | Task | Depends on | Est. |
|------|---------|------|------------|------|
| **11** | 3.1 | Establish `libs/contracts/`: move `log-spec.ts`, create `analysis-result.ts` with `LogSource`, `LogStats`, `StatsPayload`, `AnalysisResult`; add `@contracts/*` path alias | Phase A done | 15 min |
| **12** | 3.2 | Semantic strategy: map `fullLogs` → `LogSource[]` via `toLogSources()` | Step 11 | 30 min |
| **13** | 3.3 | Statistical strategy: map aggregation results → `StatsPayload` (`overview`, `routes`) via `buildStatsPayload()`; map `examples` → `LogSource[]` | Step 11 | 45 min |
| **14** | 3.4 | FE type sync: mirror contracts in `types.ts`, add `SEQUENTIAL`/`UNKNOWN` intent handling | Steps 12, 13 | 20 min |
| **15** | 3.5 | FE UI state differentiation: source cards, metrics card, no-result guidance, error display | Step 14 | 30 min |
| **16** | 3.6 | E2E smoke: `smoke_local.sh` + browser scenarios A/B/C/D | Step 15 | 15 min |

**Checkpoint**: After Step 12, call `GET /search/ask?q=오류가 발생한 적이 있어?` and verify `sources` is `LogSource[]`. This confirms the contract change works before touching the FE.

---

### 5. Done Criteria for Phase 5.1 Audit

#### Phase A — Backend Data Pipeline ✅
- [x] Canonical log and embedding schemas (Log Spec) are documented as JSON Schema/Interfaces.
- [x] ADR-004 documents the `wide_events._id` ↔ `wide_events_embedded.eventId` canonical mapping and Pattern A rationale.
- [x] Pattern A enrichment fields (`failedAt`, `stepsReached`, step-level performance) are added to `WideEventSpec`, `WideEvent`, and `LoggingContext`.
- [x] `WideEvent.toSummary()` includes `failedAt` for improved embedding quality.
- [x] `LoggingInterceptor` promotes response metadata (`errorService` → `failedAt`, step durations) to WideEvent context.
- [x] `wide_events_embedded` includes `hasError`, `errorCode`, `route`, `outcome`, `failedAt` in both MongoDB validator and TypeScript entity.
- [x] Vector search index registers `hasError`, `errorCode`, `route`, `failedAt` as filter fields.
- [x] Syntax and Semantic Validation Layer is implemented in MQ consumer using `class-validator` `validate()`.
- [x] Invalid logs are rejected with structured error logging (DLQ deferred to later phase).
- [x] `normalizeMetadata()` maps LLM-extracted metadata to canonical field values via `SERVICE_MAP_CONSTANTS`.
- [x] `vectorSearch` applies `hasError`/`errorCode`/`failedAt` filters at the `$vectorSearch` stage.
- [x] Semantic queries implement stepwise filter relaxation (not silently returning zero context).
- [x] Embedding batch endpoint can fully rebuild test embeddings with new fields (including `failedAt`) after DB reset.
- [x] Idempotent Mongo init script + one-command smoke loop (`smoke_local.sh`).

#### Phase B — Contract & Frontend Alignment (decisions made, implementation pending)

Decisions locked:
- `AnalysisResult.sources` → **BE enriches to `LogSource[]`** (Option A)
- `StatsPayload` → **BE maps raw to typed `overview`/`routes`** (Option A)
- Contracts location → **`libs/contracts/`** (not `src/contracts/`)

- [ ] `libs/contracts/` exists with `@contracts/*` path alias; `log-spec.ts` moved from `src/contracts/`.
- [ ] `libs/contracts/analysis-result.ts` defines `LogSource`, `LogStats`, `TimeSeriesPoint`, `RouteMetric`, `StatsPayload`, `AnalysisResult` as pure TypeScript interfaces.
- [ ] Semantic strategy maps `fullLogs` → `LogSource[]` and returns `sources: LogSource[]`.
- [ ] Statistical strategy maps aggregation results → typed `StatsPayload` (`overview: LogStats`, `routes: RouteMetric[]`).
- [ ] Statistical strategy maps `examples` → `LogSource[]` for `sources`.
- [ ] `src/embeddings/core/dtos/analysis-result.ts` re-exports from `@contracts` (backward compatibility).
- [ ] Frontend `AnalysisIntent` includes `SEQUENTIAL` and `UNKNOWN` with graceful fallback.
- [ ] Frontend types mirror `libs/contracts/` interfaces.
- [ ] UI clearly distinguishes between:
  - Log-based answers (source cards with `failedAt` badge),
  - No matching logs for given filters (guidance message),
  - System errors.
- [ ] Core test scenarios (A/B/C/D) pass end-to-end from UI to DB.
