import type {
  ChatSession,
  LogStats,
  TimeSeriesPoint,
  StatusDistribution,
  RouteMetric,
  ChatMessage,
} from './types'

export const MOCK_SESSIONS: ChatSession[] = [
  {
    id: 'sess-001',
    title: 'Payment failure investigation',
    lastMessage: 'Found 23 failed payment events in the last 2 hours...',
    createdAt: new Date('2026-02-25T10:30:00'),
    messageCount: 8,
  },
  {
    id: 'sess-002',
    title: 'Latency spike analysis',
    lastMessage: 'The /payments endpoint shows P99 latency of 4.2s...',
    createdAt: new Date('2026-02-25T09:15:00'),
    messageCount: 5,
  },
  {
    id: 'sess-003',
    title: 'Error rate trend',
    lastMessage: 'Error rate has decreased from 12% to 3.2% after deploy...',
    createdAt: new Date('2026-02-24T16:45:00'),
    messageCount: 12,
  },
  {
    id: 'sess-004',
    title: 'Kafka consumer lag',
    lastMessage: 'Consumer group log-consumer-group shows no lag...',
    createdAt: new Date('2026-02-24T14:20:00'),
    messageCount: 3,
  },
  {
    id: 'sess-005',
    title: 'Auth token expiry debugging',
    lastMessage: '17 requests failed with 401 from user batch processing...',
    createdAt: new Date('2026-02-24T11:00:00'),
    messageCount: 6,
  },
]

export const MOCK_STATS: LogStats = {
  totalRequests: 284_932,
  failedRequests: 9_118,
  successRate: 96.8,
  averageDurationMs: 245,
}

export function generateTimeSeriesData(): TimeSeriesPoint[] {
  const data: TimeSeriesPoint[] = []
  const now = new Date()
  for (let i = 23; i >= 0; i -= 1) {
    const time = new Date(now.getTime() - i * 60 * 60 * 1000)
    const hour = time.getHours()
    const isPeak = hour >= 9 && hour <= 18
    const baseRequests = isPeak ? 14_000 : 6_000
    const requests = baseRequests + Math.floor(Math.random() * 4_000)
    const errorFactor = i > 16 && i < 20 ? 0.08 : 0.03
    const errors = Math.floor(requests * errorFactor * (0.7 + Math.random() * 0.6))
    const latency = isPeak
      ? 200 + Math.floor(Math.random() * 150)
      : 120 + Math.floor(Math.random() * 80)
    data.push({
      bucket: `${String(time.getHours()).padStart(2, '0')}:00`,
      total: requests,
      failed: errors,
      averageDurationMs: latency,
    })
  }
  return data
}

export const MOCK_STATUS_DISTRIBUTION: StatusDistribution[] = [
  { status: '2xx', count: 275_814, fill: '#4ade80' },
  { status: '4xx', count: 6_234, fill: '#fb923c' },
  { status: '5xx', count: 2_884, fill: '#f87171' },
]

export const MOCK_ROUTE_METRICS: RouteMetric[] = [
  { route: 'POST /payments', total: 142_000, failed: 5_680, successRate: 96, averageDurationMs: 320 },
  { route: 'GET /payments/:id', total: 89_000, failed: 890, successRate: 99, averageDurationMs: 85 },
  { route: 'POST /refunds', total: 28_000, failed: 1_400, successRate: 95, averageDurationMs: 410 },
  { route: 'GET /health', total: 18_932, failed: 0, successRate: 100, averageDurationMs: 12 },
  { route: 'POST /webhooks', total: 7_000, failed: 1_148, successRate: 83, averageDurationMs: 180 },
]

export const INITIAL_MESSAGES: ChatMessage[] = [
  {
    id: 'welcome',
    role: 'assistant',
    content:
      'Welcome to LogLens. I can help you analyze your log data using natural language. Try asking me questions like:\n\n- "What caused the recent payment failures?"\n- "Show me error trends in the last 24 hours"\n- "How many 5xx errors happened on /payments?"\n\nI maintain conversation context, so feel free to ask follow-up questions.',
    timestamp: new Date(),
  },
]

