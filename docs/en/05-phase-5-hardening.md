# Phase 5 — Production Hardening (Infrastructure & Resilience)

## Goal

Solidify the logging pipeline for production stability and establish a resilient foundation for future intelligence.
Phase 5 focuses on **Infrastructure Resilience** (performance, scalability, cost optimization) and a **Pragmatic Intelligence** bridge (rule-based incident detection).

## Strategy

Phase 5 prioritizes "Hardening" to ensure the system can handle production loads without affecting application performance.

1.  **Production-Grade Infrastructure**: Decouple logging from application performance using asynchronous pipelines.
2.  **Distributed Scalability**: Move from in-memory to Redis for cross-instance state management.
3.  **Cost-Aware Sampling**: Strategically reduce log volume while preserving all high-value signals (errors/latency).
4.  **Graceful Degradation**: Ensure the system remains functional even if infrastructure (MQ/Redis) fails.

## Priority: Phase 5-A (Core Hardening)

### High Priority (Must-Have for Completion)

1.  **Asynchronous Logging Pipeline (MQ Integration)**: Decouple API latency from storage latency.
2.  **Distributed Cache (Redis Integration)**: Support multi-instance deployments.
3.  **Tail-Aware Sampling**: Optimize storage costs and bandwidth.
4.  **Rule-based Incident Aggregation**: Simple "Group by + Summarize" for immediate operational value.

### Medium Priority (Observability)

5.  **Infrastructure Metrics**: Queue depth, cache hit rates, and sampling retention rates.

---

## Implementation Steps

### Step 1: Asynchronous Logging Pipeline (MQ Integration)

**Goal**: Decouple logging overhead from API response latency.

**Implementation**:

- Introduce Message Queue (Kafka/Redis Streams) between `LoggingService` and `LoggerPort`.
- **Producer**: `LoggingService.finalize()` publishes `WideEvent` to MQ (non-blocking).
- **Consumer**: Background worker consumes from MQ and persists to MongoDB.
- **Error Handling**:
  - **Retry**: Fixed retry (e.g., 3 times) with simple backoff.
  - **Graceful Fallback**: If MQ is unavailable, fallback to synchronous logging (file or direct DB) to prevent data loss.

**Design Decisions**:

- Prioritize **Latency Decoupling** over complex delivery guarantees in PoC.
- Batch writes to MongoDB for efficiency (e.g., every 1 second or 100 events).

### Step 2: Redis-based Distributed Caching

**Goal**: Enable distributed deployments and maintain cache consistency across instances.

**Implementation**:

- **Abstraction**: Use `SessionCachePort` and `SemanticCachePort` to support both `InMemory` and `Redis` adapters.
- **Session Cache**: Store serialized chat history in Redis with TTL.
- **Semantic Cache (Pragmatic)**: Use exact-key lookup instead of vector similarity.
  - Key Strategy: `hash(normalized_query + prompt_version + language)`.
  - Value: Cached LLM response.

**Design Decisions**:

- Avoid vector similarity search in Redis for Phase 5 to reduce complexity and ensure deterministic cache hits.

### Step 3: Tail-Aware Sampling (Cost-Conscious)

**Goal**: Preserve error & latency signals while reducing log volume by 80-90%.

**Implementation**:

- **Sampling Strategy**:
  - **100% Retention**: Any event with `error.code`, `durationMs > threshold`, or critical routes.
  - **Probabilistic Sampling**: 1-5% of "Normal" successful requests.
- **Decision Point**: Before MQ publish to reduce bandwidth and queue load.

**Design Decisions**:

- Sampling decisions must be **Deterministic** (based on `requestId` hash) and **Explainable by Policy** (documented rules).

---

## Intended Non-implementation (Design Trade-offs)

To focus on core stability, the following are **deliberately deferred** to Phase 6:

- **Complex Clustering**: DBSCAN/K-means for log grouping are replaced by rule-based aggregation.
- **Full DLQ Management**: Advanced dead-letter queue orchestration is conceptualized but simplified to fixed retries.
- **Vector-Similarity Cache**: Swapped for exact-key hashing for higher reliability and lower latency.
- **Grounding Metrics**: Full RAG verification metrics are moved to the intelligence phase.

---

## Success Criteria

1.  **Latency**: API response time remains stable regardless of MongoDB write performance.
2.  **Resilience**: System continues to log (via fallback) even if Kafka or Redis is down.
3.  **Cost**: Log storage volume reduced significantly while retaining 100% of error data.

---

## Phase Boundary: To Phase 6

Phase 5-A delivers a **Production-Grade Infrastructure**. Once complete, the system is ready for the "Intelligence" layer:

- Automated generation of at least one rule-based incident summary.
- Advanced Clustering (DBSCAN).
- Automated Daily Briefings (Reverse RAG).
- Multi-Agent Specialized Analysts.
