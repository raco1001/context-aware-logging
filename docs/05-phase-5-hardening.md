# Phase 5 — System Hardening

## Enhancements

- Message Queue for async log ingestion
- Redis for query/session caching
- Tail-based sampling strategy

## Sampling Rules

- Errors: 100%
- Slow requests: 100%
- VIP users: 100%
- Others: 1–5%

## Non-Goals

- Global scale
- Perfect fault tolerance
