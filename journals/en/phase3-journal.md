# Phase 3 Retrospective: Deterministic Semantic Enrichment and Vector Search

## 1. Overview

The core objective of Phase 3 was to generate **"Deterministic and Explainable Semantic Representations"** from Wide Events and establish a vector embedding and semantic search environment.

Rather than just making vector search "work," the goal was to design an architecture that:
- Makes search results **explainable** (why a specific log was retrieved).
- Guarantees **consistent results** for identical inputs.
- Provides **stable grounding data** for reuse in subsequent RAG phases.

---

## 2. Key Themes & Challenges

- **Semantic Serialization**: Designed the `_summary` field to serialize structured logs into embedding-optimized text that satisfies both natural language queries and semantic similarity in vector space.
- **Overcoming Time-Series Collection Constraints**: Experienced the limitation of MongoDB Time-Series collections (no individual document updates), requiring a shift in thinking towards an immutability-based processing model.
- **Vector Search Indexing Strategy**: Configured vector indices only for essential fields for semantic search, operating within the constraints of MongoDB Atlas M0 tier (max 3 search indices).
- **SDK Transition & Stability**: Improved retry logic, error handling, and type safety by switching from manual `fetch` API calls to the official Voyage AI SDK.

---

## 3. Key Decisions & Rationale

### 3.1 High-Watermark & Derived Collection Strategy

Maintained the Time-Series collection (`wide_events`) as a **pure immutable log store** and saved embedding results in a separate derived collection (`wide_events_embedded`).

Managed processing status in an `embedding_progress` collection using a **dual high-watermark based on timestamp + ObjectId**, which ensured:
- Prevention of duplicate processing.
- Batch processing without omissions.
- Reprocessability in case of failure.

> This decision explicitly reflected the view that logs are "facts," not "states," into the system structure.

---

### 3.2 Deterministic Summary over LLM-based Summarization

While generating summaries using LLMs at ingestion time was considered, it was intentionally excluded in Phase 3.

Instead, we prioritized:
- **Explainability**: Constructing `_summary` from fields with clear semantic axes (Outcome, Error Code, User Role, Latency Bucket).
- **Cost Reduction**: Lowering embedding costs.
- **Reproducibility**: Ensuring search results are consistent.

This served as preparatory work to provide the most stable input for the LLM during the RAG implementation in Phase 4.

---

### 3.3 Validating the Extensibility of Hexagonal Architecture

By maintaining the existing Hexagonal Architecture, we were able to build the entire semantic search pipeline just by extending:
- `EmbeddingUseCase`
- `LogStoragePort`

This indirectly validated that the initial design was sufficiently decoupled for functional expansion.

---

### 3.4 Cost-Aware Sampling Strategy

We determined that embedding every single log had low utility relative to the cost. 

In Phase 3, we introduced explicit sampling criteria:
- **Error Logs**: 100%
- **Premium User Logs**: 100%
- **Normal Success Logs**: Selective

This balanced embedding costs with the analytical value of the data.

---

## 4. Retrospective: KPT

### Keep

- **Validating Semantic Search Utility**: Verified the end-to-end flow of returning reasonable log candidates with similarity scores for natural language questions like "Payment failure for premium user."
- **Durability against Architectural Changes**: Designs were flexible enough that major infrastructure-layer changes (SDK swap, update strategy changes) were absorbed without touching domain logic.
- **Semantic-Axis Data Modeling**: Enabled similarity comparisons based on meaning rather than raw numbers by converting `durationMs` into `LatencyBucket`.

---

### Problem

- **Initial Oversight of Time-Series Update Constraints**: Had to redesign the embedding status management strategy due to insufficient consideration of the update limitations in Time-Series collections.
  - *Result*: This led to a clearer understanding of log immutability.
- **Fragile Environment Variable Management**: Resolved initial implementation risks of missing variables due to direct `process.env` references by unifying management with the NestJS `ConfigModule`.

---

### Try

- **Enhancing PII Protection**: Refine automatic masking rules during `_summary` generation and review a dedicated PII-removed View.
- **Improving Search Quality**: Experiment with re-ranking search results using Voyage AI's Rerank feature.
- **Combining Aggregation and Semantic Search**: Explore structures where Aggregation results (from a PII-removed View) and vector search can be utilized together.

---

## 5. Additional Insights

- **The Value of Determinism**: Experienced that at the log processing stage, "re-explainable summaries" are far more important than "smart summaries."
- **Importance of Grounding**: Secured a strong link back to the original log facts by preserving the `eventId` in the embedding collection, ensuring AI-based analysis always remains grounded.

---

## Outcome

Phase 3 established the technical foundation for **Phase 4 (RAG-based Insight Generation)**, enabling the exploration of system status and error contexts using natural language queries.

