# Phase 1 Retrospective: Context-Aware Logging with Wide Events

## 1. Overview

The primary goal of Phase 1 was to move away from traditional line-based logging and lay the foundation for a **"Wide Event"** system that captures request-scoped context.
We focused on recording a complete data structure that describes "what business request was processed in what context," rather than just "what code was executed."

## 2. Key Themes & Challenges

- **Context Preservation**: Built a `ContextService` using `AsyncLocalStorage` to propagate request-unique IDs and states without loss in a highly asynchronous Node.js environment.
- **Single Source of Truth**: Designed the `finalize` logic in `LoggingInterceptor` and `LoggingService` to ensure exactly one log (Wide Event) is generated per request.
- **Semantic Enrichment**: Introduced descriptive error messages and a `metadata` field, going beyond simple error codes to prepare for future RAG (Retrieval-Augmented Generation) integration.
- **Dependency Injection & Stability**: Resolved DI issues for `FileLogger` in the NestJS environment and ensured the reliability of file system I/O.

## 3. Key Decisions & Rationale

- **Separation of LoggingContext vs. WideEvent**:
  - `LoggingContext`: A mutable application-layer object that can include internal processing fields (e.g., RAG summaries).
  - `WideEvent`: An immutable domain contract recorded to external storage.
  - This separation established a flexible structure for the logging system without altering the core business log schema.
- **Applying Hexagonal Architecture**: Strictly decoupled the logging interface (`Logger`) from its implementation (`FileLogger`), allowing storage to be swapped (e.g., to MongoDB) in the future without modifying business logic.
- **Introduction of PaymentErrorVO**: Managed errors as Value Objects rather than simple strings, providing detailed failure scenarios and descriptive messages to help AI better understand the context during RAG searches.

## 4. Retrospective: KPT

### Keep (Successes to maintain)

- **Principle-Centered Design**: Adhered to the "One Request -> One Wide Event" principle by introducing `finalizedRequestIds` (Set) to prevent duplicate logs.
- **Simulation-Based Validation**: Simulated various failure cases (insufficient balance, gateway timeout, etc.) through the `Payments` module without a real DB and successfully captured them in logs.
- **Real-World Validation via Load Testing**: Verified log integrity and system stability by sending 2,000 concurrent requests.

### Problem (Challenges to improve)

- **DI Runtime Errors**: Faced errors during NestJS startup due to environment variable injection issues in the `FileLogger` constructor. Resolved by cleaning up constructor parameters and providing default values.
- **File I/O Asynchrony**: Discovered potential data loss when using `FileHandle.write`, leading to a switch to the safer and more intuitive `fs.appendFile` method.
- **E2E Test Sensitivity**: Experienced intermittent test failures due to timing differences between when logs were written asynchronously and when tests verified them. Improved robustness with appropriate delays and retry logic.

### Try (Next steps)

- **Transition to Phase 2**: Move beyond file system limitations and implement data assetization using MongoDB Time-series collections.
- **Data Privacy Considerations**: Review a layer for masking sensitive information (PII) within logs.
- **Semantic Summary**: Implement logic to automatically generate a `summary` field to enhance RAG's understanding of log data.

## 5. Additional Insights

- **Logging as the Language of 'Operations'**: While `console.log` is convenient during development, only structured `Wide Events` serve as the fastest language for explaining system issues in production.
- **Building Up for RAG**: AI excels not just with structured fields (JSON) but also with natural language descriptions. We confirmed that descriptive text in `errorMessage` and `metadata` is a key asset for future search performance.

---

**Outcome**: Phase 1 concluded successfully with 2,000 load test requests recorded as unique Wide Events without any loss. We verified that rich context (User context, Performance, Metadata) is preserved even in error scenarios.
