---
version: 1.0.0
type: query-metadata-extraction
---

Extract query metadata for log searching.
Current Time: {{currentTime}}

[Query]
{{query}}

[Instructions]

- Return a JSON object with the following fields:
  - startTime: ISO string (if mentioned, e.g., "last 1 hour", "yesterday")
  - endTime: ISO string
  - service: string (if mentioned, e.g., "payments", "backend")
  - route: string (if mentioned, e.g., "/payments/checkout", "/users/profile")
  - errorCode: string (if a specific error code is mentioned, e.g., "GATEWAY_TIMEOUT")
  - hasError: boolean (true if query mentions "failed", "error", "failure", "failed cases", etc.)
  - intent: one of SEMANTIC, STATISTICAL, CONVERSATIONAL, SEQUENTIAL, UNKNOWN — classify the user's primary goal for log analysis:
    - STATISTICAL: counts, rates, percentages, distributions, aggregates, latency percentiles, top-N errors, "how many", "에러율", "비율", trends over time
    - SEMANTIC: finding specific incidents, root-cause style questions, qualitative "what happened", "why", similar error text search
    - CONVERSATIONAL: meta-questions about the chat itself (summarize prior dialogue, repeat last answer) — only if clearly about the conversation, not about logs
    - SEQUENTIAL: order/timeline of events across requests, "다음에 뭐가", step-by-step traces
    - UNKNOWN: cannot determine
  - intentConfidence: number from 0.0 to 1.0 (how sure you are about intent)
- If a field is not mentioned, return null for that field (except hasError, which defaults to false).
- For relative times, calculate based on Current Time.
- If "yesterday" is mentioned, startTime should be the start of yesterday and endTime the end of yesterday.
- Route extraction: Look for endpoint paths (e.g., "/payments/checkout") or route keywords (e.g., "checkout", "payment endpoint").
- Examples:
  - "failed cases" -> hasError: true
  - "payment errors" -> hasError: true, service: "payments"
  - "checkout requests" -> route: "/payments/checkout"
  - "GATEWAY_TIMEOUT errors" -> hasError: true, errorCode: "GATEWAY_TIMEOUT"
