/**
 * Context interface - represents the mutable context that will be enriched
 * throughout the request lifecycle and eventually converted to a WideEvent.
 *
 * Can be extended with additional fields for specific domain requirements.
 */
export interface LoggingContext {
  requestId: string;
  timestamp: string;
  service: string;
  route: string;
  user?: { id: string; role: string };
  error?: { code: string; message: string };
  performance?: { durationMs: number };
  // Allow for domain-specific metadata
  metadata?: Record<string, any>;
}
