/**
 * Chunking Utilities for Embedding Strategy
 *
 * Based on MongoDB RAG tutorial Step 3: Chunk and Embed strategy.
 * Provides utilities for splitting long or complex log summaries into
 * smaller, semantically meaningful chunks for improved vector search.
 */

export interface Chunk {
  text: string;
  _metadata?: Record<string, any>;
}

/**
 * Splits a structured summary string into semantic chunks.
 * This is useful when dealing with very long summaries or when
 * we want to create multiple embeddings for a single log entry.
 *
 * @param summary The structured summary string (e.g., _summary format)
 * @param maxChunkLength Maximum characters per chunk (default: 200)
 * @returns Array of chunks
 *
 * @example
 * Input: "Outcome: FAILED, Service: payments, Route: /checkout, Error: GATEWAY_TIMEOUT, ErrorMessage: Connection timeout, UserRole: PREMIUM, LatencyBucket: P_OVER_1000MS"
 * Output: [
 *   { text: "Outcome: FAILED, Service: payments, Route: /checkout" },
 *   { text: "Error: GATEWAY_TIMEOUT, ErrorMessage: Connection timeout" },
 *   { text: "UserRole: PREMIUM, LatencyBucket: P_OVER_1000MS" }
 * ]
 */
export function chunkSummary(
  _summary: string,
  maxChunkLength: number = 200,
): Chunk[] {
  // If summary is short enough, return as single chunk
  if (_summary.length <= maxChunkLength) {
    return [{ text: _summary }];
  }

  // Split by comma and space to preserve semantic meaning
  const parts = _summary.split(", ").filter((part) => part.trim().length > 0);
  const chunks: Chunk[] = [];
  let currentChunk = "";

  for (const part of parts) {
    // If adding this part would exceed max length, start a new chunk
    if (
      currentChunk.length > 0 &&
      currentChunk.length + part.length + 2 > maxChunkLength
    ) {
      chunks.push({ text: currentChunk.trim() });
      currentChunk = part;
    } else {
      // Add to current chunk
      if (currentChunk.length > 0) {
        currentChunk += ", " + part;
      } else {
        currentChunk = part;
      }
    }
  }

  // Add the last chunk if it has content
  if (currentChunk.trim().length > 0) {
    chunks.push({ text: currentChunk.trim() });
  }

  return chunks;
}

/**
 * Creates overlapping chunks with a specified overlap size.
 * This helps ensure that semantic boundaries are preserved
 * across chunk boundaries.
 *
 * @param summary The structured summary string
 * @param chunkLength Length of each chunk
 * @param overlapSize Number of characters to overlap between chunks
 * @returns Array of overlapping chunks
 */
export function createOverlappingChunks(
  _summary: string,
  chunkLength: number = 150,
  overlapSize: number = 30,
): Chunk[] {
  if (_summary.length <= chunkLength) {
    return [{ text: _summary }];
  }

  const chunks: Chunk[] = [];
  let start = 0;

  while (start < _summary.length) {
    const end = Math.min(start + chunkLength, _summary.length);
    const chunk = _summary.substring(start, end);
    chunks.push({ text: chunk.trim() });

    // Move start position forward, accounting for overlap
    start = end - overlapSize;
    if (start >= _summary.length) {
      break;
    }
  }

  return chunks;
}

/**
 * Splits a summary by semantic fields (Outcome, Service, Error, etc.).
 * Each field becomes a separate chunk, allowing for more granular search.
 *
 * @param _summary The structured summary string
 * @returns Array of field-based chunks
 *
 * @example
 * Input: "Outcome: FAILED, Service: payments, Error: GATEWAY_TIMEOUT"
 * Output: [
 *   { text: "Outcome: FAILED", metadata: { field: "outcome" } },
 *   { text: "Service: payments", metadata: { field: "service" } },
 *   { text: "Error: GATEWAY_TIMEOUT", metadata: { field: "error" } }
 * ]
 */
export function chunkByFields(_summary: string): Chunk[] {
  const parts = _summary.split(", ").filter((part) => part.trim().length > 0);
  return parts.map((part) => {
    const colonIndex = part.indexOf(":");
    if (colonIndex > 0) {
      const field = part.substring(0, colonIndex).toLowerCase();
      return {
        text: part.trim(),
        _metadata: { field },
      };
    }
    return { text: part.trim() };
  });
}

/**
 * Determines if a summary should be chunked based on length and complexity.
 *
 * @param _summary The structured summary string
 * @param threshold Length threshold for chunking (default: 200)
 * @returns true if chunking is recommended
 */
export function shouldChunk(
  _summary: string,
  threshold: number = 200,
): boolean {
  return _summary.length > threshold;
}
