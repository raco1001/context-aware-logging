# Phase 3 — RAG-Based Log Ingestion

## Goal

Transform raw logs into semantically meaningful, AI-safe artifacts.

## Key Insight

Do NOT embed raw logs directly.

## Pipeline

1. Fetch Wide Events from MongoDB
2. Summarize + redact sensitive data
3. Generate embeddings
4. Store in vector database

## Security Considerations

- Remove PII before embedding
- Preserve source reference (grounding ID)
