/**
 * Context interface - represents the mutable context that will be enriched
 * throughout the request lifecycle and eventually converted to a WideEvent.
 *
 * Can be extended with additional fields for specific domain requirements.
 */
export class LoggingContext {
  requestId: string;
  public timestamp: string;
  public service: string;
  public route: string;
  public user?: { id: string; role: string };
  public error?: { code: string; message: string };
  public performance?: { durationMs: number };
  // Allow for domain-specific metadata
  public _metadata: Record<string, any> = {};

  /**
   * Internal processing fields for Phase 3+ (RAG/Embeddings)
   * These are part of the working context but not the core WideEvent domain model.
   */
  _summary?: string;
}
