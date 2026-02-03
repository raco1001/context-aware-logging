/**
 * LoggingContext - Mutable context that will be enriched throughout
 * the request lifecycle and eventually converted to a WideEvent.
 *
 * This is a proper class with constructor to ensure consistent initialization.
 * Can be extended with additional fields for specific domain requirements.
 */
export class LoggingContext {
  public readonly requestId: string;
  public readonly timestamp: string;
  public service: string;
  public route: string;
  public user?: { id: string; role: string };
  public error?: { code: string; message: string };
  public performance?: { durationMs: number };
  /** Domain-specific metadata storage */
  public _metadata: Record<string, unknown>;

  /**
   * Internal processing fields for Phase 3+ (RAG/Embeddings)
   * These are part of the working context but not the core WideEvent domain model.
   */
  _summary?: string;

  constructor(requestId: string, service: string, route: string) {
    this.requestId = requestId;
    this.timestamp = new Date().toISOString();
    this.service = service;
    this.route = route;
    this._metadata = {};
  }

  /**
   * Update context with partial data.
   * Used for enriching context throughout the request lifecycle.
   */
  enrich(
    updates: Partial<Omit<LoggingContext, 'requestId' | 'timestamp'>>,
  ): void {
    if (updates.service !== undefined) this.service = updates.service;
    if (updates.route !== undefined) this.route = updates.route;
    if (updates.user !== undefined) this.user = updates.user;
    if (updates.error !== undefined) this.error = updates.error;
    if (updates.performance !== undefined)
      this.performance = updates.performance;
    if (updates._metadata !== undefined) {
      this._metadata = { ...this._metadata, ...updates._metadata };
    }
    if (updates._summary !== undefined) this._summary = updates._summary;
  }
}
