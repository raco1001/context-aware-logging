# Phase 2 Retrospective: Persisting Logs as Data Assets (MongoDB)

## 1. Overview

The core objective of Phase 2 was to transform logs from simple text files into **"queryable data assets."** To achieve this, we replaced the infrastructure layer from files to MongoDB and aimed to lay the architectural foundation for efficiently managing large-scale log data.

## 2. Key Themes & Challenges

- **Storage Optimization**: Introduced MongoDB Time-series collections optimized for log data characteristics (chronological order, write-heavy).
- **Architectural Integrity**: Maintained Hexagonal Architecture, swapping infrastructure adapters without modifying business logic.
- **Data Reliability**: Ensured the quality of persisted log data through runtime type checking and validation (`class-validator`).
- **Operational Efficiency**: Automated data lifecycle management using TTL (Time-To-Live) strategies.
- **Cost & Performance Aware Sampling**: Laid the foundation for selective log collection (e.g., Error logs, Premium user logs) to avoid the inefficiency of storing every single event and manage future embedding costs.

## 3. Key Decisions & Rationale

- **Time-series vs Normal Collection**: Selected Time-series collections considering log analysis performance and storage compression rates.
- **Class-based Validation (Contract-First)**: Promoted `WideEvent` from a simple interface to a validated Class. This defines logs not just as text, but as a **"Data Contract"** for downstream analysis (RAG, statistics), preventing "Garbage In, Garbage Out."
- **Abstract Class as Injection Token**: Shifted from string/symbol-based tokens to using the abstract class itself as the token to ensure type safety and idiomatic NestJS dependency injection.
- **Connection Lifecycle**: Adopted a singleton approach where the connection is established during the application initialization phase and shared across adapters.

## 4. Retrospective: KPT

### Keep

- **Success of Adapter Pattern**: Zero modifications were required in the `LoggingService` code when switching from `FileLogger` to `MongoLogger`. This realized true Separation of Concerns (SoC).
- **Infrastructure Automation**: Automated environment setup by codifying indexes, TTL, and validation rules through `mongodb-init.js`.
- **Balancing Generic vs Specific**: Separated the logging library (system-level errors) from the business domain (domain-specific errors) to ensure maximum flexibility and reuse.

### Problem

- **Environment-Dependent Issues**: Encountered host name resolution issues (`ENOTFOUND atlas_local`) due to the Replica Set configuration in the local Docker environment. While temporarily resolved with `directConnection=true`, further consideration for cluster environments is needed.
- **Performance Trade-offs**: Potential CPU overhead is expected in ultra-high load environments as class instantiation and validation are performed for every log. This remains a challenge to be solved with async buffering or MQ.

### Try

- **Preparation for Phase 3**: Establish vectorization and automated tagging strategies for RAG (Retrieval-Augmented Generation) based on logs accumulated in MongoDB.
- **Intelligent Sampling (Tail-based)**: Implement sophisticated collection policies (e.g., 100% for errors, 1-5% for normal requests) based on business value.
- **Advanced Error Handling**: Consider a fallback strategy to file logging or in-memory buffering if the MongoDB connection fails.

## 5. Additional Insights

- **Concern Separation (System Health vs. Business Event)**: Clearly separated the built-in NestJS `Logger` (for system operational health) from the custom `LoggingModule` (for business-critical Wide Events).
- **The Core of Traceability**: Recognized `requestId` as the vital link between structured statistical analysis and unstructured AI analysis. Ensuring its integrity throughout the lifecycle is fundamental to the architecture.

---

**Result**: Confirmed stable data storage and indexing performance through load testing (2,000 entries), and established the data-driven foundation for moving forward to Phase 3.
