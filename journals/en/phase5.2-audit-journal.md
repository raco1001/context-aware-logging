## Phase 5.2 Audit: Session Persistence, Chart Lock & Mock Cleanup

### 1. Scope

- **Backend focus**: Expose session lifecycle APIs (list, delete) with anonymous client identity, enabling frontend session persistence without authentication.
- **Frontend focus**: Replace all mock session data with real API calls, persist session state across page refreshes, add chart lock/snapshot capability, and clean up remaining mock data.

Assumption: Phase 5.1 (all phases A/B/C) is complete. The backend has working `GET /search/ask`, `GET /search/history` endpoints with `sessionId`-based chat persistence in MongoDB.

#### 1.1 Current State Assessment

| Area | Finding | Impact |
|------|---------|--------|
| Session list | No `GET /search/sessions` endpoint; sidebar always shows `MOCK_SESSIONS` | New sessions created at runtime never appear in the sidebar |
| Client identity | No `clientId` concept; any browser can access any session by guessing `sessionId` | No session ownership; cannot filter "my sessions" |
| Session persistence (FE) | `activeSessionId` is React state only; lost on page refresh | User must reselect or create a new session after every refresh |
| Session title | No title generation; mock sessions have hardcoded titles | Real sessions have no meaningful label in the sidebar |
| Chart lock | No lock/pin/freeze mechanism | Users cannot preserve a chart snapshot while continuing to query |
| Mock data (FE) | `MOCK_STATS`, `generateTimeSeriesData()`, `MOCK_ROUTE_METRICS`, `MOCK_STATUS_DISTRIBUTION` used as initial values | Charts show fabricated data on load, potentially misleading |
| StatusPieChart | Always uses `MOCK_STATUS_DISTRIBUTION`; no backend data source | Pie chart never reflects real status distribution |

---

### 2. Backend Improvements

#### 2.1 Anonymous Client Identity

- **Goal**: Associate sessions with a browser without requiring authentication, while keeping the door open for real user identity later.
- **Design decision**: **Anonymous `clientId` via localStorage UUID** (see ADR-005 §Extension notes). No login flow. The `clientId` is a UUID generated client-side and stored in `localStorage`. It is sent on every API request as the `X-Client-Id` header.
- **Why `X-Client-Id` header (not query param)**:
  - Headers are invisible in URL sharing (no accidental session leakage).
  - Centralizable in `apiFetch()` — one place to set, all endpoints receive it.
  - Conventional for client-identity headers (`X-Request-Id`, `X-Correlation-Id` precedent).
- **Extensibility path**:
  - Current: FE generates UUID → `X-Client-Id` header → BE reads raw header value.
  - Future: Auth middleware intercepts `Authorization: Bearer <jwt>` → extracts `userId` → injects as `clientId` into request context. Downstream code unchanged.
- **Actions**
  - **2.1.1** Add `clientId?: string` to `AnalysisResult` in `libs/contracts/analysis-result.ts`.
  - **2.1.2** Update `SearchController`:
    - `ask()`: Accept `@Headers('x-client-id') clientId?: string`, pass to `SearchService.ask()`.
    - `getHistory()`: Accept `clientId` header (for future filtering, currently unused by this endpoint).
  - **2.1.3** Update `SearchService.ask()` signature to accept `clientId`.
    - Pass `clientId` through to `SessionCacheService.updateSession()`.
  - **2.1.4** Update `MongoChatHistoryAdapter.save()`:
    - Include `clientId` field in the inserted document.
  - **2.1.5** Add index on `chat_history.clientId` for efficient session listing queries.
    - Add to `docker/mongo/mongodb-init.js` (idempotent `createIndex`).
- **Acceptance**: `chat_history` documents include `clientId` when the header is provided.

#### 2.2 Session List API

- **Goal**: Enable the frontend to fetch real session summaries for the current client.
- **Actions**
  - **2.2.1** Define `SessionSummary` interface in `libs/contracts/analysis-result.ts`:
    ```
    SessionSummary {
      sessionId: string
      clientId?: string
      title: string
      lastMessage: string
      messageCount: number
      createdAt: string   // ISO
      updatedAt: string   // ISO
    }
    ```
  - **2.2.2** Add `listSessions(clientId): Promise<SessionSummary[]>` to `ChatHistoryPort`.
  - **2.2.3** Implement in `MongoChatHistoryAdapter`:
    - MongoDB aggregation pipeline on `chat_history`:
      - `$match: { clientId }` (if provided; return all if absent)
      - `$sort: { createdAt: 1 }` (within each session, chronological order)
      - `$group` by `sessionId`:
        - `title`: `$first` question (truncated to 50 chars)
        - `lastMessage`: `$last` answer (truncated to 100 chars)
        - `messageCount`: `$sum: 1`
        - `createdAt`: `$first` createdAt
        - `updatedAt`: `$last` createdAt
      - `$sort: { updatedAt: -1 }` (most recent first)
      - `$limit: 50` (cap for performance)
    - Filter out sessions with `messageCount === 0` (empty sessions never reach DB since `save()` only runs after a query completes).
  - **2.2.4** Add `listSessions(clientId)` to `SearchUseCase` and `SearchService`.
  - **2.2.5** Add `GET /search/sessions` endpoint to `SearchController`:
    - Reads `X-Client-Id` header.
    - Returns `SessionSummary[]`.
  - **2.2.6** Add `title` field to `chat_history` save logic:
    - On `updateSession()`: if this is the first message in the session (no prior history), derive title from the question (first 50 chars).
    - Store `title` alongside each document. The aggregation `$first` picks the earliest title.
- **Acceptance**: `GET /search/sessions` with `X-Client-Id` header returns only that client's sessions, sorted by most recent activity.

#### 2.3 Session Delete API

- **Goal**: Allow clients to remove sessions they no longer need.
- **Actions**
  - **2.3.1** Add `deleteSession(sessionId, clientId): Promise<boolean>` to `ChatHistoryPort`.
  - **2.3.2** Implement in `MongoChatHistoryAdapter`:
    - `deleteMany({ sessionId, clientId })` — `clientId` guard prevents cross-client deletion.
    - Return `deletedCount > 0`.
  - **2.3.3** Add `deleteSession()` to `SearchService`:
    - Call `chatHistoryPort.deleteSession()`.
    - Call `sessionCacheService.invalidateSession(sessionId)`.
  - **2.3.4** Add `DELETE /search/sessions/:sessionId` to `SearchController`:
    - Reads `X-Client-Id` header for ownership check.
    - Returns `{ deleted: boolean }`.
- **Acceptance**: Deleting a session removes all `chat_history` documents for that `sessionId` and evicts the cache entry.

---

### 3. Frontend Improvements

#### 3.1 Client Identity Utility

- **Goal**: Generate and persist a stable `clientId` per browser.
- **Actions**
  - **3.1.1** Create `frontend/src/shared/api/clientId.ts`:
    - `getClientId(): string` — reads from `localStorage('loglens-client-id')`; if absent, generates `crypto.randomUUID()`, stores it, and returns.
  - **3.1.2** Update `frontend/src/shared/api/httpClient.ts`:
    - `apiFetch()` automatically attaches `X-Client-Id: getClientId()` header to every request.
  - **3.1.3** Update `frontend/src/shared/api/logSearch.ts`:
    - Add `getSessionList(): Promise<{ res, data }>` calling `GET /search/sessions`.
    - Add `deleteSession(sessionId): Promise<{ res, data }>` calling `DELETE /search/sessions/:sessionId`.
- **Acceptance**: Every API request includes `X-Client-Id` header; `getSessionList()` and `deleteSession()` are available.

#### 3.2 Session List Integration

- **Goal**: Replace `MOCK_SESSIONS` with real data; persist active session across refreshes.
- **Actions**
  - **3.2.1** Remove `MOCK_SESSIONS` import from `HomePage.tsx`.
  - **3.2.2** Add state: `sessions: ChatSession[]`, initialized to `[]`.
  - **3.2.3** Add `useEffect` on mount: call `getSessionList()` → map `SessionSummary[]` to `ChatSession[]` → `setSessions()`.
  - **3.2.4** `activeSessionId` persistence:
    - On change: `localStorage.setItem('loglens-active-session', id)`.
    - On mount: `localStorage.getItem('loglens-active-session')` → `setActiveSessionId()`.
    - On "All Sessions": `localStorage.removeItem('loglens-active-session')`.
  - **3.2.5** `handleNewSession()`:
    - Generate `sess-${Date.now()}`.
    - Optimistically add to `sessions` state (with placeholder title "New session").
    - Title will be updated when the first query response returns (via session list refresh).
  - **3.2.6** `handleSendMessage()`:
    - After successful response: trigger session list refresh (`getSessionList()`) to pick up new title/lastMessage.
    - Debounce or throttle to avoid excessive calls on rapid messaging.
  - **3.2.7** Session delete:
    - Add delete button (trash icon) to each session item in `SessionSidebarWidget`.
    - On click: `deleteSession(id)` → remove from `sessions` state → if `activeSessionId === id`, reset to null.
  - **3.2.8** `SessionSidebarWidget` props update:
    - Add `onDeleteSession?: (id: string) => void`.
    - Add loading state for initial fetch.
- **Design note on `ChatSession` type**: `ChatSession.createdAt` is currently `Date`. Backend returns ISO strings. The mapping in 3.2.3 converts `string → new Date()`.
- **Acceptance**: Sidebar shows real sessions from backend; creating a new session and sending a message causes the sidebar to update with the correct title; refreshing the page restores the last active session.

#### 3.3 Chart Lock (Snapshot)

- **Goal**: Let users freeze the analytics panel so new query responses don't overwrite the displayed charts.
- **Actions**
  - **3.3.1** Add state to `HomePage.tsx`: `isChartLocked: boolean`, default `false`.
  - **3.3.2** In `handleSendMessage()`, wrap the analytics update block (lines 157–180) with `if (!isChartLocked)` guard.
  - **3.3.3** Add Lock toggle button in the analytics panel header:
    - Positioned alongside the existing analytics panel area (above `StatsOverviewWidget`).
    - Icon: `Lock` (locked) / `LockOpen` (unlocked) from `lucide-react`.
    - Label: "Snapshot" when locked.
    - Visual indicator: subtle border color change or badge when locked.
  - **3.3.4** When lock is toggled ON:
    - Capture the current chart state — no action needed since we simply stop updating.
    - Show a subtle visual indicator (e.g., "Snapshot" badge on the panel).
  - **3.3.5** When lock is toggled OFF:
    - Resume normal updates. The next STATISTICAL response will update the charts.
    - No retroactive update from missed responses (intentional — user chose to lock).
  - **3.3.6** Lock state resets:
    - On page refresh: default `false` (not persisted).
    - On session change: reset to `false` (different session context).
- **Design note**: Lock applies to the **entire analytics panel** (overview + timeseries + routes), not individual charts. Per-chart lock adds complexity without meaningful UX benefit at this scale. If needed later, refactor to `lockedChartIds: Set<string>`.
- **Acceptance**: Toggling lock ON prevents chart updates from new queries. Toggling OFF resumes updates.

#### 3.4 Mock Data Cleanup

- **Goal**: Remove fabricated initial data; show empty/loading states when no real data exists.
- **Actions**
  - **3.4.1** Change `analyticsOverview` initial value: `MOCK_STATS` → `null`.
    - When `null` and `showOverviewCard` is true, show a "No stats available" placeholder.
  - **3.4.2** Change `analyticsTimeseries` initial value: `generateTimeSeriesData()` → `[]`.
    - Remove the `useEffect` that calls `generateTimeSeriesData()` on mount.
    - Chart widgets should handle empty arrays gracefully (show "No data" state).
  - **3.4.3** Change `analyticsRoutes` initial value: `MOCK_ROUTE_METRICS` → `[]`.
  - **3.4.4** `StatusPieChart`:
    - Remove `MOCK_STATUS_DISTRIBUTION` usage.
    - Hide `StatusPieChartWidget` entirely when no real `statusDistribution` data is available.
    - Since `StatsPayload` does not currently include `statusDistribution`, the chart is hidden by default.
    - Future: Add `statusDistribution?: StatusDistribution[]` to `StatsPayload` when a corresponding aggregation template is implemented.
  - **3.4.5** Clean up `mock-data.ts`:
    - Remove `MOCK_SESSIONS`, `MOCK_STATS`, `generateTimeSeriesData`, `MOCK_ROUTE_METRICS`, `MOCK_STATUS_DISTRIBUTION`.
    - Keep `INITIAL_MESSAGES` (welcome message is a UX element, not mock data).
    - Remove `StatusDistribution` type export if no longer referenced by non-mock code.
  - **3.4.6** Update `HomePage.tsx` analytics merge logic:
    - `setAnalyticsOverview((prev) => ({ ...(prev || MOCK_STATS), ... }))` → `setAnalyticsOverview((prev) => ({ ...(prev || {}), ... }))`.
    - Remove all `MOCK_*` imports.
- **Acceptance**: Page loads with empty analytics panels (no fabricated data). Charts populate only after a STATISTICAL query returns real data.

---

### 4. Implementation Order

| Step | Section | Task | Depends on | Est. |
|------|---------|------|------------|------|
| **1** | 2.1.1, 2.2.1 | Contracts: add `clientId?` to `AnalysisResult`; define `SessionSummary` interface in `libs/contracts/` | — | 15 min |
| **2** | 2.1.2–5, 2.2.6 | BE: `clientId` flow — controller header extraction, service pass-through, MongoDB save with `clientId`/`title`; add `chat_history.clientId` index | Step 1 | 30 min |
| **3** | 2.2.2–5 | BE: `ChatHistoryPort.listSessions()` + aggregation impl + `GET /search/sessions` endpoint | Step 2 | 20 min |
| **4** | 3.1.1–3 | FE: `getClientId()` utility + `X-Client-Id` header in `apiFetch()` + `getSessionList()`/`deleteSession()` API functions | Step 1 | 15 min |
| **5** | 3.2.1–8 | FE: Replace `MOCK_SESSIONS` with `GET /search/sessions`; `activeSessionId` localStorage persistence; sidebar loading state; optimistic new session; session list refresh after query | Steps 3, 4 | 30 min |
| **6** | 3.3.1–6 | FE: Chart Lock toggle state + analytics update guard + Lock/LockOpen button + session-change reset | — | 20 min |
| **7** | 3.4.1–6 | FE: Remove mock initial values; handle empty states; clean up `mock-data.ts`; hide StatusPieChart when no data | Step 5 | 15 min |
| **8** | 2.3.1–4 | BE: `DELETE /search/sessions/:sessionId` + `clientId` ownership guard + cache invalidation | Step 2 | 20 min |
| **9** | 3.2.7 | FE: Session delete button in sidebar + API call + state update | Steps 5, 8 | 10 min |
| **10** | — | E2E verification: new session → query → refresh → session restored → chart lock on → query → charts unchanged → lock off → query → charts updated → delete session → sidebar updated | Step 9 | 20 min |

**Checkpoint 1**: After Step 3, call `GET /search/sessions` with `X-Client-Id: test-uuid` and verify empty array (no sessions yet for this client).

**Checkpoint 2**: After Step 5, create a new session in the browser, send a query, refresh the page — verify the session reappears in the sidebar with the correct title.

**Checkpoint 3**: After Step 7, verify that page load shows empty analytics panels (no mock data visible).

---

### 5. Done Criteria for Phase 5.2

#### Backend — Session APIs

- [ ] `AnalysisResult` includes optional `clientId` field in `libs/contracts/`.
- [ ] `SessionSummary` interface defined in `libs/contracts/`.
- [ ] `SearchController` reads `X-Client-Id` header and passes to service layer.
- [ ] `chat_history` documents include `clientId` and `title` fields.
- [ ] `chat_history.clientId` index exists in MongoDB init script.
- [ ] `GET /search/sessions` returns `SessionSummary[]` filtered by `clientId`.
- [ ] Session title is auto-derived from the first question (truncated to 50 chars).
- [ ] `DELETE /search/sessions/:sessionId` removes documents and invalidates cache.
- [ ] Delete endpoint enforces `clientId` ownership (cannot delete another client's session).

#### Frontend — Session Persistence

- [ ] `getClientId()` generates and persists UUID in `localStorage`.
- [ ] Every API request includes `X-Client-Id` header via `apiFetch()`.
- [ ] Sidebar shows sessions from `GET /search/sessions` (not `MOCK_SESSIONS`).
- [ ] `activeSessionId` persists in `localStorage`; restored on page refresh.
- [ ] New sessions appear in sidebar after first query (optimistic + refresh).
- [ ] Session delete removes from sidebar and backend.

#### Frontend — Chart Lock

- [ ] Lock toggle button visible in analytics panel.
- [ ] Lock ON: analytics state (`overview`, `timeseries`, `routes`) not updated by new query responses.
- [ ] Lock OFF: next STATISTICAL response updates charts normally.
- [ ] Lock resets to OFF on session change and page refresh.

#### Frontend — Mock Cleanup

- [ ] `MOCK_SESSIONS`, `MOCK_STATS`, `generateTimeSeriesData()`, `MOCK_ROUTE_METRICS`, `MOCK_STATUS_DISTRIBUTION` removed from `mock-data.ts`.
- [ ] `INITIAL_MESSAGES` retained as UX welcome message.
- [ ] Analytics panels show empty/loading state on initial load (no fabricated data).
- [ ] `StatusPieChartWidget` hidden when no real `statusDistribution` data is available.
- [ ] `pnpm build` succeeds in both frontend and backend with zero type errors.
