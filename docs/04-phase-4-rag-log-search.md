# Phase 4 — RAG-Powered Log Search: Search -> Explain

## Goal

Focus on the core RAG value proposition: **"Search -> Explain"**. The system must transform raw log data into evidence-based natural language summaries. We prioritize **Semantic Retrieval (Path B)** as the primary engine and use **Rule-based Routing** for reliability.

## 1. Multi-modal Engine Strategy (Prioritized)

### Path B: Semantic Engine (Primary - High Priority)

The heart of Phase 4. It focuses on finding relevant context and synthesizing a summary.

- **Workflow**:
  1. Natural Language → Voyage AI Embedding.
  2. MongoDB Atlas Vector Search (`wide_events_embedded`).
  3. **Voyage AI Rerank** (`rerank-2`): Re-order top candidates for maximum relevance.
  4. **Grounding Pack**: Fetch full context from `wide_events` by `requestId`.
  5. **Gemini 1.5 Flash Synthesis**: Generate response strictly based on the Grounding Pack.

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

### Step 3: Conversational RAG (Multi-turn Context)

- **Query Reformulation**: LLM rewrites the user's latest question based on chat history (e.g., "Why did _it_ fail?" -> "Why did the payment fail for user-123?").
- **Session Management**: Leverage the `chat_history` collection to maintain state across multiple interactions.

### Step 4: Metric Engine & Templates (Path A Completion)

- **Template Registry**: Build a library of optimized MongoDB Aggregation pipelines for common metrics (P95 latency, error count by route).
- **Parameter Mapping**: Use LLM to map NL entities to template parameters (e.g., "checkout" -> `{ route: "/payments/checkout" }`).

### Step 5: Reliability & Performance Hardening

- **Grounding Verification**: Implement a "Fact Check" stage where the LLM verifies its own synthesis against the grounding pack before final output.
- **Semantic Caching**: Cache vector-query results to serve similar questions instantly, reducing API costs and latency.

## 5. Success Criteria

1. **Evidence-based**: Every answer includes at least 2-3 direct citations to original logs.
2. **Hallucination Control**: The system correctly identifies "Insufficient Information" for queries outside the log context.
3. **Traceability**: Users can click or reference `requestId`s directly from the AI response.
4. **Modularity**:
   > "Voyage AI is intentionally used only for retrieval and reranking. A separate LLM (Gemini) is responsible for synthesis to preserve modularity."

---

## Phase Boundary: Moving to Phase 5

Phase 4 delivers **Reactive Insight** (answering human queries with facts).
