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

#### 3.1 API Contract & Types
- **Goal**: Ensure the frontend `AnalysisResult` type matches the backend DTO.
- **Current state — Specific mismatches identified**
  | Field | Backend (`analysis-result.ts`) | Frontend (`loglens/types.ts`) | Issue |
  |-------|-------------------------------|-------------------------------|-------|
  | `sources` | `string[]` (requestId list) | `LogSource[]` (object with `id`, `summary`, `status`, `route`, `duration`, `timestamp`) | Fundamental shape mismatch |
  | `statsPayload.overview` | `Record<string, any>` | `LogStats` (typed: `totalRequests`, `errorRate`, `avgLatency`, ...) | BE is untyped; FE assumes structure |
  | `statsPayload.timeseries` | `Array<Record<string, any>>` | `TimeSeriesPoint[]` (typed: `time`, `requests`, `errors`, `latency`) | Same |
  | `statsPayload.routes` | `Array<Record<string, any>>` | `RouteMetric[]` (typed) | Same |
  | `intent` | `AnalysisIntent` enum (5 values: `STATISTICAL`, `SEMANTIC`, `SEQUENTIAL`, `CONVERSATIONAL`, `UNKNOWN`) | `AnalysisIntent` type (3 values: `SEMANTIC`, `STATISTICAL`, `CONVERSATIONAL`) | FE missing `SEQUENTIAL` and `UNKNOWN` |
  | `createdAt` | `Date` | `string` | Serialization mismatch |
- **Actions**
  - **Decide on `sources` contract**: Either (a) the backend enriches `sources` into `LogSource[]` objects before responding, or (b) the frontend hydrates `string[]` IDs into objects via a separate API call. Option (a) is simpler for the current scale.
  - Type the `StatsPayload` fields on the backend side (replace `Record<string, any>` with concrete interfaces matching what the aggregation pipeline actually produces).
  - Add `SEQUENTIAL` and `UNKNOWN` to the frontend `AnalysisIntent` type, with appropriate UI fallback handling.
  - Adopt a **contract-first** approach: create a `contracts/` directory in the backend with pure TypeScript interface files that define the API response shapes. The frontend manually mirrors these. CI can optionally diff-check.
  - Consider optional backend fields for richer UX:
    - E.g. `debugInfo`, `filterStatus` (e.g. `NO_MATCHING_LOGS_FOR_FILTER`).

#### 3.2 UI States for Result Semantics
- **Goal**: Make the UI reflect "how" the backend reached an answer, not just the text.
- **States to represent**
  - **Normal answer with evidence**:
    - `sources.length > 0`.
  - **No matching logs for filters / low evidence**:
    - `sources.length === 0` plus a specific backend status/reason.
  - **System error**:
    - Response shape `{ error, message }` or HTTP error.
- **Actions**
  - Update the home/search page to:
    - Distinguish these cases visually and textually.
    - Offer suggestions when no logs match (e.g. "Try relaxing time/service/error filters.").

#### 3.3 Intent & ViewType-driven UX
- **Goal**: Use `intent` and `viewType` to drive different visualizations.
- **Cases**
  - `intent = SEMANTIC`, `viewType = 'chat'`:
    - Chat-style answer with linked log sources.
  - `intent = STATISTICAL`, `viewType = 'analytics' | 'chat+analytics'`:
    - Charts/tables for metrics plus optional narrative summary.
  - `intent = CONVERSATIONAL`:
    - Pure conversational history + answer; no log evidence required.

#### 3.4 End-to-end Test Scenarios
- **Goal**: Validate final behavior from UI down to DB.
- **Scenarios**
  - A. "오류가 발생한 적이 있어?" with known error logs:
    - Expect semantic intent, non-empty `sources`, high-confidence answer.
  - B. Query with an error code that does not exist:
    - Expect explicit "no matching logs for this condition" style UX.
  - C. Pure conversational question (history-related):
    - Expect conversational strategy, no log queries, answer driven by chat history.

#### 3.5 FE/BE Type Sharing Strategy
- **Goal**: Minimize structural differences between frontend, backend, and native logs to operate under a unified standard policy.
- **Current state**
  - Backend (`backend/`) and frontend (`frontend/`) are fully independent projects. No monorepo tooling (no Turborepo, Nx, Lerna, or pnpm workspaces). No shared `packages/` directory.
  - Types are manually duplicated in each project with no synchronization mechanism.
- **Strategy by scale**
  | Scale | Approach | Effort |
  |-------|----------|--------|
  | Current (1 dev, 2 apps) | **Contract files**: BE maintains `contracts/` with pure TS interfaces. FE copies/mirrors manually. Code review enforces sync. | Low |
  | Growing (2–3 devs) | **CI diff check**: Script compares BE contract interfaces against FE types and fails if they diverge. | Medium |
  | Team (3+ devs, 3+ services) | **Monorepo shared package**: `packages/contracts` via pnpm workspaces, imported by both FE and BE. | High |
- **Actions (current phase)**
  - Create `backend/src/contracts/` with pure interface files (no decorators, no framework imports) for `AnalysisResult`, `StatsPayload`, `LogSource`.
  - Frontend mirrors these in `src/shared/lib/loglens/types.ts`.
  - Extend the Log Spec to accommodate platform-specific fields (e.g., `platform: 'FE' | 'BE'`) when FE log ingestion is introduced.

---

### 4. Implementation Order

Based on dependency analysis, the following order minimizes rework.

> 2.1 (Log Spec & ADR-004) is already completed.

| Step | Section | Task | Depends on | Rationale |
|------|---------|------|------------|-----------|
| ~~**1**~~ | ~~2.1~~ | ~~Log Spec (`contracts/log-spec.ts`) & ADR-004~~ | — | **Done** |
| **2** | 2.3 | Implement Pattern A enrichment: add `failedAt`, `stepsReached`, step-level performance to `WideEventSpec`/`WideEvent`/`LoggingContext`; update `toSummary()` | Step 1 | Raw log must capture multi-step context before downstream consumers (embeddings, vector search) can use it |
| **3** | 2.2 | Add `validateWideEvent()` gate in MQ consumer using `class-validator` `validate()` | Step 2 | Validation must cover the enriched schema; prevents bad data going forward |
| **4** | 2.4 | Add `hasError`, `errorCode`, `route`, `outcome`, `failedAt` to `wide_events_embedded` schema (entity + mongodb-init.js + vector index) | Step 2 | Embedding schema must mirror the enriched raw log fields |
| **5** | 2.4 | Update `saveEmbeddingsAndUpdateWatermark()` to derive and persist the new fields from enriched `WideEvent` | Step 4 | Schema exists but nothing writes to it yet |
| **6** | 2.6 | Implement `normalizeMetadata()` between LLM extraction and query execution | Step 4 | Requires knowing which filter fields exist in the embedding collection |
| **7** | 2.5 | Extend `vectorSearch()` to apply `hasError`/`errorCode`/`failedAt` in the `$vectorSearch` filter stage | Steps 4, 6 | Filter fields must exist (Step 4) and metadata must be normalized (Step 6) |
| **8** | 2.7 | Implement stepwise filter relaxation in `SemanticQueryStrategy` | Step 7 | Fallback logic depends on the filter pipeline being correct first |
| **9** | 3.1 | Align `AnalysisResult` contract: type `StatsPayload`, decide `sources` shape, sync `AnalysisIntent` values | Steps 2–8 (BE stabilized) | FE contract should be set after BE schema is finalized |
| **10** | 2.8 | Clear data, rebuild embeddings, verify new fields (including `failedAt`) populated correctly | Steps 2–5 | Full data reload must happen after both schema and validation changes |
| **11** | 3.2–3.4 | FE UI updates and end-to-end test scenarios | Steps 9, 10 | FE work begins after contract is stable and test data exists |

---

### 5. Done Criteria for Phase 5.1 Audit
- [x] Canonical log and embedding schemas (Log Spec) are documented as JSON Schema/Interfaces (`contracts/log-spec.ts`).
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
- [ ] Backend `StatsPayload` fields are typed (not `Record<string, any>`).
- [ ] Backend `AnalysisResult.sources` contract is decided and aligned with frontend `LogSource[]`.
- [ ] Frontend `AnalysisIntent` includes `SEQUENTIAL` and `UNKNOWN` with graceful fallback.
- [ ] `contracts/` directory exists in backend with pure interface files for API response shapes.
- [x] Embedding batch endpoint can fully rebuild test embeddings with new fields (including `failedAt`) after DB reset.
- [ ] UI clearly distinguishes between:
  - Log-based answers,
  - No matching logs for given filters,
  - System errors.
- [ ] Core test scenarios (A/B/C) pass end-to-end from UI to DB.
