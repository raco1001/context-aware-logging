/**
 * WideEvent - The single unit of truth for logging across all phases.
 *
 * This interface represents the core schema that remains consistent,
 * while allowing for optional metadata to accommodate evolving needs.
 */
export interface WideEvent {
  requestId: string;
  timestamp: string;
  service: string;
  route: string;
  user?: { id: string; role: string };
  error?: { code: string; message: string };
  performance?: { durationMs: number };
  // Domain-specific metadata for advanced analysis (e.g., RAG)
  metadata?: Record<string, any>;
}
