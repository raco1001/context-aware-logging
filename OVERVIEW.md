# Context-Aware Logging & RAG Observability System

## A. Motivation

### 1. Inspiration: "Logging is a Mess"

- [Logging is a Mess](https://news.hada.io/topic?id=25239)

  This project was inspired by discussions surrounding the realization that modern observability is often broken.

- **Problem**: In distributed systems, individual services often store logs in silos, making it nearly impossible to reconstruct the full context across services, caches, and databases.
- **Key Pain Points**:
  - String-based search (`grep`) is insufficient for fragmented log fields.
  - Logs are often optimized for _writing_ rather than _querying_.
  - Logs should tell the "truth" — they must contain enough context, structure, and accountability.

### 2. Personal & Professional Context

- **Practical Experience**: Having managed services where logs were scattered across independent instances, I experienced the inefficiency of manually stitching together logs to debug a single request.
- **Project Experience**: Building full-stack applications highlighted the friction of jumping between frontend activity tracks, backend execution logs, and database traces.
- **Community Consensus**: At sessions like the MongoDB User Group Korea, I confirmed that many developers struggle with maintaining consistency across distributed log collections and optimizing query performance for time-series log data.

### 3. The Core Idea: Wide Events as Context

Participating in MongoDB AI Skill Sessions (Vector Search, RAG, Agentic Retrieval) led to a breakthrough:

- **Concept**: If we capture logs in a **Wide Event** format — where a single request, its metadata, and all its side effects are stored as one rich document — we create a self-contained unit of context.
- **Hypothesis**: "By treating a single log entry as a complete context and preprocessing it, we can enable intuitive natural language querying through RAG."

### 4. Safety & Trust in AI

- **Risks**: RAG systems introduce risks like data leakage, hallucinations, and loss of trust.
- **Mitigation**:
  - Raw logs are stored sequentially for auditability.
  - AI preprocessing focuses on generating meaningful summaries while ensuring the LLM returns structured references to raw data, maintaining "grounding" and truthfulness.

---

## B. Core Principles

The logging system and storage architecture are built on the following pillars:

- **Wide Event Logging**: One Request → One context-rich event.
- **Query-First Design**: Logs are structured and optimized for high-cardinality data lookups from the start.
- **LLM as an Untrusted Entity**: Security and authorization controls are applied before and after any AI interaction.
- **Security & Privacy by Design**: Privacy is embedded in the pipeline (e.g., separating collections, excluding PII from embedding vectors).
- **End-to-End Traceability**: Every AI-generated insight must be traceable back to the original source log.

---

## C. Project Roadmap (Phases)

| Phase   | Description                                                   | Status |
| :------ | :------------------------------------------------------------ | :----- |
| Phase 1 | Context-aware logging using NestJS and local JSON lines       | ✅     |
| Phase 2 | Log persistence and querying with MongoDB                     | ✅     |
| Phase 3 | Semantic storage of log summaries (Vector DB / RAG Ingestion) | ✅     |
| Phase 4 | RAG-powered log search and intelligent analysis system        | ✅     |
| Phase 5 | Production Hardening: MQ, Caching, and Sampling strategies    | ✅     |

**Current scope (repository)**: In addition to the phase goals above, the codebase includes a **LogLens** web client (session-based chat with the search API) and a **statistical analytics** path for metrics templates (e.g. error rate, latency percentiles): natural-language **query classification** extracts time bounds and filters; MongoDB aggregation builds **time-bucketed series** with **adaptive bucket width** for short windows so charts stay readable and bounded. Journals under `journals/` capture audit iterations (e.g. Phase 5.3).

---

## D. Architectural Philosophy

### D-1. Backend Code Structure

From **Phase 1**, this project adheres to the principles of **Hexagonal (Ports & Adapters)** and **Layered Architecture**:

- **Why?**: Since the project evolves through phases, it was crucial to keep the domain logic stable while swapping or adding external infrastructure (Outbound Adapters) like different storage types or message queues.
- **Maintainability**: The focus is on readable, traceable code over premature performance optimization.
- **Extensibility**: Different adapters can coexist or complement each other in the same runtime (see [Phase 6 docs (EN)](docs/en/06-phase-additional.md)).

### D-2. Hardening & Infrastructure (Phase 5)

Phase 5 transitions the functional RAG pipeline into a **Production-Grade Infrastructure** by focusing on **Technical Control** and **Resilience**.

#### 1. Infrastructure as a Means

- **Kafka for Isolation**: Used as a buffer to **decouple** logging overhead from business logic. It ensures that logs can be re-sent even if the consumer or storage temporarily fails.
- **Redis for Statelessness**: Used to share session history across instances, ensuring the application remains stateless and horizontally scalable.

#### 2. Engineering Trade-offs

To avoid over-engineering, we made deliberate choices:

- **Circuit Breaker**: Chose predictable circuit-breaking over complex self-healing state management for log re-processing.
- **Hash-based Sampling**: Used deterministic hash sampling for explainable and stable log volume control.

#### 3. Validation by Experiment

We verified the system through **Operational Scenarios** rather than just unit tests:

- **Stress Testing**: Proved ~75% cost reduction through sampling 2,000 requests without losing critical error signals.
- **Fault Tolerance**: Verified zero data loss during simulated Kafka failures via the Direct-to-DB fallback logic.
- **Persistence**: Confirmed session data and Kafka-buffered logs were preserved across infrastructure restarts.

### D-3. Frontend & Statistical UX (LogLens)

The **LogLens** app (`frontend/`, React + Vite + Tailwind, Feature-Sliced layout) is a **demo client** for end-to-end validation: it calls the same `/search/ask` flows as curl, shows **grounded** narrative answers, and renders **live statistics** (overview cards, request volume vs errors over time, latency percentiles, half-window error trend) when the backend returns structured stats. It does not change the core thesis—architecture and observability first—but makes statistical and semantic results tangible without relying on terminal-only tests.

---

## E. Timeline & Tech Stack

### Project Timeline:

- Initial focused build: Dec 24, 2025 – Jan 05, 2026 (12 days)
- Subsequent work: ongoing (e.g. LogLens, statistical aggregation UX, audits documented in `journals/`)

### Tech Stack:

- **Backend**: NestJS, TypeScript
- **Frontend (demo UI)**: React, Vite, TypeScript, Tailwind CSS, Recharts (LogLens)
- **Observability**: Custom Wide Event Context (AsyncLocalStorage)
- **Storage**: Local (JSON), MongoDB (time-series `logs`), vector-capable embeddings (project uses MongoDB + embedding pipeline; provider may vary)
- **AI / RAG**: LLM (Gemini Flash family) + VoyageAI embeddings + custom embeddings / search module
- **Infra (local)**: Docker Compose (MongoDB, Kafka, Zookeeper, Redis)
- **Tooling**: Cursor, pnpm, load generators under `test_data/`

---

## F. What This Project Is (and Is Not)

✅ **This project IS:**

- An exploration of observability, logging, and AI reliability.
- A system-design-focused portfolio.
- A record of technical decisions and architectural trade-offs.

❌ **This project IS NOT:**

- A production-ready SaaS product.
- A UI/UX–first or design-system showcase (LogLens is a thin client for validating search and stats).
- A generic CRUD demo.
- Optimized for raw performance above all else.

---

## G. Documentation

Phase-by-phase design notes: **[docs/en](docs/en)** (English) and **[docs/ko](docs/ko)** (Korean). Additional topics: [docs/en/06-phase-additional.md](docs/en/06-phase-additional.md), [docs/ko/06-phase-additional-ko.md](docs/ko/06-phase-additional-ko.md).

---

## H. Disclaimer

This project prioritizes **architecture, security, and observability principles** over scale or UI completeness. Experimental features and follow-on ideas are tracked in the Phase 6–style docs above and in `journals/`.
