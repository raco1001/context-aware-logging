import { AnalysisIntent } from '@embeddings/value-objects/filter';

export type AnalysisViewType = 'chat' | 'analytics' | 'chat+analytics';

export interface StatsPayload {
  /**
   * High-level summary metrics for the current analysis window.
   * Shape is intentionally flexible to allow different aggregation templates.
   */
  overview?: Record<string, any>;

  /**
   * Time series style metrics (e.g. requests/errors/latency by time bucket).
   */
  timeseries?: Array<Record<string, any>>;

  /**
   * Per-route or per-dimension breakdown metrics.
   */
  routes?: Array<Record<string, any>>;

  /**
   * Raw aggregation results as returned from AggregationService.
   * Useful for debugging or for consumers that need full fidelity.
   */
  raw?: any;
}

export interface AnalysisResult {
  /**
   * Session identifier for conversational context.
   */
  sessionId?: string;

  /**
   * Original user question in natural language.
   */
  question: string;

  /**
   * Detected analysis intent (semantic, statistical, conversational, ...).
   */
  intent: AnalysisIntent;

  /**
   * Natural language answer shown in the chat UI.
   */
  answer: string;

  /**
   * List of requestIds or evidence identifiers used to ground the answer.
   */
  sources: string[];

  /**
   * Model-estimated confidence score for the answer.
   */
  confidence: number;

  /**
   * Preferred view type for the frontend.
   * Defaults to 'chat' when omitted.
   */
  viewType?: AnalysisViewType;

  /**
   * Optional statistical payload when intent is STATISTICAL.
   * Carries structured metrics for analytics views.
   */
  statsPayload?: StatsPayload;

  /**
   * Timestamp when this analysis result was created.
   */
  createdAt?: Date;
}
