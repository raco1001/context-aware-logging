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
  status: string
  route: string
  duration: number
  timestamp: string
}

export interface ChatSession {
  id: string
  title: string
  lastMessage: string
  createdAt: Date
  messageCount: number
}

export interface LogStats {
  totalRequests: number
  errorRate: number
  avgLatency: number
  p99Latency: number
  totalErrors: number
  successRate: number
}

export interface TimeSeriesPoint {
  time: string
  requests: number
  errors: number
  latency: number
}

export interface StatusDistribution {
  status: string
  count: number
  fill: string
}

export interface RouteMetric {
  route: string
  requests: number
  errors: number
  avgLatency: number
  p99Latency: number
}

export type AnalysisIntent = 'SEMANTIC' | 'STATISTICAL' | 'CONVERSATIONAL'

export type ViewType = 'chat' | 'analytics' | 'chat+analytics'

export interface StatsPayload {
  overview?: LogStats
  timeseries?: TimeSeriesPoint[]
  routes?: RouteMetric[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  raw?: any
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

