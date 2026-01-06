# Phase 4 — RAG-Powered Log Search: Search -> Explain

## Goal

Focus on the core RAG value proposition: **"Search -> Explain"**. The system must transform raw log data into evidence-based natural language summaries. We prioritize **Semantic Retrieval (Path B)** as the primary engine and use **Rule-based Routing** for reliability.

## 1. Multi-modal Engine Strategy (Prioritized)

### Path B: Semantic Engine (Primary - High Priority)

The heart of Phase 4. It focuses on finding relevant context and synthesizing a summary.

- **Workflow**:
  1. Natural Language Query → **Query Preprocessing** (transform to structured format matching `_summary`).
  2. Structured Query → Voyage AI Embedding.
  3. MongoDB Atlas Vector Search (`wide_events_embedded`).
  4. **Voyage AI Rerank** (`rerank-2`): Re-order top candidates for maximum relevance.
  5. **Grounding Pack**: Fetch full context from `wide_events` by `requestId`.
  6. **Gemini 1.5 Flash Synthesis**: Generate response strictly based on the Grounding Pack.

### Path A: Structured Engine (Secondary - Template-based)

Instead of full NL-to-Aggregation, we use **Predefined Templates** for reliability.

- **Mechanism**: Identify keywords (e.g., "p95", "count", "how many") and map to optimized Mongo Aggregation templates.
- **Guardrails**: LLM is used only to fill parameters in templates, not to generate raw code.

### Path C: Hybrid Engine (Conceptual Proof)

- **Mechanism**: Semantic search to identify error signatures, followed by manual or template-based quantification.

## 2. Intelligence Architecture: Rule-based Router

To ensure senior-level reliability, we avoid full autonomous classification in favor of a **Rule + Fallback** router.

- **QueryMode**:
  - `SEMANTIC`: Default mode for exploratory questions ("Why did...", "What happened...").
  - `STRUCTURED`: Triggered by specific metric keywords ("how many", "count", "p95", "latency").
- **Graceful Degradation**:
  > "When intent confidence is low, the system gracefully degrades to raw log exploration instead of generating a hallucinated answer."

## 3. Grounding & Synthesis (The "Clean" Pack)

To prevent hallucinations, the context provided to Gemini 1.5 Flash is strictly structured.

```json
{
  "question": "Why did premium user checkout fail?",
  "grounding_context": [
    {
      "requestId": "uuid-123",
      "summary": "Outcome: FAILED, Error: GATEWAY_TIMEOUT",
      "timestamp": "2025-12-30T..."
    }
  ],
  "instruction": "Answer strictly based on the provided context. If evidence is missing, say 'Not enough evidence'."
}
```

## 4. Technical Implementation Steps

### Step 1: Semantic End-to-End (The "Big Win") - [Completed]

- **Pipeline Implementation**: Embedding -> Vector Search -> **Voyage Rerank**.
- **LLM Integration (for answers in natural language)**: Context-based synthesis using retrieved log grounding packs.(Gemini 2.5 Flash)

### Step 2: Metadata-Aware Retrieval (Pre-filtering + Post-filtering) - [Completed]

- **Intent-based Extraction**: LLM extracts time ranges (e.g., "last 1h", "yesterday"), service names, error codes, and error presence flags from the query.
- **MongoDB Pre-filtering**: Apply extracted metadata (time, service) to the `$vectorSearch` filter to eliminate noise and increase precision.
- **Post-filtering (Grounding Stage)**: After retrieving full log documents, apply error-related filters (`hasError`, `errorCode`) to ensure only relevant logs are included in the synthesis context.

### Step 2.5: Query Preprocessing & Embedding Strategy Improvement - [Completed]

- **Query Preprocessing**: Natural language queries are transformed into structured format matching the `_summary` format used for log embeddings.
  - Example: `"are there any failed cases of the service 'payment' today?"` → `"Outcome: FAILED, Service: payment, Error: ANY, ErrorMessage: ANY, UserRole: ANY, LatencyBucket: ANY"`
  - This ensures queries and documents use similar structured representations in the embedding space, improving semantic matching.
- **Chunking Utilities**: Added utilities for splitting long or complex log summaries into smaller, semantically meaningful chunks (based on MongoDB RAG tutorial Step 3).
  - Available strategies: `chunkSummary()`, `createOverlappingChunks()`, `chunkByFields()`
  - Currently using single-chunk strategy (current `_summary` format is concise), but utilities are available for future expansion.

### Step 2.6: Dual-layer Summary Strategy - [Completed]

- **Dual-layer Summary**: Implements industry-standard approach combining deterministic canonical signals with lightweight narrative surface.
  - **Narrative Layer**: Template-based natural language sentence (e.g., "A premium user experienced a payment failure during checkout due to GATEWAY_TIMEOUT.")
    - Provides "language surface" for natural language query matching
    - Generated deterministically without LLM (maintains reproducibility)
  - **Canonical Layer**: Structured field-based format (e.g., "Outcome: FAILED, Service: payments, Route: /payments/checkout, ...")
    - Provides stable semantic axes for statistics, aggregation, and filtering
  - **Combined Format**: `{narrative}\n\n{canonical}` - Both layers embedded together
  - **Benefits**:
    - Natural language queries match better (keywords like "failed", "payment", "premium" appear directly)
    - Structured information preserved for filtering and aggregation
    - Deterministic and reproducible (no LLM inference at ingestion time)
- **Grounding Fields**: Added `requestId` and `timestamp` to `wide_events_embedded` collection for accurate source retrieval.
  - Enables precise linking back to original `wide_events` documents
  - Supports traceability and evidence-based answers

### Step 3: Conversational RAG (Multi-turn Context) - [Completed]

- **Query Reformulation**: LLM rewrites the user's latest question based on chat history (e.g., "Why did _it_ fail?" -> "Why did the payment fail for user-123?").
- **Session Management**: Leverage the `chat_history` collection to maintain state across multiple interactions.
- **SessionCacheService**: In-memory session history caching with TTL (30 minutes default).
- **ContextCompressionService**: Compress long conversation history to reduce token usage while preserving important context.

### Step 4: Metric Engine & Templates (Path A Completion) - [Completed]

- **Template Registry**: Build a library of optimized MongoDB Aggregation pipelines for common metrics (P95 latency, error count by route).
- **Parameter Mapping**: Use LLM to map NL entities to template parameters (e.g., "checkout" -> `{ route: "/payments/checkout" }`).
  - route-pattern-constants.ts
- **LLM-based Statistical Analysis**: `analyzeStatisticalQuery()` method extracts template ID and parameters from natural language queries.
- **Advanced Metrics**: Support for P50, P95, P99 latency analysis templates.

### Step 5: Reliability & Performance Hardening - [Completed]

- **Grounding Verification**: Implement a "Fact Check" stage where the LLM verifies its own synthesis against the grounding pack before final output.
  - `verifyGrounding()` method in `SynthesisPort` interface
  - Verification status: VERIFIED, PARTIALLY_VERIFIED, NOT_VERIFIED
  - Action handling: REJECT_ANSWER, ADJUST_CONFIDENCE, KEEP_ANSWER
  - Confidence adjustment based on verification results
  - Unverified claims logging for monitoring
- **Semantic Caching**: Cache vector-query results to serve similar questions instantly, reducing API costs and latency.
  - `SemanticCacheService` with cosine similarity-based cache hit detection (threshold: 0.95)
  - TTL management: 1 hour default, 15 minutes for time-range queries
  - Metadata-based cache key generation with time normalization
  - Periodic cleanup of expired entries (every 10 minutes)

## 5. Success Criteria

1. **Evidence-based**: Every answer includes at least 2-3 direct citations to original logs.
2. **Hallucination Control**: The system correctly identifies "Insufficient Information" for queries outside the log context.
3. **Traceability**: Users can click or reference `requestId`s directly from the AI response.
4. **Modularity**:
   > "Voyage AI is intentionally used only for retrieval and reranking. A separate LLM (Gemini) is responsible for synthesis to preserve modularity."

---

## Phase Boundary: Moving to Phase 5

Phase 4 delivers **Reactive Insight** (answering human queries with facts).
