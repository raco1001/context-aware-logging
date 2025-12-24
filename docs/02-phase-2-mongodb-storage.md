# Phase 2 — Persisting Logs as Data Assets

## Goal

Treat logs as queryable data, not files.

## Design Decisions

- Allow high-cardinality fields (user_id, request_id)
- Prefer fewer, richer documents over many shallow ones

## Index Strategy

- requestId
- timestamp
- user.id
- error.code

## Query Examples

- Error rate by user tier
- Latency p95 by route
