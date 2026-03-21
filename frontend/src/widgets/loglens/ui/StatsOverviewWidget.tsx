"use client"

import {
  Activity,
  AlertTriangle,
  Clock,
  Gauge,
  TrendingDown,
  Zap,
} from "lucide-react"
import type {
  ErrorTrendHalfWindow,
  LogStats,
  PercentileRow,
  TimeSeriesPoint,
} from "@/shared/lib/loglens"

interface StatsOverviewProps {
  stats: LogStats
  percentiles?: PercentileRow[]
  timeseries?: TimeSeriesPoint[]
  halfWindow?: ErrorTrendHalfWindow
}

function formatP99(percentiles?: PercentileRow[]): { value: string; sub: string } {
  if (!percentiles?.length) {
    return { value: "N/A", sub: "Not available" }
  }
  const p99 = percentiles.find(
    (p) => p.percentile === "P99" || p.percentile === "p99",
  )
  if (p99 == null || typeof p99.valueMs !== "number") {
    return { value: "N/A", sub: "Not available" }
  }
  return { value: `${p99.valueMs}ms`, sub: "From aggregation" }
}

function formatErrorTrend(
  timeseries?: TimeSeriesPoint[],
  halfWindow?: ErrorTrendHalfWindow,
): { value: string; sub: string } {
  if (timeseries && timeseries.length >= 2) {
    const first = timeseries[0]
    const last = timeseries[timeseries.length - 1]
    const errFirst =
      first.total > 0 ? (first.failed / first.total) * 100 : 0
    const errLast = last.total > 0 ? (last.failed / last.total) * 100 : 0
    const delta = errLast - errFirst
    if (Number.isFinite(delta) && Math.abs(delta) < 0.05) {
      return { value: "Flat", sub: "Error rate vs window start" }
    }
    const deltaStr =
      delta >= 0 ? `+${delta.toFixed(1)} pts` : `${delta.toFixed(1)} pts`
    return { value: deltaStr, sub: "Last vs first bucket (err %)" }
  }

  if (
    halfWindow &&
    typeof halfWindow.firstErrorRatePct === "number" &&
    typeof halfWindow.secondErrorRatePct === "number"
  ) {
    const delta =
      halfWindow.secondErrorRatePct - halfWindow.firstErrorRatePct
    if (Number.isFinite(delta) && Math.abs(delta) < 0.05) {
      return { value: "Flat", sub: "Second vs first half of window" }
    }
    const deltaStr =
      delta >= 0 ? `+${delta.toFixed(1)} pts` : `${delta.toFixed(1)} pts`
    return { value: deltaStr, sub: "Second vs first half (err %)" }
  }

  return { value: "N/A", sub: "Need 2+ time buckets or window bounds" }
}

export function StatsOverviewWidget({
  stats,
  percentiles,
  timeseries,
  halfWindow,
}: StatsOverviewProps) {
  const failedRequests = stats.failedRequests ?? 0
  const errorRate =
    stats.totalRequests > 0
      ? ((failedRequests / stats.totalRequests) * 100).toFixed(1)
      : "0.0"
  const successPct =
    stats.successRate <= 1 ? stats.successRate * 100 : stats.successRate

  const p99 = formatP99(percentiles)
  const trend = formatErrorTrend(timeseries, halfWindow)

  const cards = [
    {
      label: "Total Requests",
      value: stats.totalRequests.toLocaleString(),
      icon: Activity,
      accent: "text-primary",
      bgAccent: "bg-primary/10",
      sub: "Last 24h",
    },
    {
      label: "Error Rate",
      value: `${errorRate}%`,
      icon: AlertTriangle,
      accent: "text-destructive",
      bgAccent: "bg-destructive/10",
      sub: `${failedRequests.toLocaleString()} errors`,
    },
    {
      label: "Avg Latency",
      value:
        stats.averageDurationMs != null
          ? `${stats.averageDurationMs}ms`
          : "N/A",
      icon: Zap,
      accent: "text-success",
      bgAccent: "bg-success/10",
      sub: "Within SLA",
    },
    {
      label: "P99 Latency",
      value: p99.value,
      icon: Clock,
      accent: "text-warning",
      bgAccent: "bg-warning/10",
      sub: p99.sub,
    },
    {
      label: "Success Rate",
      value: `${successPct.toFixed(1)}%`,
      icon: Gauge,
      accent: "text-success",
      bgAccent: "bg-success/10",
      sub: "2xx responses",
    },
    {
      label: "Error Trend",
      value: trend.value,
      icon: TrendingDown,
      accent: "text-muted-foreground",
      bgAccent: "bg-muted/50",
      sub: trend.sub,
    },
  ]

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
      {cards.map((card) => (
        <div
          key={card.label}
          className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4 transition-colors hover:bg-accent/50"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              {card.label}
            </span>
            <div className={`rounded-lg p-1.5 ${card.bgAccent}`}>
              <card.icon className={`size-3.5 ${card.accent}`} />
            </div>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-xl font-bold tracking-tight text-foreground font-mono">
              {card.value}
            </span>
            <span className="text-xs text-muted-foreground">{card.sub}</span>
          </div>
        </div>
      ))}
    </div>
  )
}
