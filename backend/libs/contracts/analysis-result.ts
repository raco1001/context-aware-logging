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
  averageDurationMs: number;
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

export interface StatsPayload {
  overview?: LogStats;
  timeseries?: TimeSeriesPoint[];
  routes?: RouteMetric[];
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
