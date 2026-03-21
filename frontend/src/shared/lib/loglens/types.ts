export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
  sources?: LogSource[]
}

export interface LogSource {
  id: string
  summary: string
  status: 'SUCCESS' | 'FAILED'
  route: string
  duration: number
  timestamp: string
  errorCode?: string
  failedAt?: string
}

export interface ChatSession {
  id: string
  title: string
  lastMessage: string
  createdAt: Date
  messageCount: number
}

export interface SessionSummary {
  sessionId: string
  clientId?: string
  title: string
  lastMessage: string
  messageCount: number
  createdAt: string
  updatedAt: string
}

export interface LogStats {
  totalRequests: number
  failedRequests: number
  successRate: number
  /** Omitted when the pipeline does not measure latency (e.g. ERROR_RATE). */
  averageDurationMs?: number
}

export interface BreakdownRow {
  label: string
  count: number
}

export interface PercentileRow {
  percentile: string
  valueMs: number
  requestCount?: number
}

export interface ErrorTrendHalfWindow {
  firstErrorRatePct: number
  secondErrorRatePct: number
}

export interface TimeSeriesPoint {
  bucket: string
  total: number
  failed: number
  averageDurationMs?: number
}

export interface StatusDistribution {
  status: string
  count: number
  fill: string
}

export interface RouteMetric {
  route: string
  total?: number
  failed?: number
  successRate?: number
  averageDurationMs?: number
}

export type AnalysisIntent =
  | 'SEMANTIC'
  | 'STATISTICAL'
  | 'SEQUENTIAL'
  | 'CONVERSATIONAL'
  | 'UNKNOWN'

export type ViewType = 'chat' | 'analytics' | 'chat+analytics'

export interface StatsPayload {
  overview?: LogStats
  timeseries?: TimeSeriesPoint[]
  routes?: RouteMetric[]
  breakdown?: BreakdownRow[]
  percentiles?: PercentileRow[]
  halfWindow?: ErrorTrendHalfWindow
  statusDistribution?: StatusDistribution[]
  raw?: unknown
}

export interface AnalysisResult {
  sessionId?: string
  question: string
  intent: AnalysisIntent
  answer: string
  sources: LogSource[]
  confidence: number
  viewType?: ViewType
  statsPayload?: StatsPayload
  createdAt?: string
}

