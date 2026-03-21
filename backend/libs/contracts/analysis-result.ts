export type AnalysisIntent =
  | 'SEMANTIC'
  | 'STATISTICAL'
  | 'SEQUENTIAL'
  | 'CONVERSATIONAL'
  | 'UNKNOWN';

export type AnalysisViewType = 'chat' | 'analytics' | 'chat+analytics';

export type LogSourceStatus = 'SUCCESS' | 'FAILED';

export interface LogSource {
  id: string;
  summary: string;
  status: LogSourceStatus;
  route: string;
  duration: number;
  timestamp: string;
  errorCode?: string;
  failedAt?: string;
}

export interface LogStats {
  totalRequests: number;
  failedRequests: number;
  successRate: number;
  /** Omitted when the pipeline does not measure latency (e.g. ERROR_RATE). */
  averageDurationMs?: number;
}

/** Generic label/count row for TOP_ERROR_CODES, ERROR_BY_SERVICE, etc. */
export interface BreakdownRow {
  label: string;
  count: number;
}

export interface PercentileRow {
  percentile: string;
  valueMs: number;
  requestCount?: number;
}

export interface TimeSeriesPoint {
  bucket: string;
  total: number;
  failed: number;
  averageDurationMs?: number;
}

export interface RouteMetric {
  route: string;
  total?: number;
  failed?: number;
  successRate?: number;
  averageDurationMs?: number;
}

/** First vs second half of [startTime, endTime] for ERROR_RATE when hourly series has one bucket. */
export interface ErrorTrendHalfWindow {
  firstErrorRatePct: number;
  secondErrorRatePct: number;
}

export interface StatsPayload {
  overview?: LogStats;
  timeseries?: TimeSeriesPoint[];
  routes?: RouteMetric[];
  breakdown?: BreakdownRow[];
  percentiles?: PercentileRow[];
  /** ERROR_RATE: error rate % in first/second half of the query window (when metadata times exist). */
  halfWindow?: ErrorTrendHalfWindow;
  raw?: unknown;
}

export interface SessionSummary {
  sessionId: string;
  clientId?: string;
  title: string;
  lastMessage: string;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AnalysisResult {
  sessionId?: string;
  clientId?: string;
  title?: string;
  question: string;
  intent: AnalysisIntent;
  answer: string;
  sources: LogSource[];
  confidence: number;
  viewType?: AnalysisViewType;
  statsPayload?: StatsPayload;
  createdAt?: string;
}
