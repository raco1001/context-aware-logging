/**
 * Log Spec (Phase 5.1)
 *
 * Canonical, contract-first schema for:
 * - Raw wide events (time-series)
 * - Embedded wide events (vector search)
 *
 * Constraints:
 * - Pure TypeScript (no decorators / no framework imports)
 * - DB validators (mongodb-init.js) are secondary and must be kept in sync manually at current scale
 */

export type LogOutcome = 'SUCCESS' | 'FAILED' | 'WARNING' | 'EDGE_CASE';

export type LogErrorCode = string;

export interface WideEventUserSpec {
  id: string;
  role: string;
}

export interface WideEventErrorSpec {
  code: LogErrorCode;
  message: string;
}

export interface WideEventPerformanceSpec {
  durationMs: number;
  /** Step-level breakdowns (optional, Pattern A) */
  balanceCheckMs?: number;
  gatewayMs?: number;
  orderConfirmationMs?: number;
}

/**
 * Canonical raw log event shape stored in `wide_events`.
 *
 * Notes:
 * - `timestamp` is canonical as Date (MongoDB time-series timeField).
 * - `_summary` is a working field for embedding generation (Phase 3+).
 */
export interface WideEventSpec {
  requestId: string;
  timestamp: Date;
  service: string;
  route: string;
  user?: WideEventUserSpec;
  error?: WideEventErrorSpec;
  /** Multi-step context (Pattern A) */
  failedAt?: string;
  stepsReached?: number;
  performance?: WideEventPerformanceSpec;
  _metadata?: Record<string, unknown>;
  _summary?: string;
}

/**
 * Canonical embedding document shape stored in `wide_events_embedded`.
 *
 * `eventId` maps to the raw `wide_events._id` (ObjectId) and is the primary join key.
 * `requestId` is an optional grounding / convenience key.
 */
export interface WideEventEmbeddedSpec {
  eventId: unknown; // MongoDB ObjectId (kept as unknown to avoid mongodb dependency in contracts)
  requestId?: string;
  summary: string;
  model: string;
  embedding: number[];
  service?: string;
  timestamp?: Date;
  hasError: boolean;
  errorCode?: string;
  route?: string;
  outcome: string;
  failedAt?: string;
  createdAt: Date;
}
